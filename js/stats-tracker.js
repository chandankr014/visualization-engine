/**
 * Stats Tracker Module
 * Tracks and displays map statistics with optimized DOM updates.
 */

import { eventBus, AppEvents } from './event-bus.js';

class StatsTracker {
    constructor(elements) {
        // Cache DOM elements
        this.elements = {};
        for (const [key, id] of Object.entries(elements)) {
            this.elements[key] = document.getElementById(id);
        }
        
        // Additional elements
        const additionalElements = [
            'pmtilesSize', 'loadTime', 'minDepth', 
            'maxDepth', 'totalArea', 'floodedArea'
        ];
        for (const id of additionalElements) {
            this.elements[id] = document.getElementById(id);
        }
        
        // Stats state
        this.stats = {
            zoom: 0,
            loadedTiles: 0,
            visibleFeatures: 0,
            cursorLat: 0,
            cursorLng: 0,
            pmtilesSize: 0,
            loadTime: 0,
            minDepth: null,
            maxDepth: null,
            totalArea: 0,
            floodedArea: 0
        };
        
        // Batched updates for performance
        this._pendingUpdates = new Map();
        this._updateScheduled = false;
    }

    /**
     * Schedule a batched DOM update
     */
    _scheduleUpdate(key, value, formatter) {
        this._pendingUpdates.set(key, { value, formatter });
        
        if (!this._updateScheduled) {
            this._updateScheduled = true;
            requestAnimationFrame(() => this._flushUpdates());
        }
    }

    /**
     * Flush all pending DOM updates
     */
    _flushUpdates() {
        for (const [key, { value, formatter }] of this._pendingUpdates) {
            const element = this.elements[key];
            if (element) {
                element.textContent = formatter ? formatter(value) : value;
            }
        }
        
        // Emit stats update event
        eventBus.emit(AppEvents.STATS_UPDATE, this.stats);
        
        this._pendingUpdates.clear();
        this._updateScheduled = false;
    }

    /**
     * Update zoom level
     */
    updateZoom(zoom) {
        this.stats.zoom = zoom;
        this._scheduleUpdate('zoom', zoom, v => v.toFixed(2));
    }

    /**
     * Update loaded tiles count
     */
    updateTiles(count) {
        this.stats.loadedTiles = count;
        this._scheduleUpdate('tiles', count, v => String(v));
    }

    /**
     * Update visible features count
     */
    updateFeatures(count) {
        this.stats.visibleFeatures = count;
        this._scheduleUpdate('features', count, v => v.toLocaleString());
    }

    /**
     * Update cursor position
     */
    updateCursor(lat, lng) {
        this.stats.cursorLat = lat;
        this.stats.cursorLng = lng;
        
        const formatted = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
        const mapFormatted = `Lat: ${lat.toFixed(6)} | Lng: ${lng.toFixed(6)}`;
        
        this._scheduleUpdate('cursor', formatted);
        this._scheduleUpdate('mapCoords', mapFormatted);
        
        eventBus.emit(AppEvents.CURSOR_MOVE, { lat, lng });
    }

    /**
     * Update PMTiles file size
     */
    updatePMTilesSize(bytes) {
        this.stats.pmtilesSize = bytes;
        this._scheduleUpdate('pmtilesSize', bytes, v => this._formatBytes(v));
    }

    /**
     * Update load time
     */
    updateLoadTime(seconds) {
        this.stats.loadTime = seconds;
        this._scheduleUpdate('loadTime', seconds, v => `${v.toFixed(2)}s`);
    }

    /**
     * Update depth range
     */
    updateDepthRange(minDepth, maxDepth) {
        this.stats.minDepth = minDepth;
        this.stats.maxDepth = maxDepth;
        this._scheduleUpdate('minDepth', minDepth, this._formatDepth);
        this._scheduleUpdate('maxDepth', maxDepth, this._formatDepth);
    }

    /**
     * Update area statistics
     */
    updateAreaStats(totalAreaSqMeters, floodedAreaSqMeters) {
        this.stats.totalArea = totalAreaSqMeters;
        this.stats.floodedArea = floodedAreaSqMeters;
        this._scheduleUpdate('totalArea', totalAreaSqMeters, this._formatArea);
        this._scheduleUpdate('floodedArea', floodedAreaSqMeters, this._formatArea);
    }

    /**
     * Format depth value
     */
    _formatDepth(value) {
        return (value === null || value === undefined) ? '--' : `${value.toFixed(3)} m`;
    }

    /**
     * Format area value
     */
    _formatArea(areaSqMeters) {
        if (!areaSqMeters) return '0.0000 km²';
        return `${(areaSqMeters / 1_000_000).toFixed(4)} km²`;
    }

    /**
     * Format bytes to human-readable
     */
    _formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
    }

    /**
     * Get current stats snapshot
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * Reset all stats
     */
    reset() {
        this.stats = {
            zoom: 0,
            loadedTiles: 0,
            visibleFeatures: 0,
            cursorLat: 0,
            cursorLng: 0,
            pmtilesSize: 0,
            loadTime: 0,
            minDepth: null,
            maxDepth: null,
            totalArea: 0,
            floodedArea: 0
        };
        
        // Update all displays
        this.updateZoom(0);
        this.updateTiles(0);
        this.updateFeatures(0);
        this.updatePMTilesSize(0);
        this.updateLoadTime(0);
        this.updateDepthRange(null, null);
        this.updateAreaStats(0, 0);
    }
}

export default StatsTracker;
