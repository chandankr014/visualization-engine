/**
 * Map Manager Module
 * Handles MapLibre GL initialization and PMTiles loading.
 * Optimized for time-series visualization using a single master PMTiles file.
 * Time switching is done by changing the depth property expression (no geometry reload).
 */

import { eventBus, AppEvents } from './event-bus.js';
import apiBridge from './api-bridge.js';

const EARTH_RADIUS_METERS = 6378137;
const MAPTILER_KEY = "R0asFVRtuNV5ghpmqbyM";

// Throttle helper
const throttle = (fn, limit) => {
    let inThrottle;
    return (...args) => {
        if (!inThrottle) {
            fn(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
};

class MapManager {
    constructor(config, logger, statsTracker) {
        this.config = config;
        this.logger = logger;
        this.statsTracker = statsTracker;
        this.map = null;
        this.protocol = null;
        this.currentLayerConfig = null;
        this.currentLayerType = 'multiclass';
        this._handlersSetup = false;
        this._isLoading = false;
        this._masterPMTilesLoaded = false;
        this.currentDepthProperty = null; // Current time slot property (e.g., 'D202512101000')
        this.wardBoundariesData = null;
        this.staticLayers = new Map(); // Track loaded static layers
        this.hotspotsData = null; // Hotspots data
        this.googleMapsApiKey = config.googleMapsApiKey || ''; // Google Maps API Key from config
        
        // Batch-based PMTiles configuration
        this.batchConfig = {
            batchSize: config.batchSize || 48,
            batchFiles: config.batchFiles || [],
            floodDir: config.pmtilesFloodDir || 'pmtiles/flood',
            currentBatchIndex: -1,
            currentBatchFile: null
        };
        this.currentTimeIndex = 0; // Global time slot index
        this.currentLocalIndex = 0; // Index within current batch (0-47)
        
        // Feature state tracking for depth values
        // We use feature-state because MapLibre can't parse JSON arrays in expressions
        this._featureDepthCache = new Map(); // geo_code -> parsed flood_depths array
        this._pendingFeatureStateUpdate = false;
        
        // Batch transition state (double-buffering for smooth transitions)
        this._batchTransition = {
            isTransitioning: false,
            pendingBatchInfo: null,
            activeLayerSuffix: 'A',  // 'A' or 'B' for double-buffering
            preloadedSources: new Map() // batchFile -> { loaded, sourceId }
        };
        
        // Base map styles - Use Google Maps if API key is available
        if (this.googleMapsApiKey) {
            this.baseStyles = {
                light: this._createGoogleMapsStyle('roadmap'),
                dark: this._createGoogleMapsStyle('dark'),
                openstreetmap: this._createGoogleMapsStyle('roadmap'),
                satellite: this._createGoogleMapsStyle('satellite'),
                topo: this._createGoogleMapsStyle('terrain'),
            };
        } else {
            // Fallback to other basemaps if no Google Maps API key
            this.baseStyles = {
                light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
                dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
                openstreetmap: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
                satellite: `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`,
                topo: `https://api.maptiler.com/maps/topo/style.json?key=${MAPTILER_KEY}`,
            };
        }

        // Property name for geo_code (unique identifier for each cell)
        this.geoCodeProperty = 'geo_code';
        
        // Throttled functions
        this._throttledMouseMove = throttle(this._handleMouseMove.bind(this), 100);
        this._throttledUpdateStats = throttle(this._updateStatsInternal.bind(this), 2000);
    }

    /**
     * Create Google Maps style configuration for MapLibre
     * @param {string} mapType - Google Maps type: roadmap, satellite, hybrid, terrain, dark
     */
    _createGoogleMapsStyle(mapType = 'roadmap') {
        const styleMap = {
            'roadmap': 'roadmap',
            'satellite': 'satellite',
            'hybrid': 'hybrid',
            'terrain': 'terrain',
            'dark': 'dark'
        };
        
        const selectedStyle = styleMap[mapType] || 'roadmap';
        
        return {
            version: 8,
            name: `Google Maps - ${selectedStyle}`,
            sources: {
                'google-maps': {
                    type: 'raster',
                    tiles: [
                        `https://mt0.google.com/vt/lyrs=${this._getGoogleMapsLayerParam(selectedStyle)}&x={x}&y={y}&z={z}&key=${this.googleMapsApiKey}`,
                        `https://mt1.google.com/vt/lyrs=${this._getGoogleMapsLayerParam(selectedStyle)}&x={x}&y={y}&z={z}&key=${this.googleMapsApiKey}`,
                        `https://mt2.google.com/vt/lyrs=${this._getGoogleMapsLayerParam(selectedStyle)}&x={x}&y={y}&z={z}&key=${this.googleMapsApiKey}`,
                        `https://mt3.google.com/vt/lyrs=${this._getGoogleMapsLayerParam(selectedStyle)}&x={x}&y={y}&z={z}&key=${this.googleMapsApiKey}`
                    ],
                    tileSize: 256,
                    attribution: '&copy; Google Maps'
                }
            },
            layers: [
                {
                    id: 'google-maps-layer',
                    type: 'raster',
                    source: 'google-maps',
                    minzoom: 0,
                    maxzoom: 22
                }
            ]
        };
    }

    /**
     * Get Google Maps layer parameter based on style type
     */
    _getGoogleMapsLayerParam(styleType) {
        const params = {
            'roadmap': 'm',      // Standard roadmap
            'satellite': 's',    // Satellite only
            'hybrid': 'y',       // Satellite with labels
            'terrain': 'p',      // Terrain
            'dark': 'r'          // Dark mode (roadmap with dark styling)
        };
        return params[styleType] || 'm';
    }

    init() {
        this.logger.info('Initializing MapLibre GL map');
        
        try {
            this.map = new maplibregl.Map({
                container: 'map',
                style: this.baseStyles[this.config.initialStyle],
                center: this.config.initialCenter,
                zoom: this.config.initialZoom,
                pitch: 0,
                bearing: 0,
                attributionControl: true,
                refreshExpiredTiles: false,
                fadeDuration: 0, // Disable fade for snappier transitions
                trackResize: true
            });
            
            // Add controls
            this.map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
            this.map.addControl(new maplibregl.ScaleControl({ maxWidth: 200 }), 'bottom-left');
            this.map.addControl(new maplibregl.FullscreenControl(), 'bottom-right');

            // Setup event listeners
            this._setupEventListeners();

            // Setup PMTiles protocol
            this.protocol = new pmtiles.Protocol();
            maplibregl.addProtocol('pmtiles', this.protocol.tile);
            this.logger.success('Map initialized with PMTiles protocol');

            this.map.on('load', () => {
                this.logger.success('Map loaded successfully');
                eventBus.emit(AppEvents.MAP_READY, { map: this.map });
            });

            this.map.on('error', (e) => {
                this.logger.error('Map error', e.error?.message || e.message);
                eventBus.emit(AppEvents.MAP_ERROR, e);
            });

        } catch (error) {
            this.logger.error('Failed to initialize map', error.message);
            eventBus.emit(AppEvents.MAP_ERROR, error);
        }
    }

    async loadWardBoundaries() {
        if (this.wardBoundariesData) {
            this.logger.info('Ward boundaries already loaded');
            return true;
        }

        try {
            this.logger.info('Loading ward boundaries...');
            const response = await apiBridge.getWardBoundaries();
            
            if (!response.success || !response.data) {
                throw new Error('Failed to load ward boundaries');
            }

            this.wardBoundariesData = response.data;
            this.logger.success('Ward boundaries loaded');
            return true;
        } catch (error) {
            this.logger.error('Failed to load ward boundaries', error.message);
            return false;
        }
    }

    async addWardBoundary() {
        if (!this.map || !this.wardBoundariesData) {
            this.logger.error('Map or ward boundaries not ready');
            return false;
        }

        try {
            // Remove existing ward layers if present
            if (this.map.getLayer('ward-fill')) {
                this.map.removeLayer('ward-fill');
            }
            if (this.map.getLayer('ward-outline')) {
                this.map.removeLayer('ward-outline');
            }
            if (this.map.getSource('ward-boundaries')) {
                this.map.removeSource('ward-boundaries');
            }

            // Add source
            this.map.addSource('ward-boundaries', {
                type: 'geojson',
                data: this.wardBoundariesData
            });

            // Add transparent fill for hover/click
            this.map.addLayer({
                id: 'ward-fill',
                type: 'fill',
                source: 'ward-boundaries',
                paint: {
                    'fill-color': 'transparent',
                    'fill-opacity': 0
                }
            });

            // Add outline layer
            this.map.addLayer({
                id: 'ward-outline',
                type: 'line',
                source: 'ward-boundaries',
                paint: {
                    'line-color': '#1e3a8a',
                    'line-width': 2,
                    'line-opacity': 0.8
                }
            });

            this.logger.success('Ward boundaries added');
            return true;
        } catch (error) {
            this.logger.error('Failed to add ward boundaries', error.message);
            return false;
        }
    }

    // Hotspot layer loading - Commented out but not removed
    // async loadHotspots() {
    //     if (this.hotspotsData) {
    //         this.logger.info('Hotspots already loaded');
    //         return true;
    //     }

    //     try {
    //         this.logger.info('Loading hotspots...');
    //         const response = await apiBridge.getHotspots();
    //         
    //         if (!response.success || !response.data) {
    //             throw new Error('Failed to load hotspots');
    //         }

    //         this.hotspotsData = response.data;
    //         this.logger.success('Hotspots loaded');
    //         return true;
    //     } catch (error) {
    //         this.logger.error('Failed to load hotspots', error.message);
    //         return false;
    //     }
    // }

    // Hotspot layer rendering - Commented out but not removed
    // async addHotspots() {
    //     if (!this.map || !this.hotspotsData) {
    //         this.logger.error('Map or hotspots not ready');
    //         return false;
    //     }

    //     try {
    //         // Remove existing hotspot layers if present
    //         if (this.map.getLayer('hotspots-circle')) {
    //             this.map.removeLayer('hotspots-circle');
    //         }
    //         if (this.map.getLayer('hotspots-label')) {
    //             this.map.removeLayer('hotspots-label');
    //         }
    //         if (this.map.getSource('hotspots')) {
    //             this.map.removeSource('hotspots');
    //         }

    //         // Add source
    //         this.map.addSource('hotspots', {
    //             type: 'geojson',
    //             data: this.hotspotsData
    //         });

    //         // Add circle layer for hotspot markers
    //         this.map.addLayer({
    //             id: 'hotspots-circle',
    //             type: 'circle',
    //             source: 'hotspots',
    //             paint: {
    //                 'circle-radius': 8,
    //                 'circle-color': '#dc2626',
    //                 'circle-stroke-width': 2,
    //                 'circle-stroke-color': '#ffffff',
    //                 'circle-opacity': 0.9
    //             }
    //         });

    //         // Add label layer for hotspot names
    //         this.map.addLayer({
    //             id: 'hotspots-label',
    //             type: 'symbol',
    //             source: 'hotspots',
    //             layout: {
    //                 'text-field': ['get', 'Points'],
    //                 'text-size': 11,
    //                 'text-offset': [0, 1.5],
    //                 'text-anchor': 'top'
    //             },
    //             paint: {
    //                 'text-color': '#1f2937',
    //                 'text-halo-color': '#ffffff',
    //                 'text-halo-width': 1.5
    //             }
    //         });

    //         this.logger.success('Hotspots added');
    //         return true;
    //     } catch (error) {
    //         this.logger.error('Failed to add hotspots', error.message);
    //         return false;
    //     }
    // }

    async toggleStaticLayer(layerId, visible) {
        if (!this.map) return false;

        const sourceId = `static-${layerId}`;
        const layerIdFill = `${sourceId}-fill`;
        const layerIdLine = `${sourceId}-line`;

        try {
            if (visible) {
                // Load layer if not already loaded
                if (!this.map.getSource(sourceId)) {
                    const pmtilesUrl = apiBridge.buildStaticLayerUrl(layerId);
                    
                    const p = new pmtiles.PMTiles(pmtilesUrl);
                    const metadata = await p.getMetadata();
                    
                    const layerName = metadata.vector_layers?.[0]?.id || 'default';
                    const minzoom = parseInt(metadata.minzoom) || 0;
                    const maxzoom = parseInt(metadata.maxzoom) || 14;

                    this.map.addSource(sourceId, {
                        type: 'vector',
                        url: `pmtiles://${pmtilesUrl}`,
                        minzoom,
                        maxzoom
                    });

                    // Add fill layer
                    this.map.addLayer({
                        id: layerIdFill,
                        type: 'fill',
                        source: sourceId,
                        'source-layer': layerName,
                        paint: {
                            'fill-color': this._getStaticLayerColor(layerId),
                            'fill-opacity': 0.6
                        }
                    });

                    // Add line layer
                    this.map.addLayer({
                        id: layerIdLine,
                        type: 'line',
                        source: sourceId,
                        'source-layer': layerName,
                        paint: {
                            'line-color': '#000000',
                            'line-width': 0.5,
                            'line-opacity': 0.3
                        }
                    });

                    this.staticLayers.set(layerId, { sourceId, layerIdFill, layerIdLine });
                    this.logger.success(`Static layer ${layerId} loaded`);
                }
                
                // Show layers
                this.map.setLayoutProperty(layerIdFill, 'visibility', 'visible');
                this.map.setLayoutProperty(layerIdLine, 'visibility', 'visible');
            } else {
                // Hide layers
                if (this.map.getLayer(layerIdFill)) {
                    this.map.setLayoutProperty(layerIdFill, 'visibility', 'none');
                }
                if (this.map.getLayer(layerIdLine)) {
                    this.map.setLayoutProperty(layerIdLine, 'visibility', 'none');
                }
            }

            return true;
        } catch (error) {
            this.logger.error(`Failed to toggle static layer ${layerId}`, error.message);
            return false;
        }
    }

    // LULC class colors
    lulcClassColors = {
        'Tree Cover': '#228b22',
        'Shrubland': '#90ee90',
        'Grassland': '#adff2f',
        'Cropland': '#ffd700',
        'Built_up': '#dc143c',
        'Sparse Vegetation': '#deb887',
        'Water Bodies': '#1e90ff',
        'Mangroves': '#006400'
    };

    _getStaticLayerColor(layerId) {
        const colors = {
            'roadways': '#ff7f00',
            'default': '#377eb8'
        };
        return colors[layerId] || colors['default'];
    }

    /**
     * Toggle roadways layer (PMTiles-based)
     */
    async toggleRoadways(visible) {
        if (!this.map) return false;

        const sourceId = 'roadways-source';
        const layerId = 'roadways-layer';

        try {
            if (visible) {
                // Load roadways if not already loaded
                if (!this.map.getSource(sourceId)) {
                    this.logger.info('Loading roadways PMTiles...');
                    const pmtilesUrl = apiBridge.buildStaticLayerUrl('roads');
                    const p = new pmtiles.PMTiles(pmtilesUrl);
                    const metadata = await p.getMetadata();
                    
                    const layerName = metadata.vector_layers?.[0]?.id || 'roads';
                    const minzoom = parseInt(metadata.minzoom) || 0;
                    const maxzoom = parseInt(metadata.maxzoom) || 14;

                    this.map.addSource(sourceId, {
                        type: 'vector',
                        url: `pmtiles://${pmtilesUrl}`,
                        minzoom,
                        maxzoom
                    });

                    // Use line layer only - filter out non-line geometries to prevent fill issues
                    this.map.addLayer({
                        id: layerId,
                        type: 'line',
                        source: sourceId,
                        'source-layer': layerName,
                        filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
                        paint: {
                            'line-color': '#ff7f00',
                            'line-width': [
                                'interpolate', ['linear'], ['zoom'],
                                10, 1,
                                14, 2,
                                18, 4
                            ],
                            'line-opacity': 0.8
                        }
                    });

                    // Store layer info for style restoration
                    this.staticLayers.set('roadways', { sourceId, layerId, layerName });
                    this.logger.success('Roadways layer loaded');
                }
                
                this.map.setLayoutProperty(layerId, 'visibility', 'visible');
            } else {
                if (this.map.getLayer(layerId)) {
                    this.map.setLayoutProperty(layerId, 'visibility', 'none');
                }
            }

            return true;
        } catch (error) {
            this.logger.error('Failed to toggle roadways layer', error.message);
            return false;
        }
    }

    async toggleLulcClasses(selectedClasses) {
        if (!this.map) return false;

        const sourceId = 'static-lulc';
        const layerIdFill = `${sourceId}-fill`;
        const layerIdLine = `${sourceId}-line`;

        try {
            if (selectedClasses.length === 0) {
                // Hide layers if no classes selected
                if (this.map.getLayer(layerIdFill)) {
                    this.map.setLayoutProperty(layerIdFill, 'visibility', 'none');
                }
                if (this.map.getLayer(layerIdLine)) {
                    this.map.setLayoutProperty(layerIdLine, 'visibility', 'none');
                }
                return true;
            }

            // Load LULC source if not already loaded
            if (!this.map.getSource(sourceId)) {
                const pmtilesUrl = apiBridge.buildStaticLayerUrl('lulc');
                const p = new pmtiles.PMTiles(pmtilesUrl);
                const metadata = await p.getMetadata();
                
                // Layer name from PMTiles metadata
                const layerName = metadata.vector_layers?.[0]?.id || 'lulc_output';
                const minzoom = parseInt(metadata.minzoom) || 0;
                const maxzoom = parseInt(metadata.maxzoom) || 14;

                this.logger.info(`LULC layer name: ${layerName}`);

                this.map.addSource(sourceId, {
                    type: 'vector',
                    url: `pmtiles://${pmtilesUrl}`,
                    minzoom,
                    maxzoom
                });

                // Build color expression based on class names (using 'name' property)
                const colorExpression = this._buildLulcColorExpression();

                this.map.addLayer({
                    id: layerIdFill,
                    type: 'fill',
                    source: sourceId,
                    'source-layer': layerName,
                    paint: {
                        'fill-color': colorExpression,
                        'fill-opacity': 0.7
                    }
                });

                this.map.addLayer({
                    id: layerIdLine,
                    type: 'line',
                    source: sourceId,
                    'source-layer': layerName,
                    paint: {
                        'line-color': '#000000',
                        'line-width': 0.5,
                        'line-opacity': 0.5
                    }
                });

                this.staticLayers.set('lulc', { sourceId, layerIdFill, layerIdLine, layerName });
                this.logger.success('LULC layer loaded');
            }

            // Build filter for selected classes (using 'name' property)
            const classFilter = ['in', ['get', 'name'], ['literal', selectedClasses]];
            
            this.map.setFilter(layerIdFill, classFilter);
            this.map.setFilter(layerIdLine, classFilter);
            this.map.setLayoutProperty(layerIdFill, 'visibility', 'visible');
            this.map.setLayoutProperty(layerIdLine, 'visibility', 'visible');

            this.logger.info(`LULC showing classes: ${selectedClasses.join(', ')}`);
            return true;
        } catch (error) {
            this.logger.error('Failed to toggle LULC classes', error.message);
            return false;
        }
    }

    _buildLulcColorExpression() {
        // Use 'name' property from PMTiles
        const matchExpression = ['match', ['get', 'name']];
        for (const [className, color] of Object.entries(this.lulcClassColors)) {
            matchExpression.push(className, color);
        }
        matchExpression.push('#808080'); // fallback color
        return matchExpression;
    }

    _setupEventListeners() {
        // Throttled mouse move
        this.map.on('mousemove', this._throttledMouseMove);

        // Update zoom stats
        this.map.on('zoom', () => {
            this.statsTracker.updateZoom(this.map.getZoom());
        });
        
        // Update stats on move end
        this.map.on('moveend', () => {
            this._throttledUpdateStats();
        });
    }

    _handleMouseMove(e) {
        this.statsTracker.updateCursor(e.lngLat.lat, e.lngLat.lng);
    }

    /**
     * Update batch configuration from server config
     * @param {Object} serverConfig - Config from /api/config endpoint
     */
    updateBatchConfig(serverConfig) {
        if (serverConfig.batchSize) {
            this.batchConfig.batchSize = serverConfig.batchSize;
        }
        if (serverConfig.batchFiles) {
            this.batchConfig.batchFiles = serverConfig.batchFiles;
        }
        if (serverConfig.pmtilesFloodDir) {
            this.batchConfig.floodDir = serverConfig.pmtilesFloodDir;
        }
        this.logger.info(`Batch config updated: ${this.batchConfig.batchFiles.length} batch files, ${this.batchConfig.batchSize} slots per batch`);
    }

    /**
     * Get the current active layer IDs based on suffix
     * @returns {Object} Object with fillId, outlineId, sourceId
     */
    _getActiveLayerIds() {
        const suffix = this._batchTransition.activeLayerSuffix;
        return {
            fillId: `pmtiles-layer-${suffix}`,
            outlineId: `pmtiles-outline-${suffix}`,
            sourceId: `pmtiles-source-${suffix}`
        };
    }

    /**
     * Get the next layer IDs for the incoming batch (opposite of active)
     * @returns {Object} Object with fillId, outlineId, sourceId
     */
    _getNextLayerIds() {
        const suffix = this._batchTransition.activeLayerSuffix === 'A' ? 'B' : 'A';
        return {
            fillId: `pmtiles-layer-${suffix}`,
            outlineId: `pmtiles-outline-${suffix}`,
            sourceId: `pmtiles-source-${suffix}`,
            suffix
        };
    }

    /**
     * Get batch info for a given global time index
     * @param {number} globalIndex - Global time slot index (0-based)
     * @returns {Object} Batch info with batchIndex, localIndex, batchFile
     */
    _getBatchForIndex(globalIndex) {
        const batchSize = this.batchConfig.batchSize;
        const batchFiles = this.batchConfig.batchFiles;
        
        const batchIndex = Math.floor(globalIndex / batchSize);
        const localIndex = globalIndex % batchSize;
        
        // Clamp to available batch files
        const clampedBatchIndex = Math.min(batchIndex, batchFiles.length - 1);
        const batchFile = batchFiles[clampedBatchIndex];
        
        return {
            batchIndex: clampedBatchIndex,
            localIndex,
            globalIndex,
            batchFile: batchFile?.filename || null,
            batchPath: batchFile?.path || null
        };
    }

    /**
     * Load PMTiles for a given time index (batch-based system)
     * Uses double-buffering for smooth transitions between batches
     * @param {number} timeIndex - Global time slot index (0-based)
     * @param {string} timeSlot - Time slot property name (e.g., 'D202512101000') - kept for compatibility
     * @param {boolean} isInitialLoad - Whether this is the first load (skip double-buffering)
     */
    async loadPMTiles(timeIndex, timeSlot = null, isInitialLoad = false) {
        if (!this.map) {
            this.logger.error('Map not initialized');
            return false;
        }
        
        // Handle legacy call with just timeSlot string
        if (typeof timeIndex === 'string') {
            timeSlot = timeIndex;
            timeIndex = this.currentTimeIndex || 0;
        }
        
        // Get batch info for this time index
        const batchInfo = this._getBatchForIndex(timeIndex);
        
        // If same batch is already loaded, just switch the local index
        if (this._masterPMTilesLoaded && batchInfo.batchIndex === this.batchConfig.currentBatchIndex) {
            return this.switchTimeSlot(timeIndex, timeSlot);
        }
        
        // If a batch transition is already in progress, queue this request
        if (this._batchTransition.isTransitioning) {
            this.logger.info('Batch transition in progress, queuing request');
            this._batchTransition.pendingBatchInfo = { timeIndex, timeSlot };
            return true; // Return true to indicate request is queued
        }
        
        if (this._isLoading) {
            this.logger.warning('Load already in progress');
            return false;
        }

        // Determine if this is the first load (no existing layers)
        const isFirstLoad = !this._masterPMTilesLoaded || isInitialLoad;
        
        this._isLoading = true;
        this._batchTransition.isTransitioning = !isFirstLoad;
        
        if (!isFirstLoad) {
            // Emit batch transition start for coordination
            eventBus.emit(AppEvents.BATCH_TRANSITION_START, { 
                fromBatch: this.batchConfig.currentBatchFile,
                toBatch: batchInfo.batchFile 
            });
        }
        
        this.logger.info(`${isFirstLoad ? 'Loading' : 'Transitioning to'} batch: ${batchInfo.batchFile} (index ${batchInfo.localIndex})...`);
        const mapState = this._saveMapState();
        const loadStartTime = performance.now();

        try {
            // Build URL for the batch file
            const pmtilesUrl = apiBridge.getBatchPMTilesUrl(batchInfo.batchFile, this.batchConfig.floodDir);

            const p = new pmtiles.PMTiles(pmtilesUrl);
            const [metadata, header] = await Promise.all([p.getMetadata(), p.getHeader()]);
            
            this.statsTracker.updatePMTilesSize(header.rootLength || 0);

            // Parse bounds
            let bounds = this._parseBounds(metadata.bounds);
            const layerName = metadata.vector_layers?.[0]?.id || 'final_gdf_epsg4326';
            const minzoom = parseInt(metadata.minzoom) || 0;
            const maxzoom = parseInt(metadata.maxzoom) || 14;

            // Get layer IDs for the new batch
            const nextIds = isFirstLoad 
                ? { fillId: 'pmtiles-layer-A', outlineId: 'pmtiles-outline-A', sourceId: 'pmtiles-source-A', suffix: 'A' }
                : this._getNextLayerIds();
            
            // Clean up any orphaned layers with the same ID (safety)
            this._cleanupLayerById(nextIds.fillId);
            this._cleanupLayerById(nextIds.outlineId);
            if (this.map.getSource(nextIds.sourceId)) {
                this.map.removeSource(nextIds.sourceId);
            }

            // Add source with promoteId for feature-state support
            this.map.addSource(nextIds.sourceId, {
                type: 'vector',
                url: `pmtiles://${pmtilesUrl}`,
                minzoom,
                maxzoom,
                promoteId: 'geo_code' // Use geo_code as feature ID for feature-state
            });

            // Use feature-state for depth values since flood_depths is stored as JSON string
            const fillColorExpression = this._getFeatureStateColorExpression(this.currentLayerType);
            
            const fillLayerConfig = {
                id: nextIds.fillId,
                type: 'fill',
                source: nextIds.sourceId,
                'source-layer': layerName,
                paint: {
                    'fill-color': fillColorExpression,
                    'fill-opacity': isFirstLoad ? 1 : 0 // Start invisible for transitions
                }
            };
            this.map.addLayer(fillLayerConfig);

            // Add outline layer (hidden by default)
            this.map.addLayer({
                id: nextIds.outlineId,
                type: 'line',
                source: nextIds.sourceId,
                'source-layer': layerName,
                paint: {
                    'line-color': '#0f172a',
                    'line-width': 0,
                    'line-opacity': 0
                }
            });

            // Store current indices
            this.currentTimeIndex = timeIndex;
            this.currentLocalIndex = batchInfo.localIndex;
            this.currentDepthProperty = timeSlot;
            this.batchConfig.currentBatchIndex = batchInfo.batchIndex;
            this.batchConfig.currentBatchFile = batchInfo.batchFile;
            
            // Store config for style changes
            this.currentLayerConfig = {
                fill: { ...fillLayerConfig },
                layerName,
                sourceConfig: {
                    type: 'vector',
                    url: `pmtiles://${pmtilesUrl}`,
                    minzoom,
                    maxzoom
                }
            };

            // Restore or fit map view (only on first load)
            if (isFirstLoad) {
                this._restoreOrFitBounds(mapState, bounds);
            }

            // Setup handlers once
            if (!this._handlersSetup) {
                this._setupClickHandler();
                this._setupCursorInteractions();
                this._setupFeatureStateUpdater();
                this._handlersSetup = true;
            }
            
            // Wait for tiles to load before transitioning
            await this._waitForSourceLoad(nextIds.sourceId, nextIds.fillId, layerName);
            
            // Update feature states for the new layer
            await this._updateFeatureStatesForLayer(nextIds.sourceId, nextIds.fillId, layerName);
            
            // Perform the layer swap (crossfade for smooth transition)
            if (!isFirstLoad) {
                await this._performLayerSwap(nextIds);
            }
            
            // Update active layer suffix
            this._batchTransition.activeLayerSuffix = nextIds.suffix;
            this._masterPMTilesLoaded = true;
            
            const loadTime = (performance.now() - loadStartTime) / 1000;
            this.statsTracker.updateLoadTime(loadTime);
            this.logger.success(`Batch ${batchInfo.batchFile} ${isFirstLoad ? 'loaded' : 'transitioned'} in ${loadTime.toFixed(2)}s`);
            eventBus.emit(AppEvents.MAP_LAYER_LOADED, { timeIndex, timeSlot, loadTime, batchFile: batchInfo.batchFile });
            
            if (!isFirstLoad) {
                eventBus.emit(AppEvents.BATCH_TRANSITION_END, { 
                    batchFile: batchInfo.batchFile,
                    loadTime 
                });
            }
            
            // Process any queued batch request
            if (this._batchTransition.pendingBatchInfo) {
                const pending = this._batchTransition.pendingBatchInfo;
                this._batchTransition.pendingBatchInfo = null;
                // Use setTimeout to avoid deep recursion
                setTimeout(() => this.loadPMTiles(pending.timeIndex, pending.timeSlot), 0);
            }
            
            return true;

        } catch (error) {
            this.logger.error(`Failed to load batch PMTiles`, error.message);
            eventBus.emit(AppEvents.MAP_LAYER_ERROR, { timeIndex, timeSlot, error });
            
            if (!isFirstLoad) {
                eventBus.emit(AppEvents.BATCH_TRANSITION_END, { 
                    batchFile: batchInfo.batchFile,
                    error: true 
                });
            }
            return false;
        } finally {
            this._isLoading = false;
            this._batchTransition.isTransitioning = false;
        }
    }

    /**
     * Wait for a source to fully load its tiles
     * @param {string} sourceId - Source ID to wait for
     * @param {string} layerId - Layer ID to check for rendered features  
     * @param {string} layerName - Source layer name
     * @returns {Promise} Resolves when source is loaded
     */
    _waitForSourceLoad(sourceId, layerId, layerName) {
        return new Promise((resolve) => {
            const maxWaitTime = 8000; // 8 second timeout
            const checkInterval = 50;
            let elapsed = 0;
            
            const checkLoaded = () => {
                const source = this.map.getSource(sourceId);
                
                // Check if source is loaded
                if (source && this.map.isSourceLoaded(sourceId)) {
                    // Additional check: try to query features to ensure tiles are actually rendered
                    try {
                        const features = this.map.queryRenderedFeatures({ layers: [layerId] });
                        if (features.length > 0) {
                            this.logger.debug(`Source ${sourceId} loaded with ${features.length} features`);
                            resolve();
                            return;
                        }
                    } catch (e) {
                        // Layer might not be queryable yet
                    }
                }
                
                elapsed += checkInterval;
                if (elapsed >= maxWaitTime) {
                    this.logger.warning(`Source ${sourceId} load timeout after ${maxWaitTime}ms`);
                    resolve(); // Resolve anyway to prevent hanging
                    return;
                }
                
                setTimeout(checkLoaded, checkInterval);
            };
            
            // Start checking
            checkLoaded();
        });
    }

    /**
     * Update feature states for a specific layer
     * @param {string} sourceId - Source ID
     * @param {string} layerId - Fill layer ID  
     * @param {string} layerName - Source layer name
     */
    async _updateFeatureStatesForLayer(sourceId, layerId, layerName) {
        try {
            const features = this.map.queryRenderedFeatures({ layers: [layerId] });
            
            let updatedCount = 0;
            for (const feature of features) {
                const geoCode = feature.properties?.geo_code;
                if (!geoCode) continue;
                
                const depth = this._getDepthValue(feature.properties);
                
                this.map.setFeatureState(
                    { source: sourceId, sourceLayer: layerName, id: geoCode },
                    { depth: depth ?? 0 }
                );
                updatedCount++;
            }
            
            this.logger.debug(`Updated ${updatedCount} feature states for layer ${layerId}`);
        } catch (error) {
            this.logger.error('Failed to update feature states for layer', error.message);
        }
    }

    /**
     * Perform a smooth layer swap with crossfade
     * @param {Object} nextIds - Object with fillId, outlineId, sourceId, suffix for new layer
     */
    async _performLayerSwap(nextIds) {
        const currentIds = this._getActiveLayerIds();
        const fadeDuration = 300; // ms for crossfade
        const fadeSteps = 15;
        const stepDuration = fadeDuration / fadeSteps;
        
        return new Promise((resolve) => {
            let step = 0;
            
            const animate = () => {
                step++;
                const progress = step / fadeSteps;
                const eased = this._easeInOutQuad(progress);
                
                // Fade in new layer
                if (this.map.getLayer(nextIds.fillId)) {
                    this.map.setPaintProperty(nextIds.fillId, 'fill-opacity', eased);
                }
                
                // Fade out old layer
                if (this.map.getLayer(currentIds.fillId)) {
                    this.map.setPaintProperty(currentIds.fillId, 'fill-opacity', 1 - eased);
                }
                
                if (step < fadeSteps) {
                    setTimeout(animate, stepDuration);
                } else {
                    // Animation complete - clean up old layers
                    this._cleanupOldBatchLayers(currentIds);
                    resolve();
                }
            };
            
            // Start animation
            animate();
        });
    }

    /**
     * Easing function for smooth transitions
     */
    _easeInOutQuad(t) {
        return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    }

    /**
     * Clean up old batch layers after transition
     * @param {Object} layerIds - Object with fillId, outlineId, sourceId
     */
    _cleanupOldBatchLayers(layerIds) {
        try {
            this._cleanupLayerById(layerIds.fillId);
            this._cleanupLayerById(layerIds.outlineId);
            
            if (this.map.getSource(layerIds.sourceId)) {
                this.map.removeSource(layerIds.sourceId);
            }
            
            this.logger.debug(`Cleaned up old batch layers: ${layerIds.sourceId}`);
        } catch (error) {
            this.logger.warning('Error cleaning up old layers', error.message);
        }
    }

    /**
     * Safely remove a layer by ID
     * @param {string} layerId - Layer ID to remove
     */
    _cleanupLayerById(layerId) {
        if (this.map.getLayer(layerId)) {
            this.map.removeLayer(layerId);
        }
    }

    /**
     * Get the active fill layer ID (for compatibility with methods that reference 'pmtiles-layer')
     * @returns {string} Active fill layer ID
     */
    _getActiveFillLayerId() {
        const suffix = this._batchTransition.activeLayerSuffix || 'A';
        return `pmtiles-layer-${suffix}`;
    }

    /**
     * Get the active source ID
     * @returns {string} Active source ID
     */
    _getActiveSourceId() {
        const suffix = this._batchTransition.activeLayerSuffix || 'A';
        return `pmtiles-source-${suffix}`;
    }

    /**
     * Switch to a different time slot (batch-aware)
     * If the new time slot is in a different batch, will reload the batch file
     * @param {number} timeIndex - Global time slot index (0-based)
     * @param {string} timeSlot - Time slot property name (e.g., 'D202512101000') - kept for display
     */
    switchTimeSlot(timeIndex, timeSlot = null) {
        // Handle legacy call with just timeSlot string
        if (typeof timeIndex === 'string') {
            timeSlot = timeIndex;
            timeIndex = this.currentTimeIndex || 0;
        }
        
        if (!this.map || !this._masterPMTilesLoaded) {
            this.logger.error('PMTiles not loaded');
            return false;
        }

        const activeFillId = this._getActiveFillLayerId();
        if (!this.map.getLayer(activeFillId)) {
            this.logger.error('PMTiles layer not found');
            return false;
        }

        // Get batch info for this time index
        const batchInfo = this._getBatchForIndex(timeIndex);
        
        // Check if we need to load a different batch (smooth transition)
        if (batchInfo.batchIndex !== this.batchConfig.currentBatchIndex) {
            this.logger.info(`Transitioning to batch: ${batchInfo.batchFile}`);
            return this.loadPMTiles(timeIndex, timeSlot);
        }

        try {
            const switchStartTime = performance.now();
            
            // Update current indices
            this.currentTimeIndex = timeIndex;
            this.currentLocalIndex = batchInfo.localIndex;
            this.currentDepthProperty = timeSlot;
            
            // Update feature states for the new time index
            // This re-extracts depth values from flood_depths arrays at the new index
            this._scheduleFeatureStateUpdate();
            
            const switchTime = (performance.now() - switchStartTime) / 1000;
            this.logger.debug(`Switched to index ${batchInfo.localIndex} in ${switchTime.toFixed(3)}s`);
            eventBus.emit(AppEvents.MAP_LAYER_LOADED, { timeIndex, timeSlot, loadTime: switchTime, switchOnly: true });
            
            // Update statistics for the new time slot after a small delay to allow rendering
            setTimeout(() => this._throttledUpdateStats(), 100);
            
            return true;
        } catch (error) {
            this.logger.error(`Failed to switch time slot`, error.message);
            return false;
        }
    }

    _parseBounds(boundsInput) {
        const defaultBounds = [76.928503, 28.349931, 77.125603, 28.545531];
        
        if (!boundsInput) return defaultBounds;
        
        let bounds = typeof boundsInput === 'string' 
            ? boundsInput.split(',').map(Number) 
            : boundsInput;
        
        if (!Array.isArray(bounds) || bounds.length !== 4 || bounds.some(isNaN)) {
            this.logger.warning('Invalid bounds, using defaults');
            return defaultBounds;
        }
        
        return bounds;
    }

    _restoreOrFitBounds(mapState, bounds) {
        if (mapState.hasState) {
            this._restoreMapState(mapState);
        } else {
            const persistedState = this._loadPersistedState();
            if (persistedState) {
                this._restoreMapState(persistedState);
            } else {
                try {
                    this.map.fitBounds(
                        [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
                        { padding: 50, duration: 500, maxZoom: 15 }
                    );
                } catch {
                    this.map.jumpTo({
                        center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
                        zoom: 11
                    });
                }
            }
        }
    }

    changeLayerType(layerType) {
        if (!this.map || !this.currentLayerConfig) return;
        
        this.currentLayerType = layerType;
        this.logger.info(`Changing to ${layerType} visualization`);
        
        const activeFillId = this._getActiveFillLayerId();
        if (this.map.getLayer(activeFillId)) {
            const fillColorExpression = this._getFeatureStateColorExpression(layerType);
            this.map.setPaintProperty(activeFillId, 'fill-color', fillColorExpression);
            this.logger.success(`Layer updated to ${layerType}`);
        }
    }

    _removeExistingLayers() {
        // Clean up both A and B layers (double-buffer system)
        ['pmtiles-layer-A', 'pmtiles-outline-A', 'pmtiles-layer-B', 'pmtiles-outline-B'].forEach(id => {
            if (this.map.getLayer(id)) this.map.removeLayer(id);
        });
        ['pmtiles-source-A', 'pmtiles-source-B'].forEach(id => {
            if (this.map.getSource(id)) this.map.removeSource(id);
        });
        // Reset master loaded flag since we removed the layers
        this._masterPMTilesLoaded = false;
        // Reset batch transition state
        this._batchTransition.activeLayerSuffix = 'A';
        // Note: ward-boundaries source is persistent, don't remove it
    }

    _saveMapState() {
        if (!this.map?.loaded()) return { hasState: false };

        try {
            const state = {
                hasState: true,
                center: this.map.getCenter(),
                zoom: this.map.getZoom(),
                pitch: this.map.getPitch(),
                bearing: this.map.getBearing()
            };
            this._persistMapState(state);
            return state;
        } catch {
            return { hasState: false };
        }
    }

    _restoreMapState(state) {
        if (!state.hasState) return;
        try {
            this.map.jumpTo({
                center: state.center,
                zoom: state.zoom,
                pitch: state.pitch,
                bearing: state.bearing
            });
        } catch (error) {
            this.logger.warning('Failed to restore map state');
        }
    }

    _persistMapState(state) {
        try {
            sessionStorage.setItem('pmtiles_map_state', JSON.stringify({
                center: [state.center.lng, state.center.lat],
                zoom: state.zoom,
                pitch: state.pitch,
                bearing: state.bearing,
                timestamp: Date.now()
            }));
        } catch { /* ignore storage errors */ }
    }

    _loadPersistedState() {
        try {
            const stored = sessionStorage.getItem('pmtiles_map_state');
            if (!stored) return null;
            
            const state = JSON.parse(stored);
            const age = Date.now() - (state.timestamp || 0);
            
            // Expire after 1 hour
            if (age > 60 * 60 * 1000) return null;
            
            return {
                hasState: true,
                center: { lng: state.center[0], lat: state.center[1] },
                zoom: state.zoom,
                pitch: state.pitch,
                bearing: state.bearing
            };
        } catch {
            return null;
        }
    }

    _setupClickHandler() {
        // Use event delegation for click handling on all pmtiles layers
        this.map.on('click', (e) => {
            // Find which flood layer was clicked
            const activeFillId = this._getActiveFillLayerId();
            const features = this.map.queryRenderedFeatures(e.point, { layers: [activeFillId] });
            
            if (!features || features.length === 0) return;
            
            const feature = features[0];
            const properties = feature.properties;
            
            // Debug: Log raw properties to understand data format
            console.log('Feature properties:', properties);
            console.log('flood_depths type:', typeof properties.flood_depths);
            console.log('flood_depths value:', properties.flood_depths);
            console.log('currentLocalIndex:', this.currentLocalIndex);
            
            const depth = this._getDepthValue(properties);
            
            const popupHTML = this._buildPopupHTML(depth, properties);
            
            new maplibregl.Popup({ maxWidth: '300px' })
                .setLngLat(e.lngLat)
                .setHTML(popupHTML)
                .addTo(this.map);
            
            eventBus.emit(AppEvents.MAP_CLICK, { lngLat: e.lngLat, properties, depth });
        });
    }

    _buildPopupHTML(depth, properties) {
        const timeLabel = this._formatTimeSlotLabel(this.currentDepthProperty);
        let html = `<div style="font-weight: 600; margin-bottom: 8px; font-size: 14px;">${timeLabel}</div>`;
        
        if (depth !== null && !isNaN(depth)) {
            const { color, label, textColor } = this._getDepthStyle(depth);
            html += `
                <div style="background: ${color}; color: ${textColor}; padding: 12px; margin-bottom: 8px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 28px; font-weight: bold;">${depth.toFixed(3)} m</div>
                    <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">Severity: ${label}</div>
                </div>
            `;
        } else {
            html += `
                <div style="background: #f1f5f9; color: #64748b; padding: 12px; margin-bottom: 8px; border-radius: 6px; text-align: center;">
                    <div style="font-size: 18px; font-weight: bold;">No Data</div>
                    <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">No flood depth recorded</div>
                </div>
            `;
        }
        
        // Show geo_code if available
        if (properties.geo_code) {
            html += `
                <div style="display: flex; justify-content: space-between; padding: 6px 0; font-size: 11px; color: #64748b;">
                    <span>Cell ID:</span>
                    <span style="font-weight: 600; font-family: monospace;">${properties.geo_code}</span>
                </div>
            `;
        }
        
        return html;
    }

    /**
     * Format time slot property for display (e.g., D202512101000 -> 10/12/2025 10:00)
     */
    _formatTimeSlotLabel(timeSlot) {
        if (!timeSlot || timeSlot.length < 13) return timeSlot || 'N/A';
        
        const timeStr = timeSlot.substring(1); // Remove 'D' prefix
        const year = timeStr.substring(0, 4);
        const month = timeStr.substring(4, 6);
        const day = timeStr.substring(6, 8);
        const hour = timeStr.substring(8, 10);
        const minute = timeStr.substring(10, 12);
        
        return `${day}/${month}/${year} ${hour}:${minute}`;
    }
    
    _getDepthStyle(depth) {
        if (depth >= 2) return { color: '#0b3a8c', label: 'Extreme', textColor: '#ffffff' };
        if (depth >= 1) return { color: '#1e6ddf', label: 'Severe', textColor: '#ffffff' };
        if (depth >= 0.5) return { color: '#5aa8ff', label: 'Significant', textColor: '#0f172a' };
        if (depth >= 0.2) return { color: '#9dd1ff', label: 'Moderate', textColor: '#0f172a' };
        return { color: '#f5fbff', label: 'Low', textColor: '#0f172a' };
    }

    _setupCursorInteractions() {
        // Use map-level mousemove for cursor changes
        this.map.on('mousemove', (e) => {
            const activeFillId = this._getActiveFillLayerId();
            if (!this.map.getLayer(activeFillId)) return;
            
            const features = this.map.queryRenderedFeatures(e.point, { layers: [activeFillId] });
            this.map.getCanvas().style.cursor = features.length > 0 ? 'pointer' : '';
        });
    }

    setLayerOpacity(opacity) {
        const activeFillId = this._getActiveFillLayerId();
        if (this.map?.getLayer(activeFillId)) {
            this.map.setPaintProperty(activeFillId, 'fill-opacity', opacity);
        }
    }

    changeBaseStyle(style) {
        if (!this.map || !this.baseStyles[style]) return;

        this.logger.info(`Changing base style to: ${style}`);
        const mapState = this._saveMapState();
        
        // Store current layer visibility states
        const layerStates = this._saveLayerStates();
        
        // Store current indices before style change
        const currentDepthProp = this.currentDepthProperty;
        const currentLocalIdx = this.currentLocalIndex;
        
        this.map.setStyle(this.baseStyles[style]);

        this.map.once('style.load', async () => {
            this.logger.success('Base style loaded');
            
            // Restore map state
            if (mapState.hasState) {
                this._restoreMapState(mapState);
            }
            
            // Re-add ward boundaries
            if (this.wardBoundariesData) {
                await this.addWardBoundary();
                if (!layerStates.wardBoundaries) {
                    this.map.setLayoutProperty('ward-fill', 'visibility', 'none');
                    this.map.setLayoutProperty('ward-outline', 'visibility', 'none');
                }
            }
            
            // Re-add PMTiles layers with current local index
            if (this.currentLayerConfig) {
                try {
                    // Use the active layer suffix for consistency
                    const suffix = this._batchTransition.activeLayerSuffix || 'A';
                    const sourceId = `pmtiles-source-${suffix}`;
                    const fillId = `pmtiles-layer-${suffix}`;
                    const outlineId = `pmtiles-outline-${suffix}`;
                    
                    // Re-add source with promoteId for feature-state
                    const sourceConfig = {
                        ...this.currentLayerConfig.sourceConfig,
                        promoteId: 'geo_code'
                    };
                    this.map.addSource(sourceId, sourceConfig);
                    
                    // Use feature-state based color expression
                    const fillColorExpression = this._getFeatureStateColorExpression(this.currentLayerType);
                    
                    // Update stored config with new IDs
                    const restoredFillConfig = {
                        ...this.currentLayerConfig.fill,
                        id: fillId,
                        source: sourceId,
                        paint: {
                            ...this.currentLayerConfig.fill.paint,
                            'fill-color': fillColorExpression
                        }
                    };
                    
                    this.map.addLayer(restoredFillConfig);
                    this.map.addLayer({
                        id: outlineId,
                        type: 'line',
                        source: sourceId,
                        'source-layer': this.currentLayerConfig.layerName,
                        paint: {
                            'line-color': '#0f172a',
                            'line-width': 0,
                            'line-opacity': 0
                        }
                    });
                    
                    // Update stored config
                    this.currentLayerConfig.fill = restoredFillConfig;
                    
                    this._masterPMTilesLoaded = true;
                    this.currentDepthProperty = currentDepthProp;
                    this.currentLocalIndex = currentLocalIdx;
                    
                    // Schedule feature state update for restored layers
                    this._scheduleFeatureStateUpdate();
                    
                    if (!layerStates.floodDepth) {
                        this.map.setLayoutProperty(fillId, 'visibility', 'none');
                    }
                    this.logger.success('PMTiles layers restored');
                } catch (error) {
                    this.logger.error('Failed to restore PMTiles layers', error.message);
                }
            }
            
            // Re-add static layers that were visible
            for (const [layerId, layerInfo] of this.staticLayers) {
                if (layerId === 'lulc') {
                    // Re-add LULC with its filter
                    await this._restoreLulcLayer(layerStates.lulcClasses);
                } else {
                    await this._restoreStaticLayer(layerId, layerInfo, layerStates[layerId]);
                }
            }
            
            eventBus.emit(AppEvents.MAP_STYLE_CHANGED, { style });
        });
    }

    _saveLayerStates() {
        const activeFillId = this._getActiveFillLayerId();
        const states = {
            wardBoundaries: this.map.getLayer('ward-outline') ? 
                this.map.getLayoutProperty('ward-outline', 'visibility') !== 'none' : false,
            floodDepth: this.map.getLayer(activeFillId) ? 
                this.map.getLayoutProperty(activeFillId, 'visibility') !== 'none' : true,
            lulcClasses: []
        };
        
        // Check LULC filter to get selected classes (filter uses 'name' property)
        if (this.map.getLayer('static-lulc-fill')) {
            const filter = this.map.getFilter('static-lulc-fill');
            // Filter format: ['in', ['get', 'name'], ['literal', [...classes]]]
            if (filter && filter[2] && filter[2][1]) {
                states.lulcClasses = filter[2][1];
            }
            states.lulcVisible = this.map.getLayoutProperty('static-lulc-fill', 'visibility') !== 'none';
        }
        
        // Check other static layers
        for (const [layerId] of this.staticLayers) {
            if (layerId !== 'lulc') {
                const fillLayerId = `static-${layerId}-fill`;
                states[layerId] = this.map.getLayer(fillLayerId) ? 
                    this.map.getLayoutProperty(fillLayerId, 'visibility') !== 'none' : false;
            }
        }
        
        return states;
    }

    async _restoreLulcLayer(selectedClasses) {
        if (!selectedClasses || selectedClasses.length === 0) return;
        
        const layerInfo = this.staticLayers.get('lulc');
        if (!layerInfo) return;
        
        try {
            const pmtilesUrl = apiBridge.buildStaticLayerUrl('lulc');
            
            this.map.addSource(layerInfo.sourceId, {
                type: 'vector',
                url: `pmtiles://${pmtilesUrl}`,
                minzoom: 0,
                maxzoom: 14
            });

            const colorExpression = this._buildLulcColorExpression();
            // Use 'name' property for filter
            const classFilter = ['in', ['get', 'name'], ['literal', selectedClasses]];

            this.map.addLayer({
                id: layerInfo.layerIdFill,
                type: 'fill',
                source: layerInfo.sourceId,
                'source-layer': layerInfo.layerName,
                filter: classFilter,
                paint: {
                    'fill-color': colorExpression,
                    'fill-opacity': 0.7
                }
            });

            this.map.addLayer({
                id: layerInfo.layerIdLine,
                type: 'line',
                source: layerInfo.sourceId,
                'source-layer': layerInfo.layerName,
                filter: classFilter,
                paint: {
                    'line-color': '#000000',
                    'line-width': 0.5,
                    'line-opacity': 0.5
                }
            });
            
            this.logger.success('LULC layer restored');
        } catch (error) {
            this.logger.error('Failed to restore LULC layer', error.message);
        }
    }

    async _restoreStaticLayer(layerId, layerInfo, visible) {
        if (!visible) return;
        
        try {
            const pmtilesUrl = apiBridge.buildStaticLayerUrl(layerId);
            const p = new pmtiles.PMTiles(pmtilesUrl);
            const metadata = await p.getMetadata();
            
            const layerName = metadata.vector_layers?.[0]?.id || 'default';
            const minzoom = parseInt(metadata.minzoom) || 0;
            const maxzoom = parseInt(metadata.maxzoom) || 14;

            this.map.addSource(layerInfo.sourceId, {
                type: 'vector',
                url: `pmtiles://${pmtilesUrl}`,
                minzoom,
                maxzoom
            });

            this.map.addLayer({
                id: layerInfo.layerIdFill,
                type: 'fill',
                source: layerInfo.sourceId,
                'source-layer': layerName,
                paint: {
                    'fill-color': this._getStaticLayerColor(layerId),
                    'fill-opacity': 0.6
                }
            });

            this.map.addLayer({
                id: layerInfo.layerIdLine,
                type: 'line',
                source: layerInfo.sourceId,
                'source-layer': layerName,
                paint: {
                    'line-color': '#000000',
                    'line-width': 0.5,
                    'line-opacity': 0.3
                }
            });
            
            this.logger.success(`Static layer ${layerId} restored`);
        } catch (error) {
            this.logger.error(`Failed to restore static layer ${layerId}`, error.message);
        }
    }

    updateStats() {
        this._throttledUpdateStats();
    }

    _updateStatsInternal() {
        if (!this.map?.loaded()) return;

        const activeFillId = this._getActiveFillLayerId();
        if (this.map.getLayer(activeFillId)) {
            try {
                const features = this.map.queryRenderedFeatures({ layers: [activeFillId] });
                this.statsTracker.updateFeatures(features.length);
                
                const summary = this._summarizeVisibleFlood(features);
                this.statsTracker.updateDepthRange(summary.minDepth, summary.maxDepth);
                this.statsTracker.updateAreaStats(summary.totalArea, summary.floodedArea);
            } catch {
                this._resetStats();
            }
        } else {
            this._resetStats();
        }
    }

    _resetStats() {
        this.statsTracker.updateFeatures(0);
        this.statsTracker.updateDepthRange(null, null);
        this.statsTracker.updateAreaStats(0, 0);
    }

    getMap() {
        return this.map;
    }

    hasLayer() {
        const activeFillId = this._getActiveFillLayerId();
        return this.map?.getLayer(activeFillId) != null;
    }

    _summarizeVisibleFlood(features) {
        let minDepth = null, maxDepth = null, totalArea = 0, floodedArea = 0;
        let validDepthCount = 0;

        for (const feature of features) {
            const depth = this._getDepthValue(feature?.properties);
            
            // Only process valid numeric depth values (not null, not NaN)
            if (depth !== null && typeof depth === 'number' && !isNaN(depth)) {
                validDepthCount++;
                if (minDepth === null || depth < minDepth) {
                    minDepth = depth;
                }
                if (maxDepth === null || depth > maxDepth) {
                    maxDepth = depth;
                }
                
                const featureArea = this._calculateFeatureArea(feature);
                if (featureArea > 0) {
                    totalArea += featureArea;
                    if (depth > 0.1) floodedArea += featureArea; // Consider >0.1m as flooded
                }
            }
        }

        // Use debug level to avoid cluttering activity log
        this.logger.debug(`Stats: ${validDepthCount} features with valid depth, min=${minDepth?.toFixed(3)}, max=${maxDepth?.toFixed(3)}`);
        return { minDepth, maxDepth, totalArea, floodedArea };
    }

    _calculateFeatureArea(feature) {
        if (!feature?.geometry) return 0;
        return this._calculateGeometryArea(feature.geometry);
    }

    _calculateGeometryArea(geometry) {
        if (!geometry) return 0;
        switch (geometry.type) {
            case 'Polygon':
                return this._polygonArea(geometry.coordinates);
            case 'MultiPolygon':
                return geometry.coordinates.reduce((sum, polygon) => sum + this._polygonArea(polygon), 0);
            case 'GeometryCollection':
                return (geometry.geometries || []).reduce((sum, geom) => sum + this._calculateGeometryArea(geom), 0);
            default:
                return 0;
        }
    }

    _polygonArea(rings) {
        if (!Array.isArray(rings) || !rings.length) return 0;
        return Math.abs(rings.reduce((sum, ring) => sum + this._ringArea(ring), 0));
    }

    _ringArea(coords) {
        if (!Array.isArray(coords) || coords.length < 3) return 0;
        let sum = 0;
        for (let i = 0; i < coords.length; i++) {
            const current = this._projectToMeters(coords[i]);
            const next = this._projectToMeters(coords[(i + 1) % coords.length]);
            sum += (current.x * next.y) - (next.x * current.y);
        }
        return sum / 2;
    }

    _projectToMeters(coord) {
        const [lng, lat] = coord;
        const d2r = Math.PI / 180;
        const clampedLat = Math.max(Math.min(lat, 89.9999), -89.9999);
        return {
            x: EARTH_RADIUS_METERS * lng * d2r,
            y: EARTH_RADIUS_METERS * Math.log(Math.tan(Math.PI / 4 + (clampedLat * d2r) / 2))
        };
    }

    /**
     * Get depth value from feature properties using flood_depths array
     * Handles both native arrays and JSON string arrays
     * @param {Object} properties - Feature properties
     * @returns {number|null} Depth value or null
     */
    _getDepthValue(properties) {
        if (!properties) return null;
        
        let floodDepths = properties.flood_depths;
        
        // Handle JSON string case - PMTiles may store arrays as JSON strings
        if (typeof floodDepths === 'string') {
            try {
                floodDepths = JSON.parse(floodDepths);
            } catch (e) {
                console.error('Failed to parse flood_depths:', e);
                return null;
            }
        }
        
        // Get depth from flood_depths array at current local index
        if (Array.isArray(floodDepths) && this.currentLocalIndex < floodDepths.length) {
            const value = floodDepths[this.currentLocalIndex];
            // Check for null, undefined, or non-number values
            if (value === null || value === undefined) {
                return null;
            }
            // Handle both number and string values
            const parsed = typeof value === 'number' ? value : parseFloat(value);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
        }
        
        return null;
    }

    /**
     * Setup listener to update feature states when tiles load
     * This is needed because flood_depths is stored as JSON string in PMTiles
     */
    _setupFeatureStateUpdater() {
        // Update feature states when source data changes (new tiles loaded)
        this.map.on('sourcedata', (e) => {
            // Check if it's one of our PMTiles sources
            if ((e.sourceId === 'pmtiles-source-A' || e.sourceId === 'pmtiles-source-B') && e.isSourceLoaded) {
                this._scheduleFeatureStateUpdate();
            }
        });
        
        // Also update on move end (viewport change loads new tiles)
        this.map.on('moveend', () => {
            if (this._masterPMTilesLoaded) {
                this._scheduleFeatureStateUpdate();
            }
        });
    }

    /**
     * Schedule a feature state update (debounced to avoid excessive updates)
     */
    _scheduleFeatureStateUpdate() {
        if (this._pendingFeatureStateUpdate) return;
        
        this._pendingFeatureStateUpdate = true;
        
        // Use requestAnimationFrame for smooth updates
        requestAnimationFrame(() => {
            this._updateFeatureStates();
            this._pendingFeatureStateUpdate = false;
        });
    }

    /**
     * Update feature states with depth values from flood_depths arrays
     * This extracts the depth at currentLocalIndex and sets it as feature-state
     */
    _updateFeatureStates() {
        const activeFillId = this._getActiveFillLayerId();
        const activeSourceId = this._getActiveSourceId();
        
        if (!this.map || !this.map.getLayer(activeFillId)) return;
        
        const layerName = this.currentLayerConfig?.layerName;
        if (!layerName) return;
        
        try {
            // Query all rendered features in the current viewport
            const features = this.map.queryRenderedFeatures({ layers: [activeFillId] });
            
            let updatedCount = 0;
            for (const feature of features) {
                const geoCode = feature.properties?.geo_code;
                if (!geoCode) continue;
                
                // Get depth value at current index
                const depth = this._getDepthValue(feature.properties);
                
                // Set feature state
                this.map.setFeatureState(
                    { source: activeSourceId, sourceLayer: layerName, id: geoCode },
                    { depth: depth ?? 0 }
                );
                updatedCount++;
            }
            
            if (updatedCount > 0) {
                this.logger.debug(`Updated ${updatedCount} feature states for index ${this.currentLocalIndex}`);
            }
        } catch (error) {
            this.logger.error('Failed to update feature states', error.message);
        }
    }

    /**
     * Get fill color expression based on feature-state depth
     * This is used because MapLibre can't parse JSON string arrays in expressions
     */
    _getFeatureStateColorExpression(layerType = 'multiclass') {
        // Use feature-state 'depth' which is set by _updateFeatureStates
        const depthValue = ['coalesce', ['feature-state', 'depth'], 0];
        
        if (layerType === 'binary') {
            return [
                'case',
                // If depth is 0 or less, transparent
                ['<=', depthValue, 0], 'rgba(0, 0, 0, 0)',
                // Flooded (>1m) - red
                ['>', depthValue, 1], '#ef4444',
                // Not flooded - green
                '#10b981'
            ];
        }
        
        // Multiclass - gradient based on depth
        return [
            'case',
            // If depth is 0 or less, transparent
            ['<=', depthValue, 0], 'rgba(0, 0, 0, 0)',
            // Normal interpolation for valid depth values
            [
                'interpolate', ['linear'], depthValue,
                0.001, '#f5fbff',
                0.2, '#d6ecff',
                0.5, '#9dd1ff',
                1.0, '#5aa8ff',
                2.0, '#1e6ddf',
                3.0, '#0b3a8c'
            ]
        ];
    }

    /**
     * Legacy method - kept for compatibility but now unused
     * @deprecated Use _getFeatureStateColorExpression instead
     */
    _getDepthExpression(localIndex = 0) {
        // This doesn't work with JSON string arrays in PMTiles
        // Kept for reference only
        const index = typeof localIndex === 'number' ? localIndex : this.currentLocalIndex || 0;
        return ['at', index, ['get', 'flood_depths']];
    }

    /**
     * Legacy method - kept for compatibility
     * @deprecated Use _getFeatureStateColorExpression instead
     */
    _getFillColorExpression(depthExpression, layerType = 'multiclass') {
        // Delegate to feature-state based expression
        return this._getFeatureStateColorExpression(layerType);
    }

    /**
     * Cleanup resources
     */
    destroy() {
        if (this.map) {
            this.map.remove();
            this.map = null;
        }
    }
}

export default MapManager;
