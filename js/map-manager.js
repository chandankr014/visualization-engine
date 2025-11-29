/**
 * Map Manager Module
 * Handles MapLibre GL initialization and PMTiles loading.
 * Optimized for performance with throttling, caching, and efficient rendering.
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
        
        // Base map styles
        this.baseStyles = {
            light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
            dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
            openstreetmap: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
            satellite: `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`,
            topo: `https://api.maptiler.com/maps/topo/style.json?key=${MAPTILER_KEY}`,
        };

        // Property name candidates for flood depth
        this.depthPropertyCandidates = [
            'depth', 'Depth', 'DEPTH', 'depth_m', 'Depth_m',
            'water_depth', 'Water Depth', 'Water_Depth',
            'Total water', 'Total_water', 'TotalWater',
            'Total wate', 'Total_wate', 'Total watr'
        ];
        
        // Throttled functions
        this._throttledMouseMove = throttle(this._handleMouseMove.bind(this), 50);
        this._throttledUpdateStats = throttle(this._updateStatsInternal.bind(this), 500);
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
        
        if (this._isLoading) {
            this.logger.warning('Load already in progress');
            return false;
        }

        this._isLoading = true;
        this.logger.info(`Loading PMTiles: ${timeSlot}`);
        const mapState = this._saveMapState();
        const loadStartTime = performance.now();

        try {
            const pmtilesUrl = apiBridge.buildPMTilesUrl(timeSlot);
            
            this._removeExistingLayers();

            const p = new pmtiles.PMTiles(pmtilesUrl);
            const [metadata, header] = await Promise.all([p.getMetadata(), p.getHeader()]);
            
            this.statsTracker.updatePMTilesSize(header.rootLength || 0);

            // Parse bounds
            let bounds = this._parseBounds(metadata.bounds);
            const layerName = metadata.vector_layers?.[0]?.id || 'gridded_data';
            const minzoom = parseInt(metadata.minzoom) || 0;
            const maxzoom = parseInt(metadata.maxzoom) || 14;

            // Add source
            this.map.addSource('pmtiles-source', {
                type: 'vector',
                url: `pmtiles://${pmtilesUrl}`,
                minzoom,
                maxzoom
            });

            // Add layers
            const depthExpression = this._getDepthExpression();
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
            
            const loadTime = (performance.now() - loadStartTime) / 1000;
            this.statsTracker.updateLoadTime(loadTime);
            this.logger.success(`PMTiles loaded in ${loadTime.toFixed(2)}s`);
            eventBus.emit(AppEvents.MAP_LAYER_LOADED, { timeSlot, loadTime });
            
            return true;

        } catch (error) {
            this.logger.error(`Failed to load PMTiles: ${timeSlot}`, error.message);
            eventBus.emit(AppEvents.MAP_LAYER_ERROR, { timeSlot, error });
            return false;
        } finally {
            this._isLoading = false;
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
            const depthExpression = this._getDepthExpression();
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
        let html = '<div style="font-weight: 600; margin-bottom: 8px; font-size: 14px;">Flood Depth Data</div>';
        
        if (depth !== null) {
            const { color, label, textColor } = this._getDepthStyle(depth);
            html += `
                <div style="background: ${color}; color: ${textColor}; padding: 8px; margin-bottom: 8px; border-radius: 4px; text-align: center;">
                    <div style="font-size: 11px; opacity: 0.9;">Flood Depth - ${label}</div>
                    <div style="font-size: 20px; font-weight: bold;">${depth.toFixed(2)} m</div>
                </div>
            `;
        }
        
        // Show key properties
        const displayProps = Object.entries(properties).slice(0, 5);
        for (const [key, value] of displayProps) {
            html += `
                <div style="display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #e2e8f0; font-size: 12px;">
                    <span style="color: #718096;">${key}:</span>
                    <span style="font-weight: 600; margin-left: 8px;">${value}</span>
                </div>
            `;
        }
        
        return html;
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
        
        this.map.setStyle(this.baseStyles[style]);

        this.map.once('style.load', () => {
            this.logger.success('Base style loaded');
            
            // Restore map state
            if (mapState.hasState) {
                this._restoreMapState(mapState);
            }
            
            // Re-add PMTiles layers
            if (this.currentLayerConfig) {
                try {
                    this.map.addSource('pmtiles-source', this.currentLayerConfig.sourceConfig);
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
                    this.logger.success('PMTiles layers restored');
                } catch (error) {
                    this.logger.error('Failed to restore layers', error.message);
                }
            }
        });
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

        // Update tile count
        const source = this.map.getSource('pmtiles-source');
        const tileCount = source?._tiles ? Object.keys(source._tiles).length : 0;
        this.statsTracker.updateTiles(tileCount);
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

        for (const feature of features) {
            const depth = this._getDepthValue(feature?.properties);
            if (depth !== null) {
                minDepth = minDepth === null ? depth : Math.min(minDepth, depth);
                maxDepth = maxDepth === null ? depth : Math.max(maxDepth, depth);
            }

            const featureArea = this._calculateFeatureArea(feature);
            if (featureArea > 0) {
                totalArea += featureArea;
                if (depth !== null && depth > 1) floodedArea += featureArea;
            }
        }

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

    _getDepthExpression() {
        return [
            'to-number',
            ['coalesce', ...this.depthPropertyCandidates.map(prop => ['get', prop]), 0],
            0
        ];
    }

    _getFillColorExpression(depthExpression, layerType = 'multiclass') {
        if (layerType === 'binary') {
            return ['case', ['>', depthExpression, 1], '#ef4444', '#10b981'];
        }
        return [
            'interpolate', ['linear'], depthExpression,
            0, '#f5fbff',
            0.2, '#d6ecff',
            0.5, '#9dd1ff',
            1.0, '#5aa8ff',
            2.0, '#1e6ddf',
            3.0, '#0b3a8c'
        ];
    }

    _getDepthValue(properties) {
        if (!properties) return null;
        for (const prop of this.depthPropertyCandidates) {
            const value = properties[prop];
            if (value !== undefined && value !== null && value !== '') {
                const parsed = parseFloat(value);
                if (!Number.isNaN(parsed)) return parsed;
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
