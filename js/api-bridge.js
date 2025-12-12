/**
 * API Bridge Module
 * Handles all communication between JavaScript frontend and Python backend.
 * Provides a clean, Promise-based API for server interactions.
 */

class APIBridge {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || window.location.origin;
        this.timeout = options.timeout || 30000;
        this.retries = options.retries || 3;
        this.retryDelay = options.retryDelay || 1000;
        
        // Cache for API responses
        this._cache = new Map();
        this._cacheExpiry = options.cacheExpiry || 60000; // 1 minute default
        
        // Request queue for rate limiting
        this._pendingRequests = new Map();
        
        // Event listeners
        this._listeners = new Map();
    }

    /**
     * Fetch server configuration including dynamic time slots
     */
    async getConfig() {
        return this._cachedRequest('/api/config', 'config');
    }

    /**
     * Get list of available PMTiles files
     */
    async getPMTilesList() {
        return this._cachedRequest('/api/pmtiles', 'pmtiles-list');
    }

    /**
     * Get detailed info about a specific PMTiles file
     */
    async getPMTilesInfo(filename) {
        return this._request(`/api/pmtiles/${filename}`);
    }

    /**
     * Get list of static layers
     */
    async getStaticLayers() {
        return this._cachedRequest('/api/static-layers', 'static-layers');
    }

    /**
     * Get ward boundaries GeoJSON
     */
    async getWardBoundaries() {
        return this._cachedRequest('/api/ward-boundaries', 'ward-boundaries');
    }

    /**
     * Get roadways GeoJSON
     */
    async getRoadways() {
        return this._cachedRequest('/api/roadways', 'roadways');
    }

    /**
     * Get hotspots GeoJSON
     */
    async getHotspots() {
        return this._cachedRequest('/api/hotspots', 'hotspots');
    }

    /**
     * Health check endpoint
     */
    async healthCheck() {
        return this._request('/api/health');
    }

    /**
     * Build PMTiles URL for a given time slot (legacy - now returns master file URL)
     * @deprecated Use getBatchPMTilesUrl() instead
     */
    buildPMTilesUrl(timeSlot) {
        // Return master PMTiles file URL for all time slots
        return this.getMasterPMTilesUrl();
    }

    /**
     * Get the master PMTiles file URL (legacy)
     * @deprecated Use getBatchPMTilesUrl() for new batch-based system
     */
    getMasterPMTilesUrl() {
        return `${this.baseUrl}/pmtiles/flood/flood_depth_master.pmtiles`;
    }

    /**
     * Get batch PMTiles URL for a specific batch file
     * @param {string} batchFilename - The batch file name (e.g., "D202507130200.pmtiles")
     * @param {string} floodDir - The flood directory path (default: "pmtiles/flood")
     */
    getBatchPMTilesUrl(batchFilename, floodDir = 'pmtiles/flood') {
        return `${this.baseUrl}/${floodDir}/${batchFilename}`;
    }

    /**
     * Calculate batch info for a given global time slot index
     * @param {number} globalIndex - Global time slot index (0-based)
     * @param {number} batchSize - Number of time slots per batch (default: 48)
     * @param {Array} batchFiles - Array of batch file info from server config
     * @returns {Object} Batch info with filename, localIndex, and batchIndex
     */
    getBatchForTimeSlot(globalIndex, batchSize = 48, batchFiles = []) {
        const batchIndex = Math.floor(globalIndex / batchSize);
        const localIndex = globalIndex % batchSize;
        
        // Get batch file info
        const batchFile = batchFiles[batchIndex] || batchFiles[batchFiles.length - 1];
        
        return {
            batchIndex,
            localIndex,
            globalIndex,
            batchFile: batchFile?.filename || null,
            batchPath: batchFile?.path || null
        };
    }

    /**
     * Build static layer PMTiles URL
     */
    buildStaticLayerUrl(layerId) {
        return `${this.baseUrl}/pmtiles/static/${layerId}.pmtiles`;
    }

    /**
     * Subscribe to API events
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);
        return () => this._listeners.get(event)?.delete(callback);
    }

    /**
     * Emit API event
     */
    _emit(event, data) {
        this._listeners.get(event)?.forEach(cb => {
            try {
                cb(data);
            } catch (e) {
                console.error(`APIBridge event handler error:`, e);
            }
        });
    }

    /**
     * Make a cached request
     */
    async _cachedRequest(endpoint, cacheKey) {
        const cached = this._cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this._cacheExpiry) {
            return cached.data;
        }
        
        const data = await this._request(endpoint);
        this._cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    }

    /**
     * Clear cache
     */
    clearCache(key = null) {
        if (key) {
            this._cache.delete(key);
        } else {
            this._cache.clear();
        }
    }

    /**
     * Make an HTTP request with retry logic
     */
    async _request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const requestKey = `${options.method || 'GET'}:${url}`;
        
        // Deduplicate concurrent identical requests
        if (this._pendingRequests.has(requestKey)) {
            return this._pendingRequests.get(requestKey);
        }
        
        const requestPromise = this._executeRequest(url, options);
        this._pendingRequests.set(requestKey, requestPromise);
        
        try {
            const result = await requestPromise;
            return result;
        } finally {
            this._pendingRequests.delete(requestKey);
        }
    }

    /**
     * Execute HTTP request with retries
     */
    async _executeRequest(url, options = {}, attempt = 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        try {
            this._emit('request:start', { url, attempt });
            
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'Accept': 'application/json',
                    ...options.headers
                }
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                throw new APIError(
                    `HTTP ${response.status}: ${response.statusText}`,
                    response.status,
                    url
                );
            }
            
            const data = await response.json();
            this._emit('request:success', { url, data });
            return data;
            
        } catch (error) {
            clearTimeout(timeoutId);
            
            // Handle abort/timeout
            if (error.name === 'AbortError') {
                throw new APIError('Request timeout', 408, url);
            }
            
            // Retry on network errors
            if (attempt < this.retries && this._isRetryable(error)) {
                this._emit('request:retry', { url, attempt, error });
                await this._delay(this.retryDelay * attempt);
                return this._executeRequest(url, options, attempt + 1);
            }
            
            this._emit('request:error', { url, error });
            throw error;
        }
    }

    /**
     * Check if error is retryable
     */
    _isRetryable(error) {
        if (error instanceof APIError) {
            // Retry on server errors, not client errors
            return error.status >= 500 || error.status === 408;
        }
        // Retry on network errors
        return error.name === 'TypeError' || error.message.includes('network');
    }

    /**
     * Delay helper
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * Custom API Error class
 */
class APIError extends Error {
    constructor(message, status, url) {
        super(message);
        this.name = 'APIError';
        this.status = status;
        this.url = url;
    }
}

// Export singleton instance
const apiBridge = new APIBridge();

export { APIBridge, APIError, apiBridge };
export default apiBridge;
