/**
 * Event Bus Module
 * Provides decoupled communication between application modules.
 * Implements a simple pub/sub pattern with type safety.
 */

class EventBus {
    constructor() {
        this._events = new Map();
        this._onceListeners = new WeakSet();
    }

    /**
     * Subscribe to an event
     * @param {string} event - Event name
     * @param {Function} callback - Handler function
     * @returns {Function} Unsubscribe function
     */
    on(event, callback) {
        if (typeof callback !== 'function') {
            throw new TypeError('Event handler must be a function');
        }
        
        if (!this._events.has(event)) {
            this._events.set(event, new Set());
        }
        
        this._events.get(event).add(callback);
        
        // Return unsubscribe function
        return () => this.off(event, callback);
    }

    /**
     * Subscribe to an event only once
     * @param {string} event - Event name
     * @param {Function} callback - Handler function
     * @returns {Function} Unsubscribe function
     */
    once(event, callback) {
        const wrapper = (...args) => {
            this.off(event, wrapper);
            callback(...args);
        };
        this._onceListeners.add(wrapper);
        return this.on(event, wrapper);
    }

    /**
     * Unsubscribe from an event
     * @param {string} event - Event name
     * @param {Function} callback - Handler function to remove
     */
    off(event, callback) {
        const listeners = this._events.get(event);
        if (listeners) {
            listeners.delete(callback);
            if (listeners.size === 0) {
                this._events.delete(event);
            }
        }
    }

    /**
     * Emit an event
     * @param {string} event - Event name
     * @param {*} data - Data to pass to handlers
     */
    emit(event, data) {
        const listeners = this._events.get(event);
        if (listeners) {
            listeners.forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`EventBus: Error in handler for "${event}":`, error);
                }
            });
        }
    }

    /**
     * Clear all listeners for an event or all events
     * @param {string} [event] - Optional event name
     */
    clear(event) {
        if (event) {
            this._events.delete(event);
        } else {
            this._events.clear();
        }
    }

    /**
     * Get count of listeners for an event
     * @param {string} event - Event name
     * @returns {number} Number of listeners
     */
    listenerCount(event) {
        return this._events.get(event)?.size || 0;
    }

    /**
     * Check if event has listeners
     * @param {string} event - Event name
     * @returns {boolean}
     */
    hasListeners(event) {
        return this.listenerCount(event) > 0;
    }
}

// Application event types for documentation and IDE support
const AppEvents = {
    // Configuration
    CONFIG_LOADED: 'config:loaded',
    CONFIG_ERROR: 'config:error',
    
    // Time control events
    TIME_CHANGE: 'time:change',
    TIME_PLAY: 'time:play',
    TIME_PAUSE: 'time:pause',
    TIME_SLOTS_UPDATED: 'time:slots-updated',
    
    // Map events
    MAP_READY: 'map:ready',
    MAP_ERROR: 'map:error',
    MAP_STYLE_CHANGE: 'map:style-change',
    MAP_LAYER_LOADED: 'map:layer-loaded',
    MAP_LAYER_ERROR: 'map:layer-error',
    MAP_CLICK: 'map:click',
    MAP_MOVE: 'map:move',
    
    // UI events
    OPACITY_CHANGE: 'ui:opacity-change',
    LAYER_TYPE_CHANGE: 'ui:layer-type-change',
    LOADING_START: 'ui:loading-start',
    LOADING_END: 'ui:loading-end',
    
    // Stats events
    STATS_UPDATE: 'stats:update',
    CURSOR_MOVE: 'stats:cursor-move',
    
    // Log events
    LOG_ENTRY: 'log:entry'
};

// Export singleton instance
const eventBus = new EventBus();

export { EventBus, AppEvents, eventBus };
export default eventBus;
