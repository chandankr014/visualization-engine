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
     * Health check endpoint
     */
    async healthCheck() {
        return this._request('/api/health');
    }

    /**
     * Build PMTiles URL for a given time slot
     */
    buildPMTilesUrl(timeSlot) {
        return `${this.baseUrl}/pmtiles/PMTile_${timeSlot}.pmtiles`;
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
