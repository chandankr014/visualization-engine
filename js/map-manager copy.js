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
        
        // Base map styles
        this.baseStyles = {
            light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
            dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
            openstreetmap: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
            satellite: `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`,
            topo: `https://api.maptiler.com/maps/topo/style.json?key=${MAPTILER_KEY}`,
        };

        // Property name for geo_code (unique identifier for each cell)
        this.geoCodeProperty = 'geo_code';
        
        // Throttled functions
        this._throttledMouseMove = throttle(this._handleMouseMove.bind(this), 100);
        this._throttledUpdateStats = throttle(this._updateStatsInternal.bind(this), 2000);
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

    async loadHotspots() {
        if (this.hotspotsData) {
            this.logger.info('Hotspots already loaded');
            return true;
        }

        try {
            this.logger.info('Loading hotspots...');
            const response = await apiBridge.getHotspots();
            
            if (!response.success || !response.data) {
                throw new Error('Failed to load hotspots');
            }

            this.hotspotsData = response.data;
            this.logger.success('Hotspots loaded');
            return true;
        } catch (error) {
            this.logger.error('Failed to load hotspots', error.message);
            return false;
        }
    }

    async addHotspots() {
        if (!this.map || !this.hotspotsData) {
            this.logger.error('Map or hotspots not ready');
            return false;
        }

        try {
            // Remove existing hotspot layers if present
            if (this.map.getLayer('hotspots-circle')) {
                this.map.removeLayer('hotspots-circle');
            }
            if (this.map.getLayer('hotspots-label')) {
                this.map.removeLayer('hotspots-label');
            }
            if (this.map.getSource('hotspots')) {
                this.map.removeSource('hotspots');
            }

            // Add source
            this.map.addSource('hotspots', {
                type: 'geojson',
                data: this.hotspotsData
            });

            // Add circle layer for hotspot markers
            this.map.addLayer({
                id: 'hotspots-circle',
                type: 'circle',
                source: 'hotspots',
                paint: {
                    'circle-radius': 8,
                    'circle-color': '#dc2626',
                    'circle-stroke-width': 2,
                    'circle-stroke-color': '#ffffff',
                    'circle-opacity': 0.9
                }
            });

            // Add label layer for hotspot names
            this.map.addLayer({
                id: 'hotspots-label',
                type: 'symbol',
                source: 'hotspots',
                layout: {
                    'text-field': ['get', 'Points'],
                    'text-size': 11,
                    'text-offset': [0, 1.5],
                    'text-anchor': 'top'
                },
                paint: {
                    'text-color': '#1f2937',
                    'text-halo-color': '#ffffff',
                    'text-halo-width': 1.5
                }
            });

            this.logger.success('Hotspots added');
            return true;
        } catch (error) {
            this.logger.error('Failed to add hotspots', error.message);
            return false;
        }
    }

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

    async loadPMTiles(timeSlot) {
        if (!this.map) {
            this.logger.error('Map not initialized');
            return false;
        }
        
        // If master PMTiles is already loaded, just switch the time property
        if (this._masterPMTilesLoaded) {
            return this.switchTimeSlot(timeSlot);
        }
        
        if (this._isLoading) {
            this.logger.warning('Load already in progress');
            return false;
        }

        this._isLoading = true;
        this.logger.info(`Loading master PMTiles file...`);
        const mapState = this._saveMapState();
        const loadStartTime = performance.now();

        try {
            // Use master PMTiles URL
            const pmtilesUrl = apiBridge.getMasterPMTilesUrl();
            
            this._removeExistingLayers();

            const p = new pmtiles.PMTiles(pmtilesUrl);
            const [metadata, header] = await Promise.all([p.getMetadata(), p.getHeader()]);
            
            this.statsTracker.updatePMTilesSize(header.rootLength || 0);

            // Parse bounds
            let bounds = this._parseBounds(metadata.bounds);
            const layerName = metadata.vector_layers?.[0]?.id || 'final_gdf_epsg4326';
            const minzoom = parseInt(metadata.minzoom) || 0;
            const maxzoom = parseInt(metadata.maxzoom) || 14;

            // Add source
            this.map.addSource('pmtiles-source', {
                type: 'vector',
                url: `pmtiles://${pmtilesUrl}`,
                minzoom,
                maxzoom
            });

            // Store current depth property (time slot)
            this.currentDepthProperty = timeSlot;

            // Add layers with the specific time property
            const depthExpression = this._getDepthExpression(timeSlot);
            const fillColorExpression = this._getFillColorExpression(depthExpression, this.currentLayerType);
            
            const fillLayerConfig = {
                id: 'pmtiles-layer',
                type: 'fill',
                source: 'pmtiles-source',
                'source-layer': layerName,
                paint: {
                    'fill-color': fillColorExpression,
                    'fill-opacity': 1
                }
            };
            this.map.addLayer(fillLayerConfig);
            
            // Store config for style changes
            this.currentLayerConfig = {
                fill: fillLayerConfig,
                layerName,
                sourceConfig: {
                    type: 'vector',
                    url: `pmtiles://${pmtilesUrl}`,
                    minzoom,
                    maxzoom
                }
            };

            // Add outline layer (hidden by default)
            this.map.addLayer({
                id: 'pmtiles-outline',
                type: 'line',
                source: 'pmtiles-source',
                'source-layer': layerName,
                paint: {
                    'line-color': '#0f172a',
                    'line-width': 0,
                    'line-opacity': 0
                }
            });

            // Restore or fit map view
            this._restoreOrFitBounds(mapState, bounds);

            // Setup handlers once
            if (!this._handlersSetup) {
                this._setupClickHandler();
                this._setupCursorInteractions();
                this._handlersSetup = true;
            }
            
            this._masterPMTilesLoaded = true;
            
            const loadTime = (performance.now() - loadStartTime) / 1000;
            this.statsTracker.updateLoadTime(loadTime);
            this.logger.success(`Master PMTiles loaded in ${loadTime.toFixed(2)}s`);
            eventBus.emit(AppEvents.MAP_LAYER_LOADED, { timeSlot, loadTime });
            
            return true;

        } catch (error) {
            this.logger.error(`Failed to load master PMTiles`, error.message);
            eventBus.emit(AppEvents.MAP_LAYER_ERROR, { timeSlot, error });
            return false;
        } finally {
            this._isLoading = false;
        }
    }

    /**
     * Switch to a different time slot without reloading geometry
     * @param {string} timeSlot - The depth property name (e.g., 'D202512101000')
     */
    switchTimeSlot(timeSlot) {
        if (!this.map || !this._masterPMTilesLoaded) {
            this.logger.error('Master PMTiles not loaded');
            return false;
        }

        if (!this.map.getLayer('pmtiles-layer')) {
            this.logger.error('PMTiles layer not found');
            return false;
        }

        try {
            const switchStartTime = performance.now();
            
            // Update current depth property
            this.currentDepthProperty = timeSlot;
            
            // Create new depth expression for this time slot
            const depthExpression = this._getDepthExpression(timeSlot);
            const fillColorExpression = this._getFillColorExpression(depthExpression, this.currentLayerType);
            
            // Update the fill-color paint property (no geometry reload!)
            this.map.setPaintProperty('pmtiles-layer', 'fill-color', fillColorExpression);
            
            // Update stored config
            if (this.currentLayerConfig?.fill) {
                this.currentLayerConfig.fill.paint['fill-color'] = fillColorExpression;
            }
            
            const switchTime = (performance.now() - switchStartTime) / 1000;
            this.logger.info(`Switched to ${timeSlot} in ${switchTime.toFixed(3)}s`);
            eventBus.emit(AppEvents.MAP_LAYER_LOADED, { timeSlot, loadTime: switchTime, switchOnly: true });
            
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
        
        if (this.map.getLayer('pmtiles-layer')) {
            const depthExpression = this._getDepthExpression(this.currentDepthProperty);
            const fillColorExpression = this._getFillColorExpression(depthExpression, layerType);
            this.map.setPaintProperty('pmtiles-layer', 'fill-color', fillColorExpression);
            this.logger.success(`Layer updated to ${layerType}`);
        }
    }

    _removeExistingLayers() {
        ['pmtiles-layer', 'pmtiles-outline'].forEach(id => {
            if (this.map.getLayer(id)) this.map.removeLayer(id);
        });
        if (this.map.getSource('pmtiles-source')) {
            this.map.removeSource('pmtiles-source');
        }
        // Reset master loaded flag since we removed the layers
        this._masterPMTilesLoaded = false;
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
        this.map.on('click', 'pmtiles-layer', (e) => {
            if (!e.features?.[0]) return;
            
            const properties = e.features[0].properties;
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
        let html = `<div style="font-weight: 600; margin-bottom: 8px; font-size: 14px;">📍 Flood Depth at ${timeLabel}</div>`;
        
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
        return { color: '#f5fbff', label: 'Minor', textColor: '#0f172a' };
    }

    _setupCursorInteractions() {
        this.map.on('mouseenter', 'pmtiles-layer', () => {
            this.map.getCanvas().style.cursor = 'pointer';
        });
        this.map.on('mouseleave', 'pmtiles-layer', () => {
            this.map.getCanvas().style.cursor = '';
        });
    }

    setLayerOpacity(opacity) {
        if (this.map?.getLayer('pmtiles-layer')) {
            this.map.setPaintProperty('pmtiles-layer', 'fill-opacity', opacity);
        }
    }

    changeBaseStyle(style) {
        if (!this.map || !this.baseStyles[style]) return;

        this.logger.info(`Changing base style to: ${style}`);
        const mapState = this._saveMapState();
        
        // Store current layer visibility states
        const layerStates = this._saveLayerStates();
        
        // Store current depth property before style change
        const currentDepthProp = this.currentDepthProperty;
        
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
            
            // Re-add PMTiles layers with current depth property
            if (this.currentLayerConfig) {
                try {
                    this.map.addSource('pmtiles-source', this.currentLayerConfig.sourceConfig);
                    
                    // Update fill config with current depth property
                    const depthExpression = this._getDepthExpression(currentDepthProp);
                    const fillColorExpression = this._getFillColorExpression(depthExpression, this.currentLayerType);
                    this.currentLayerConfig.fill.paint['fill-color'] = fillColorExpression;
                    
                    this.map.addLayer(this.currentLayerConfig.fill);
                    this.map.addLayer({
                        id: 'pmtiles-outline',
                        type: 'line',
                        source: 'pmtiles-source',
                        'source-layer': this.currentLayerConfig.layerName,
                        paint: {
                            'line-color': '#0f172a',
                            'line-width': 0,
                            'line-opacity': 0
                        }
                    });
                    
                    this._masterPMTilesLoaded = true;
                    this.currentDepthProperty = currentDepthProp;
                    
                    if (!layerStates.floodDepth) {
                        this.map.setLayoutProperty('pmtiles-layer', 'visibility', 'none');
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
        const states = {
            wardBoundaries: this.map.getLayer('ward-outline') ? 
                this.map.getLayoutProperty('ward-outline', 'visibility') !== 'none' : false,
            floodDepth: this.map.getLayer('pmtiles-layer') ? 
                this.map.getLayoutProperty('pmtiles-layer', 'visibility') !== 'none' : true,
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

        if (this.map.getLayer('pmtiles-layer')) {
            try {
                const features = this.map.queryRenderedFeatures({ layers: ['pmtiles-layer'] });
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
        return this.map?.getLayer('pmtiles-layer') != null;
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

    _getDepthExpression(timeSlot = null) {
        // Use the specific time slot property (e.g., 'D202512101000')
        const property = timeSlot || this.currentDepthProperty || 'D202512101000';
        // Return raw property value - will be handled in fill color expression
        return ['get', property];
    }

    _getFillColorExpression(depthExpression, layerType = 'multiclass') {
        // Check if the value is null or not a valid number
        const hasValidDepth = [
            'all',
            ['!=', depthExpression, null],
            ['==', ['typeof', depthExpression], 'number']
        ];
        
        if (layerType === 'binary') {
            return [
                'case',
                ['!', hasValidDepth], 'rgba(0, 0, 0, 0)', // No data - fully transparent
                ['<=', ['to-number', depthExpression, 0], 0], 'rgba(0, 0, 0, 0)', // Zero depth - fully transparent
                ['>', ['to-number', depthExpression, 0], 1], '#ef4444', // Flooded (>1m) - red
                '#10b981' // Not flooded - green
            ];
        }
        
        // Multiclass - gradient based on depth
        // Handle null/invalid/zero values by showing fully transparent
        return [
            'case',
            ['!', hasValidDepth], 'rgba(0, 0, 0, 0)', // No data - fully transparent
            ['<=', ['to-number', depthExpression, 0], 0], 'rgba(0, 0, 0, 0)', // Zero depth - fully transparent
            [
                'interpolate', ['linear'], ['to-number', depthExpression, 0],
                0.001, '#f5fbff',
                0.2, '#d6ecff',
                0.5, '#9dd1ff',
                1.0, '#5aa8ff',
                2.0, '#1e6ddf',
                3.0, '#0b3a8c'
            ]
        ];
    }

    _getDepthValue(properties) {
        if (!properties) return null;
        
        // Get the current time slot property value
        if (this.currentDepthProperty) {
            const value = properties[this.currentDepthProperty];
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
