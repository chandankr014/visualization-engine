/**
 * Polygon Analytics Module
 * Handles polygon drawing, flood depth analysis, and time-series visualization.
 */

import { eventBus, AppEvents } from './event-bus.js';
import apiBridge from './api-bridge.js';

// Turf.js-like area calculation for polygons
const EARTH_RADIUS_METERS = 6378137;

class PolygonAnalytics {
    constructor(mapManager, timeController, logger) {
        this.mapManager = mapManager;
        this.timeController = timeController;
        this.logger = logger;
        this.map = null;
        
        // Drawing state
        this.isDrawing = false;
        this.currentPolygon = null;
        this.drawingPoints = [];
        
        // Analysis data cache
        this.analysisCache = new Map();
        
        // Popup element
        this.popupPanel = null;
        this.chartInstance = null;
        
        // Property name candidates (from map-manager)
        this.depthPropertyCandidates = [
            'depth', 'Depth', 'DEPTH', 'depth_m', 'Depth_m',
            'water_depth', 'Water Depth', 'Water_Depth',
            'Total water', 'Total_water', 'TotalWater',
            'Total wate', 'Total_wate', 'Total watr'
        ];
        
        // Bind methods
        this._handleMapClick = this._handleMapClick.bind(this);
        this._handleMouseMove = this._handleMouseMove.bind(this);
        this._handleKeyDown = this._handleKeyDown.bind(this);
    }

    /**
     * Initialize polygon analytics
     */
    init() {
        this.map = this.mapManager.getMap();
        if (!this.map) {
            this.logger.error('Map not available for polygon analytics');
            return;
        }

        this._createDrawingControl();
        this._createPopupPanel();
        this._setupEventListeners();
        
        this.logger.success('Polygon analytics initialized');
    }

    /**
     * Create drawing control button
     */
    _createDrawingControl() {
        const controlContainer = document.createElement('div');
        controlContainer.className = 'maplibregl-ctrl maplibregl-ctrl-group polygon-draw-control';
        controlContainer.innerHTML = `
            <button class="polygon-draw-btn" title="Draw polygon for analysis (Press 'P' to toggle)">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="12,2 22,8.5 22,15.5 12,22 2,15.5 2,8.5"></polygon>
                </svg>
            </button>
        `;
        
        const btn = controlContainer.querySelector('.polygon-draw-btn');
        btn.addEventListener('click', () => this.toggleDrawMode());
        
        // Add to map
        const navControl = document.querySelector('.maplibregl-ctrl-bottom-right');
        if (navControl) {
            navControl.insertBefore(controlContainer, navControl.firstChild);
        }
        
        this.drawButton = btn;
    }

    /**
     * Create popup panel for analysis results
     */
    _createPopupPanel() {
        const panel = document.createElement('div');
        panel.className = 'polygon-analytics-panel';
        panel.innerHTML = `
            <div class="panel-header">
                <h3>📊 Polygon Analysis</h3>
                <button class="panel-close-btn" title="Close panel">×</button>
            </div>
            <div class="panel-content">
                <div class="area-stats">
                    <div class="area-stat-item">
                        <span class="stat-label">Total Area</span>
                        <span class="stat-value" id="polygonTotalArea">--</span>
                    </div>
                    <div class="area-stat-item">
                        <span class="stat-label">Flooded Area</span>
                        <span class="stat-value" id="polygonFloodedArea">--</span>
                    </div>
                    <div class="area-stat-item">
                        <span class="stat-label">Flood %</span>
                        <span class="stat-value" id="polygonFloodPercent">--</span>
                    </div>
                </div>
                <div class="depth-stats">
                    <div class="depth-stat-box min">
                        <span class="depth-label">Min Depth</span>
                        <span class="depth-value" id="polygonMinDepth">--</span>
                        <span class="depth-unit">m</span>
                    </div>
                    <div class="depth-stat-box mean">
                        <span class="depth-label">Mean Depth</span>
                        <span class="depth-value" id="polygonMeanDepth">--</span>
                        <span class="depth-unit">m</span>
                    </div>
                    <div class="depth-stat-box max">
                        <span class="depth-label">Max Depth</span>
                        <span class="depth-value" id="polygonMaxDepth">--</span>
                        <span class="depth-unit">m</span>
                    </div>
                </div>
                <div class="chart-container">
                    <h4>Time Series Analysis</h4>
                    <div class="chart-legend">
                        <span class="legend-item depth-legend"><span class="legend-color"></span>Flood Depth (%)</span>
                        <span class="legend-item precip-legend"><span class="legend-color"></span>Precipitation (cm)</span>
                    </div>
                    <canvas id="timeSeriesChart" width="500" height="200"></canvas>
                </div>
                <div class="panel-actions">
                    <button class="action-btn clear-polygon-btn">🗑️ Clear Polygon</button>
                    <button class="action-btn analyze-all-btn">📈 Analyze All Times</button>
                </div>
            </div>
        `;
        
        panel.style.display = 'none';
        document.querySelector('.map-wrapper').appendChild(panel);
        this.popupPanel = panel;
        
        // Event listeners
        panel.querySelector('.panel-close-btn').addEventListener('click', () => this.hidePanel());
        panel.querySelector('.clear-polygon-btn').addEventListener('click', () => this.clearPolygon());
        panel.querySelector('.analyze-all-btn').addEventListener('click', () => this.analyzeAllTimeSlots());
    }

    /**
     * Setup event listeners
     */
    _setupEventListeners() {
        // Keyboard shortcut for draw mode
        document.addEventListener('keydown', this._handleKeyDown);
        
        // Listen for time changes to update analysis
        eventBus.on(AppEvents.TIME_CHANGE, ({ timeSlot }) => {
            if (this.currentPolygon) {
                setTimeout(() => this._analyzePolygon(), 500);
            }
        });
    }

    /**
     * Handle keyboard shortcuts
     */
    _handleKeyDown(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        
        if (e.key === 'p' || e.key === 'P') {
            e.preventDefault();
            this.toggleDrawMode();
        } else if (e.key === 'Escape' && this.isDrawing) {
            this.cancelDrawing();
        } else if (e.key === 'Enter' && this.isDrawing && this.drawingPoints.length >= 3) {
            this.finishDrawing();
        }
    }

    /**
     * Toggle draw mode
     */
    toggleDrawMode() {
        if (this.isDrawing) {
            this.cancelDrawing();
        } else {
            this.startDrawing();
        }
    }

    /**
     * Start polygon drawing mode
     */
    startDrawing() {
        this.isDrawing = true;
        this.drawingPoints = [];
        
        // Update button state
        this.drawButton?.classList.add('active');
        this.map.getCanvas().style.cursor = 'crosshair';
        
        // Add drawing layers
        this._addDrawingLayers();
        
        // Attach event listeners
        this.map.on('click', this._handleMapClick);
        this.map.on('mousemove', this._handleMouseMove);
        
        eventBus.emit(AppEvents.POLYGON_DRAW_START);
        this.logger.info('Drawing mode enabled. Click to add points, Enter to finish, Escape to cancel.');
    }

    /**
     * Cancel drawing
     */
    cancelDrawing() {
        this.isDrawing = false;
        this.drawingPoints = [];
        
        this.drawButton?.classList.remove('active');
        this.map.getCanvas().style.cursor = '';
        
        this._removeDrawingLayers();
        
        this.map.off('click', this._handleMapClick);
        this.map.off('mousemove', this._handleMouseMove);
        
        this.logger.info('Drawing cancelled');
    }

    /**
     * Finish drawing and analyze
     */
    finishDrawing() {
        if (this.drawingPoints.length < 3) {
            this.logger.warning('Need at least 3 points to create a polygon');
            return;
        }
        
        this.isDrawing = false;
        this.drawButton?.classList.remove('active');
        this.map.getCanvas().style.cursor = '';
        
        this.map.off('click', this._handleMapClick);
        this.map.off('mousemove', this._handleMouseMove);
        
        // Close the polygon
        const closedPoints = [...this.drawingPoints, this.drawingPoints[0]];
        this.currentPolygon = {
            type: 'Feature',
            geometry: {
                type: 'Polygon',
                coordinates: [closedPoints]
            },
            properties: {}
        };
        
        // Update the polygon layer
        this._updatePolygonLayer();
        
        // Analyze the polygon
        this._analyzePolygon();
        
        eventBus.emit(AppEvents.POLYGON_DRAW_END, { polygon: this.currentPolygon });
        this.logger.success('Polygon created with ' + this.drawingPoints.length + ' points');
    }

    /**
     * Handle map click during drawing
     */
    _handleMapClick(e) {
        if (!this.isDrawing) return;
        
        const point = [e.lngLat.lng, e.lngLat.lat];
        this.drawingPoints.push(point);
        
        this._updateDrawingLayers();
    }

    /**
     * Handle mouse move during drawing
     */
    _handleMouseMove(e) {
        if (!this.isDrawing || this.drawingPoints.length === 0) return;
        
        const previewPoints = [...this.drawingPoints, [e.lngLat.lng, e.lngLat.lat]];
        
        // Update preview line
        const source = this.map.getSource('drawing-preview');
        if (source) {
            source.setData({
                type: 'Feature',
                geometry: {
                    type: 'LineString',
                    coordinates: previewPoints
                }
            });
        }
    }

    /**
     * Add drawing layers
     */
    _addDrawingLayers() {
        // Drawing points
        if (!this.map.getSource('drawing-points')) {
            this.map.addSource('drawing-points', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
            
            this.map.addLayer({
                id: 'drawing-points-layer',
                type: 'circle',
                source: 'drawing-points',
                paint: {
                    'circle-radius': 6,
                    'circle-color': '#3b82f6',
                    'circle-stroke-color': '#ffffff',
                    'circle-stroke-width': 2
                }
            });
        }
        
        // Drawing line
        if (!this.map.getSource('drawing-line')) {
            this.map.addSource('drawing-line', {
                type: 'geojson',
                data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }
            });
            
            this.map.addLayer({
                id: 'drawing-line-layer',
                type: 'line',
                source: 'drawing-line',
                paint: {
                    'line-color': '#3b82f6',
                    'line-width': 2,
                    'line-dasharray': [2, 2]
                }
            });
        }
        
        // Preview line
        if (!this.map.getSource('drawing-preview')) {
            this.map.addSource('drawing-preview', {
                type: 'geojson',
                data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } }
            });
            
            this.map.addLayer({
                id: 'drawing-preview-layer',
                type: 'line',
                source: 'drawing-preview',
                paint: {
                    'line-color': '#94a3b8',
                    'line-width': 2,
                    'line-dasharray': [4, 4]
                }
            });
        }
        
        // Analysis polygon
        if (!this.map.getSource('analysis-polygon')) {
            this.map.addSource('analysis-polygon', {
                type: 'geojson',
                data: { type: 'FeatureCollection', features: [] }
            });
            
            this.map.addLayer({
                id: 'analysis-polygon-fill',
                type: 'fill',
                source: 'analysis-polygon',
                paint: {
                    'fill-color': '#3b82f6',
                    'fill-opacity': 0.2
                }
            });
            
            this.map.addLayer({
                id: 'analysis-polygon-outline',
                type: 'line',
                source: 'analysis-polygon',
                paint: {
                    'line-color': '#1d4ed8',
                    'line-width': 3
                }
            });
        }
    }

    /**
     * Remove drawing layers
     */
    _removeDrawingLayers() {
        ['drawing-points-layer', 'drawing-line-layer', 'drawing-preview-layer'].forEach(layerId => {
            if (this.map.getLayer(layerId)) {
                this.map.removeLayer(layerId);
            }
        });
        
        ['drawing-points', 'drawing-line', 'drawing-preview'].forEach(sourceId => {
            if (this.map.getSource(sourceId)) {
                this.map.removeSource(sourceId);
            }
        });
    }

    /**
     * Update drawing layers with current points
     */
    _updateDrawingLayers() {
        // Update points
        const pointsSource = this.map.getSource('drawing-points');
        if (pointsSource) {
            pointsSource.setData({
                type: 'FeatureCollection',
                features: this.drawingPoints.map(pt => ({
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: pt }
                }))
            });
        }
        
        // Update line
        const lineSource = this.map.getSource('drawing-line');
        if (lineSource && this.drawingPoints.length > 1) {
            lineSource.setData({
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: this.drawingPoints }
            });
        }
    }

    /**
     * Update polygon layer with final polygon
     */
    _updatePolygonLayer() {
        this._removeDrawingLayers();
        
        // Add layers if needed
        this._addDrawingLayers();
        
        const source = this.map.getSource('analysis-polygon');
        if (source && this.currentPolygon) {
            source.setData(this.currentPolygon);
        }
        
        // Add click handler for polygon
        this.map.on('click', 'analysis-polygon-fill', () => {
            this.showPanel();
        });
        
        this.map.on('mouseenter', 'analysis-polygon-fill', () => {
            this.map.getCanvas().style.cursor = 'pointer';
        });
        
        this.map.on('mouseleave', 'analysis-polygon-fill', () => {
            this.map.getCanvas().style.cursor = '';
        });
    }

    /**
     * Clear polygon
     */
    clearPolygon() {
        this.currentPolygon = null;
        this.drawingPoints = [];
        this.analysisCache.clear();
        
        const source = this.map.getSource('analysis-polygon');
        if (source) {
            source.setData({ type: 'FeatureCollection', features: [] });
        }
        
        this.hidePanel();
        eventBus.emit(AppEvents.POLYGON_CLEARED);
        this.logger.info('Polygon cleared');
    }

    /**
     * Analyze polygon for current time slot
     */
    _analyzePolygon() {
        if (!this.currentPolygon || !this.map.getLayer('pmtiles-layer')) {
            return;
        }
        
        // Query features within the polygon bounds
        const bounds = this._getPolygonBounds();
        const features = this.map.queryRenderedFeatures(
            [
                this.map.project([bounds.minLng, bounds.maxLat]),
                this.map.project([bounds.maxLng, bounds.minLat])
            ],
            { layers: ['pmtiles-layer'] }
        );
        
        // Filter features that intersect with polygon
        const intersectingFeatures = features.filter(f => 
            this._featureIntersectsPolygon(f, this.currentPolygon.geometry.coordinates[0])
        );
        
        // Calculate statistics
        const stats = this._calculateStats(intersectingFeatures);
        
        // Update UI
        this._updateStatsUI(stats);
        this.showPanel();
    }

    /**
     * Get polygon bounding box
     */
    _getPolygonBounds() {
        const coords = this.currentPolygon.geometry.coordinates[0];
        let minLng = Infinity, maxLng = -Infinity;
        let minLat = Infinity, maxLat = -Infinity;
        
        coords.forEach(([lng, lat]) => {
            minLng = Math.min(minLng, lng);
            maxLng = Math.max(maxLng, lng);
            minLat = Math.min(minLat, lat);
            maxLat = Math.max(maxLat, lat);
        });
        
        return { minLng, maxLng, minLat, maxLat };
    }

    /**
     * Check if feature intersects with polygon (simplified point-in-polygon)
     */
    _featureIntersectsPolygon(feature, polygonCoords) {
        if (!feature.geometry) return false;
        
        // Get centroid of feature
        const centroid = this._getFeatureCentroid(feature);
        if (!centroid) return false;
        
        return this._pointInPolygon(centroid, polygonCoords);
    }

    /**
     * Get centroid of a feature
     */
    _getFeatureCentroid(feature) {
        const geom = feature.geometry;
        if (!geom) return null;
        
        if (geom.type === 'Point') {
            return geom.coordinates;
        } else if (geom.type === 'Polygon') {
            return this._polygonCentroid(geom.coordinates[0]);
        } else if (geom.type === 'MultiPolygon') {
            return this._polygonCentroid(geom.coordinates[0][0]);
        }
        return null;
    }

    /**
     * Calculate polygon centroid
     */
    _polygonCentroid(coords) {
        let sumX = 0, sumY = 0;
        for (const [x, y] of coords) {
            sumX += x;
            sumY += y;
        }
        return [sumX / coords.length, sumY / coords.length];
    }

    /**
     * Point in polygon test (ray casting)
     */
    _pointInPolygon(point, polygon) {
        const [x, y] = point;
        let inside = false;
        
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const [xi, yi] = polygon[i];
            const [xj, yj] = polygon[j];
            
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        
        return inside;
    }

    /**
     * Calculate statistics from features
     */
    _calculateStats(features) {
        let minDepth = Infinity;
        let maxDepth = -Infinity;
        let sumDepth = 0;
        let depthCount = 0;
        let totalArea = 0;
        let floodedArea = 0;
        
        features.forEach(feature => {
            const depth = this._getDepthValue(feature.properties);
            const area = this._calculateFeatureArea(feature);
            
            if (depth !== null && !isNaN(depth)) {
                minDepth = Math.min(minDepth, depth);
                maxDepth = Math.max(maxDepth, depth);
                sumDepth += depth;
                depthCount++;
                
                if (depth > 0.1) { // Consider flooded if depth > 0.1m
                    floodedArea += area;
                }
            }
            
            totalArea += area;
        });
        
        // Calculate polygon total area
        const polygonArea = this._calculatePolygonArea(this.currentPolygon.geometry.coordinates[0]);
        
        return {
            minDepth: minDepth === Infinity ? 0 : minDepth,
            maxDepth: maxDepth === -Infinity ? 0 : maxDepth,
            meanDepth: depthCount > 0 ? sumDepth / depthCount : 0,
            totalArea: polygonArea,
            floodedArea: floodedArea,
            floodPercent: totalArea > 0 ? (floodedArea / totalArea) * 100 : 0,
            featureCount: features.length
        };
    }

    /**
     * Get depth value from properties
     */
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
     * Calculate feature area in square kilometers
     */
    _calculateFeatureArea(feature) {
        if (!feature?.geometry) return 0;
        
        const geom = feature.geometry;
        if (geom.type === 'Polygon') {
            return this._polygonAreaKm2(geom.coordinates[0]);
        } else if (geom.type === 'MultiPolygon') {
            return geom.coordinates.reduce((sum, poly) => sum + this._polygonAreaKm2(poly[0]), 0);
        }
        return 0;
    }

    /**
     * Calculate polygon area in km²
     */
    _calculatePolygonArea(coords) {
        return this._polygonAreaKm2(coords);
    }

    /**
     * Calculate area using shoelace formula with geodetic projection
     */
    _polygonAreaKm2(coords) {
        if (!coords || coords.length < 3) return 0;
        
        let area = 0;
        for (let i = 0; i < coords.length; i++) {
            const [x1, y1] = this._projectToMeters(coords[i]);
            const [x2, y2] = this._projectToMeters(coords[(i + 1) % coords.length]);
            area += (x1 * y2) - (x2 * y1);
        }
        
        return Math.abs(area / 2) / 1000000; // Convert m² to km²
    }

    /**
     * Project lat/lng to meters
     */
    _projectToMeters(coord) {
        const [lng, lat] = coord;
        const d2r = Math.PI / 180;
        const clampedLat = Math.max(Math.min(lat, 89.9999), -89.9999);
        return [
            EARTH_RADIUS_METERS * lng * d2r,
            EARTH_RADIUS_METERS * Math.log(Math.tan(Math.PI / 4 + (clampedLat * d2r) / 2))
        ];
    }

    /**
     * Update statistics UI
     */
    _updateStatsUI(stats) {
        document.getElementById('polygonTotalArea').textContent = stats.totalArea.toFixed(3) + ' km²';
        document.getElementById('polygonFloodedArea').textContent = stats.floodedArea.toFixed(3) + ' km²';
        document.getElementById('polygonFloodPercent').textContent = stats.floodPercent.toFixed(1) + '%';
        document.getElementById('polygonMinDepth').textContent = stats.minDepth.toFixed(2);
        document.getElementById('polygonMeanDepth').textContent = stats.meanDepth.toFixed(2);
        document.getElementById('polygonMaxDepth').textContent = stats.maxDepth.toFixed(2);
        
        eventBus.emit(AppEvents.POLYGON_ANALYSIS_COMPLETE, { stats });
    }

    /**
     * Analyze all time slots and generate time series
     */
    async analyzeAllTimeSlots() {
        if (!this.currentPolygon) {
            this.logger.warning('No polygon to analyze');
            return;
        }
        
        const timeSlots = this.timeController.getTimeSlots();
        if (timeSlots.length === 0) {
            this.logger.warning('No time slots available');
            return;
        }
        
        this.logger.info('Analyzing ' + timeSlots.length + ' time slots...');
        
        const analyzeBtn = this.popupPanel.querySelector('.analyze-all-btn');
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = '⏳ Analyzing...';
        
        const timeSeriesData = [];
        const currentIndex = this.timeController.getCurrentIndex();
        
        for (let i = 0; i < timeSlots.length; i++) {
            const timeSlot = timeSlots[i];
            
            // Load PMTiles for this time slot
            await this.mapManager.loadPMTiles(timeSlot);
            
            // Wait for tiles to render
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Get statistics
            const bounds = this._getPolygonBounds();
            const features = this.map.queryRenderedFeatures(
                [
                    this.map.project([bounds.minLng, bounds.maxLat]),
                    this.map.project([bounds.maxLng, bounds.minLat])
                ],
                { layers: ['pmtiles-layer'] }
            );
            
            const intersectingFeatures = features.filter(f => 
                this._featureIntersectsPolygon(f, this.currentPolygon.geometry.coordinates[0])
            );
            
            const stats = this._calculateStats(intersectingFeatures);
            
            timeSeriesData.push({
                timeSlot,
                label: this._formatTimeLabel(timeSlot),
                ...stats,
                // Simulated precipitation (would come from actual data)
                precipitation: Math.random() * 5 + (stats.meanDepth * 2)
            });
        }
        
        // Restore original time slot
        await this.mapManager.loadPMTiles(timeSlots[currentIndex]);
        
        // Draw chart
        this._drawTimeSeriesChart(timeSeriesData);
        
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = '📈 Analyze All Times';
        
        eventBus.emit(AppEvents.POLYGON_TIMESERIES_COMPLETE, { data: timeSeriesData });
        this.logger.success('Time series analysis complete');
    }

    /**
     * Format time slot for chart labels
     */
    _formatTimeLabel(timeSlot) {
        if (!timeSlot || timeSlot.length < 12) return timeSlot;
        
        const month = timeSlot.substring(4, 6);
        const day = timeSlot.substring(6, 8);
        const hour = timeSlot.substring(8, 10);
        
        return `${day}/${month} ${hour}:00`;
    }

    /**
     * Draw time series chart
     */
    _drawTimeSeriesChart(data) {
        const canvas = document.getElementById('timeSeriesChart');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const padding = { top: 20, right: 50, bottom: 40, left: 50 };
        
        // Clear canvas
        ctx.clearRect(0, 0, width, height);
        
        if (data.length === 0) return;
        
        // Calculate scales
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;
        
        const maxFloodPercent = Math.max(...data.map(d => d.floodPercent), 100);
        const maxPrecip = Math.max(...data.map(d => d.precipitation), 10);
        
        const xScale = (i) => padding.left + (i / (data.length - 1)) * chartWidth;
        const yScaleFlood = (v) => padding.top + chartHeight - (v / maxFloodPercent) * chartHeight;
        const yScalePrecip = (v) => padding.top + chartHeight - (v / maxPrecip) * chartHeight;
        
        // Draw axes
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 1;
        
        // X axis
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top + chartHeight);
        ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
        ctx.stroke();
        
        // Y axis left
        ctx.beginPath();
        ctx.moveTo(padding.left, padding.top);
        ctx.lineTo(padding.left, padding.top + chartHeight);
        ctx.stroke();
        
        // Y axis right
        ctx.beginPath();
        ctx.moveTo(padding.left + chartWidth, padding.top);
        ctx.lineTo(padding.left + chartWidth, padding.top + chartHeight);
        ctx.stroke();
        
        // Draw grid lines
        ctx.strokeStyle = '#e2e8f0';
        ctx.setLineDash([2, 2]);
        for (let i = 0; i <= 5; i++) {
            const y = padding.top + (i / 5) * chartHeight;
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartWidth, y);
            ctx.stroke();
        }
        ctx.setLineDash([]);
        
        // Draw flood percent line (blue)
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.beginPath();
        data.forEach((d, i) => {
            const x = xScale(i);
            const y = yScaleFlood(d.floodPercent);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        
        // Draw precipitation line (orange)
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        data.forEach((d, i) => {
            const x = xScale(i);
            const y = yScalePrecip(d.precipitation);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();
        
        // Draw data points
        data.forEach((d, i) => {
            const x = xScale(i);
            
            // Flood point
            ctx.fillStyle = '#3b82f6';
            ctx.beginPath();
            ctx.arc(x, yScaleFlood(d.floodPercent), 4, 0, Math.PI * 2);
            ctx.fill();
            
            // Precip point
            ctx.fillStyle = '#f59e0b';
            ctx.beginPath();
            ctx.arc(x, yScalePrecip(d.precipitation), 4, 0, Math.PI * 2);
            ctx.fill();
        });
        
        // Draw labels
        ctx.fillStyle = '#64748b';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        
        // X axis labels
        const labelStep = Math.ceil(data.length / 5);
        data.forEach((d, i) => {
            if (i % labelStep === 0 || i === data.length - 1) {
                ctx.fillText(d.label, xScale(i), padding.top + chartHeight + 15);
            }
        });
        
        // Y axis labels (left - flood %)
        ctx.textAlign = 'right';
        for (let i = 0; i <= 5; i++) {
            const value = (maxFloodPercent * (5 - i) / 5).toFixed(0);
            const y = padding.top + (i / 5) * chartHeight;
            ctx.fillText(value + '%', padding.left - 5, y + 4);
        }
        
        // Y axis labels (right - precipitation)
        ctx.textAlign = 'left';
        for (let i = 0; i <= 5; i++) {
            const value = (maxPrecip * (5 - i) / 5).toFixed(1);
            const y = padding.top + (i / 5) * chartHeight;
            ctx.fillText(value + 'cm', padding.left + chartWidth + 5, y + 4);
        }
    }

    /**
     * Show analytics panel
     */
    showPanel() {
        if (this.popupPanel) {
            this.popupPanel.style.display = 'block';
        }
    }

    /**
     * Hide analytics panel
     */
    hidePanel() {
        if (this.popupPanel) {
            this.popupPanel.style.display = 'none';
        }
    }

    /**
     * Cleanup
     */
    destroy() {
        document.removeEventListener('keydown', this._handleKeyDown);
        this.clearPolygon();
        
        if (this.popupPanel) {
            this.popupPanel.remove();
        }
        
        const drawControl = document.querySelector('.polygon-draw-control');
        if (drawControl) {
            drawControl.remove();
        }
    }
}

export default PolygonAnalytics;
