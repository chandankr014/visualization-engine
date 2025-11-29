/**
 * PMTiles Viewer - Main Application Entry Point
 * 
 * A modular Python-JavaScript application for interactive geospatial visualization.
 * Features event-driven architecture with clean separation of concerns.
 */

import { eventBus, AppEvents } from './event-bus.js';
import apiBridge from './api-bridge.js';
import Logger from './logger.js';
import StatsTracker from './stats-tracker.js';
import TimeController from './time-controller.js';
import UIController from './ui-controller.js';
import MapManager from './map-manager.js';

/**
 * Default Configuration
 * These values are used if the server API is unavailable
 */
const DEFAULT_CONFIG = {
    timeSlots: [],
    initialCenter: [77.0293, 28.4622],
    initialZoom: 11,
    initialStyle: 'light',
    statsUpdateInterval: 2000,
    playbackSpeed: 1500
};

/**
 * PMTiles Viewer Application Class
 * Orchestrates all modules using an event-driven architecture
 */
class PMTilesViewerApp {
    constructor() {
        this.version = '2.1.0';
        this.config = { ...DEFAULT_CONFIG };
        this.modules = {};
        this.isInitialized = false;
        this._statsInterval = null;
    }

    /**
     * Initialize the application
     */
    async init() {
        try {
            // Initialize logger first (needed by other modules)
            this.modules.logger = new Logger('logsContainer', {
                maxLogs: 100,
                minLevel: 'info'
            });
            
            this.modules.logger.info('PMTiles Viewer v' + this.version);
            this.modules.logger.info('Initializing application...');
            
            // Load configuration from server
            await this._loadServerConfig();
            
            // Initialize remaining modules
            this._initializeModules();
            
            // Setup event-driven communication
            this._setupEventBus();
            
            // Initialize map and load initial data
            await this._initializeMap();
            
            // Start stats update interval
            this._startStatsUpdater();
            
            this.isInitialized = true;
            this.modules.logger.success('Application initialized successfully');
            
            // Log helpful console info
            this._logConsoleInfo();
            
        } catch (error) {
            console.error('Failed to initialize application:', error);
            this.modules.logger?.error('Initialization failed', error.message);
        }
    }

    /**
     * Load configuration from Python server
     */
    async _loadServerConfig() {
        try {
            const response = await apiBridge.getConfig();
            if (response.success && response.config) {
                this.config = { ...DEFAULT_CONFIG, ...response.config };
                this.modules.logger.success('Configuration loaded from server');
                eventBus.emit(AppEvents.CONFIG_LOADED, this.config);
            }
        } catch (error) {
            this.modules.logger.warning('Using default configuration');
            eventBus.emit(AppEvents.CONFIG_ERROR, error);
        }
    }

    /**
     * Initialize all application modules
     */
    _initializeModules() {
        const { logger } = this.modules;
        
        // Stats Tracker
        this.modules.statsTracker = new StatsTracker({
            zoom: 'currentZoom',
            tiles: 'loadedTiles',
            features: 'visibleFeatures',
            cursor: 'cursorPosition',
            mapCoords: 'mapCoordinates'
        });
        
        // UI Controller
        this.modules.uiController = new UIController(logger);
        
        // Time Controller
        this.modules.timeController = new TimeController(this.config, logger);
        
        // Map Manager
        this.modules.mapManager = new MapManager(this.config, logger, this.modules.statsTracker);
        
        logger.success('All modules initialized');
    }

    /**
     * Setup event bus connections between modules
     */
    _setupEventBus() {
        const { logger, mapManager, uiController, timeController } = this.modules;
        
        // Time change events - load new PMTiles
        eventBus.on(AppEvents.TIME_CHANGE, async ({ timeSlot }) => {
            uiController.showLoading(`Loading ${timeSlot}...`);
            const success = await mapManager.loadPMTiles(timeSlot);
            uiController.hideLoading();
            
            if (success) {
                mapManager.setLayerOpacity(uiController.getOpacity());
            }
        });
        
        // Legacy callback support (will be removed in future)
        timeController.onTimeChange = (timeSlot) => {
            // Event already emitted by TimeController
        };
        
        // Opacity change events
        eventBus.on(AppEvents.OPACITY_CHANGE, (opacity) => {
            mapManager.setLayerOpacity(opacity);
        });
        
        // Layer type change events
        eventBus.on(AppEvents.LAYER_TYPE_CHANGE, (layerType) => {
            mapManager.changeLayerType(layerType);
        });
        
        // Map style change events
        eventBus.on(AppEvents.MAP_STYLE_CHANGE, async (style) => {
            mapManager.changeBaseStyle(style);
            
            // Wait for style to load, then reload PMTiles layer
            const map = mapManager.getMap();
            if (map) {
                map.once('style.load', async () => {
                    const currentTimeSlot = timeController.getCurrentTimeSlot();
                    if (currentTimeSlot) {
                        uiController.showLoading('Reloading layer...');
                        await mapManager.loadPMTiles(currentTimeSlot);
                        uiController.hideLoading();
                        mapManager.setLayerOpacity(uiController.getOpacity());
                    }
                });
            }
        });
        
        // Map ready event
        eventBus.on(AppEvents.MAP_READY, () => {
            logger.success('Map ready');
        });
        
        // API request events for debugging
        apiBridge.on('request:error', ({ url, error }) => {
            logger.warning(`API error: ${url}`, error.message);
        });
        
        logger.info('Event bus configured');
    }

    /**
     * Initialize map and load initial data
     */
    async _initializeMap() {
        const { mapManager, uiController, timeController, logger } = this.modules;
        
        // Initialize map
        mapManager.init();
        
        const map = mapManager.getMap();
        if (!map) {
            logger.error('Map initialization failed');
            return;
        }
        
        // Wait for map to load
        return new Promise((resolve) => {
            map.on('load', async () => {
                const initialTimeSlot = timeController.getCurrentTimeSlot();
                
                if (initialTimeSlot) {
                    uiController.showLoading('Loading initial data...');
                    const success = await mapManager.loadPMTiles(initialTimeSlot);
                    uiController.hideLoading();
                    
                    if (success) {
                        mapManager.setLayerOpacity(uiController.getOpacity());
                        logger.success('Initial data loaded');
                    } else {
                        logger.error('Failed to load initial data');
                    }
                } else {
                    logger.warning('No time slots available');
                }
                
                resolve();
            });
        });
    }

    /**
     * Start periodic stats update
     */
    _startStatsUpdater() {
        const { mapManager } = this.modules;
        
        this._statsInterval = setInterval(() => {
            if (mapManager.getMap()?.loaded()) {
                mapManager.updateStats();
            }
        }, this.config.statsUpdateInterval);
    }

    /**
     * Stop stats updater
     */
    _stopStatsUpdater() {
        if (this._statsInterval) {
            clearInterval(this._statsInterval);
            this._statsInterval = null;
        }
    }

    /**
     * Log helpful console information
     */
    _logConsoleInfo() {
        console.log(
            '%c PMTiles Viewer v' + this.version + ' ',
            'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; font-size: 16px; padding: 10px 20px; border-radius: 4px;'
        );
        console.log('%c Available Commands:', 'font-weight: bold; font-size: 14px;');
        console.log('  window.pmtilesApp.getVersion()    - Get app version');
        console.log('  window.pmtilesApp.exportLogs()    - Export logs as JSON');
        console.log('  window.pmtilesApp.downloadLogs()  - Download logs file');
        console.log('  window.pmtilesApp.getStats()      - Get current statistics');
        console.log('  window.pmtilesApp.refreshConfig() - Reload server config');
    }

    // Public API methods

    /**
     * Get application version
     */
    getVersion() {
        return this.version;
    }

    /**
     * Get current configuration
     */
    getConfig() {
        return { ...this.config };
    }

    /**
     * Refresh configuration from server
     */
    async refreshConfig() {
        apiBridge.clearCache();
        await this._loadServerConfig();
        return this.config;
    }

    /**
     * Export logs
     */
    exportLogs() {
        const logs = this.modules.logger.getLogs();
        console.table(logs);
        return logs;
    }

    /**
     * Download logs as file
     */
    downloadLogs() {
        this.modules.logger.downloadLogs();
    }

    /**
     * Get current statistics
     */
    getStats() {
        return this.modules.statsTracker.getStats();
    }

    /**
     * Get event bus for external integrations
     */
    getEventBus() {
        return eventBus;
    }

    /**
     * Get API bridge for external integrations
     */
    getAPIBridge() {
        return apiBridge;
    }

    /**
     * Cleanup and destroy application
     */
    destroy() {
        this._stopStatsUpdater();
        this.modules.mapManager?.destroy();
        this.modules.timeController?.destroy();
        eventBus.clear();
        this.isInitialized = false;
    }
}

/**
 * Initialize application when DOM is ready
 */
document.addEventListener('DOMContentLoaded', async () => {
    const app = new PMTilesViewerApp();
    await app.init();
    
    // Expose to window for debugging and external access
    window.pmtilesApp = app;
});
