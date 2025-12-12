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
import PolygonAnalytics from './polygon-analytics.js';
import PrecipitationGraph from './precipitation-graph.js';

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
    playbackSpeed: 500
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
                
                // Populate simulation info in UI
                this._populateSimulationInfo(response.config);
                
                // Log batch configuration
                if (response.config.batchFiles) {
                    this.modules.logger.info(`Loaded ${response.config.batchFiles.length} batch files (${response.config.batchSize} slots per batch)`);
                }
            }
        } catch (error) {
            this.modules.logger.warning('Using default configuration');
            eventBus.emit(AppEvents.CONFIG_ERROR, error);
        }
    }

    /**
     * Populate simulation information in the UI
     */
    _populateSimulationInfo(config) {
        // Update location
        const locationEl = document.getElementById('infoLocation');
        if (locationEl && config.location) {
            locationEl.textContent = config.location;
        }
        
        // Update start time
        const startTimeEl = document.getElementById('infoStartTime');
        if (startTimeEl && config.startTime) {
            startTimeEl.textContent = this._formatTimestamp(config.startTime);
        }
        
        // Update end time
        const endTimeEl = document.getElementById('infoEndTime');
        if (endTimeEl && config.endTime) {
            endTimeEl.textContent = this._formatTimestamp(config.endTime);
        }
        
        // Update interval
        const intervalEl = document.getElementById('infoInterval');
        if (intervalEl && config.interval) {
            intervalEl.textContent = `${config.interval} min`;
        }
        
        // Update time steps count
        // const timeStepsEl = document.getElementById('infoTimeSteps');
        // if (timeStepsEl && config.timeSlots) {
        //     timeStepsEl.textContent = config.timeSlots.length;
        // }
    }

    /**
     * Format timestamp from YYYYMMDDHHmm to readable format
     */
    _formatTimestamp(timestamp) {
        const str = String(timestamp);
        if (str.length !== 12) return timestamp;
        
        const year = str.substring(0, 4);
        const month = str.substring(4, 6);
        const day = str.substring(6, 8);
        const hour = str.substring(8, 10);
        const minute = str.substring(10, 12);
        
        return `${day}/${month}/${year} ${hour}:${minute}`;
    }

    /**
     * Initialize all application modules
     */
    _initializeModules() {
        const { logger } = this.modules;
        
        // Stats Tracker
        this.modules.statsTracker = new StatsTracker({
            zoom: 'currentZoom',
            features: 'visibleFeatures',
            cursor: 'cursorPosition',
            mapCoords: 'mapCoordinates'
        });
        
        // UI Controller
        this.modules.uiController = new UIController(logger);
        
        // Time Controller
        this.modules.timeController = new TimeController(this.config, logger);
        
        // Map Manager - pass config with batch info
        this.modules.mapManager = new MapManager(this.config, logger, this.modules.statsTracker);
        
        // Update batch config in mapManager if available
        if (this.config.batchFiles && this.config.batchSize) {
            this.modules.mapManager.updateBatchConfig(this.config);
        }
        
        // Polygon Analytics (initialized after map is ready)
        this.modules.polygonAnalytics = null;
        
        // Precipitation Graph - pass config with startTime and endTime
        const precipConfig = {
            timeSlots: this.config.timeSlots || [],
            startTime: this.config.startTime || null,
            endTime: this.config.endTime || null
        };
        this.modules.precipitationGraph = new PrecipitationGraph(precipConfig, logger);
        
        // Set time slots in precipitation graph
        if (this.config.timeSlots?.length > 0) {
            this.modules.precipitationGraph.setTimeSlots(this.config.timeSlots);
        }
        
        logger.success('All modules initialized');
    }

    /**
     * Setup event bus connections between modules
     */
    _setupEventBus() {
        const { logger, mapManager, uiController, timeController } = this.modules;
        
        // Handle batch transition events for UI feedback
        eventBus.on(AppEvents.BATCH_TRANSITION_START, ({ fromBatch, toBatch }) => {
            logger.info(`Batch transition: ${fromBatch} → ${toBatch}`);
            // Show subtle loading indicator (non-blocking)
            uiController.showBatchTransitionIndicator?.();
        });
        
        eventBus.on(AppEvents.BATCH_TRANSITION_END, ({ batchFile, loadTime, error }) => {
            uiController.hideBatchTransitionIndicator?.();
            if (!error) {
                logger.success(`Batch ${batchFile} ready (${loadTime?.toFixed(2)}s)`);
            }
        });
        
        // Time change events - switch to new time slot (batch-aware)
        eventBus.on(AppEvents.TIME_CHANGE, async ({ timeSlot, index }) => {
            // Pass both index and timeSlot to mapManager
            if (mapManager._masterPMTilesLoaded) {
                // Switch time slot (will load new batch if needed - smooth transition)
                const success = mapManager.switchTimeSlot(index, timeSlot);
                if (success) {
                    mapManager.setLayerOpacity(uiController.getOpacity());
                }
            } else {
                // Initial load - load batch PMTiles with this time index (skip double-buffering)
                uiController.showLoading(`Loading flood data...`);
                const success = await mapManager.loadPMTiles(index, timeSlot, true);
                uiController.hideLoading();
                
                if (success) {
                    mapManager.setLayerOpacity(uiController.getOpacity());
                }
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

        // Layer toggle events
        eventBus.on(AppEvents.LAYER_TOGGLE, async ({ layer, visible, classes }) => {
            if (layer === 'lulc') {
                logger.info(`LULC classes: ${classes?.length ? classes.join(', ') : 'none'}`);
                await mapManager.toggleLulcClasses(classes || []);
            } else {
                logger.info(`Toggling ${layer}: ${visible ? 'on' : 'off'}`);
                
                if (layer === 'ward-boundaries') {
                    if (visible) {
                        await mapManager.loadWardBoundaries();
                        await mapManager.addWardBoundary();
                    } else {
                        if (mapManager.map.getLayer('ward-fill')) {
                            mapManager.map.setLayoutProperty('ward-fill', 'visibility', 'none');
                        }
                        if (mapManager.map.getLayer('ward-outline')) {
                            mapManager.map.setLayoutProperty('ward-outline', 'visibility', 'none');
                        }
                    }
                } else if (layer === 'flood-depth') {
                    // Use the active layer ID from double-buffering system
                    const activeFillId = mapManager._getActiveFillLayerId();
                    if (mapManager.map.getLayer(activeFillId)) {
                        mapManager.map.setLayoutProperty(activeFillId, 'visibility', visible ? 'visible' : 'none');
                    }
                } else if (layer === 'roadways') {
                    await mapManager.toggleRoadways(visible);
                } else if (layer === 'hotspots') {
                    if (visible) {
                        await mapManager.loadHotspots();
                        await mapManager.addHotspots();
                    } else {
                        if (mapManager.map.getLayer('hotspots-circle')) {
                            mapManager.map.setLayoutProperty('hotspots-circle', 'visibility', 'none');
                        }
                        if (mapManager.map.getLayer('hotspots-label')) {
                            mapManager.map.setLayoutProperty('hotspots-label', 'visibility', 'none');
                        }
                    }
                }
            }
        });
        
        // Precipitation graph toggle and click events
        eventBus.on(AppEvents.LAYER_TOGGLE, async ({ layer, visible }) => {
            if (layer === 'precipitation-graph') {
                const precipGraph = this.modules.precipitationGraph;
                if (visible) {
                    precipGraph.show();
                } else {
                    precipGraph.hide();
                }
            }
        });
        
        eventBus.on(AppEvents.PRECIP_GRAPH_CLICK, ({ index, timeSlot }) => {
            // Jump the time slider to the clicked position
            timeController.setTimeIndex(index);
        });
        
        // Map style change events
        eventBus.on(AppEvents.MAP_STYLE_CHANGE, async (style) => {
            mapManager.changeBaseStyle(style);
            
            // Wait for style to load, then apply opacity
            const map = mapManager.getMap();
            if (map) {
                map.once('style.load', async () => {
                    // Opacity is applied after layers are restored in changeBaseStyle
                    mapManager.setLayerOpacity(uiController.getOpacity());
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
                // Load ward boundaries first
                uiController.showLoading('Loading ward boundaries...');
                await mapManager.loadWardBoundaries();
                await mapManager.addWardBoundary();
                
                const initialTimeSlot = timeController.getCurrentTimeSlot();
                const initialIndex = timeController.getCurrentIndex();
                
                if (initialTimeSlot) {
                    uiController.showLoading('Loading initial data...');
                    // Pass index and timeSlot to batch-aware loadPMTiles
                    const success = await mapManager.loadPMTiles(initialIndex, initialTimeSlot);
                    uiController.hideLoading();
                    
                    if (success) {
                        mapManager.setLayerOpacity(uiController.getOpacity());
                        logger.success('Initial data loaded');
                    } else {
                        logger.error('Failed to load initial data');
                    }
                } else {
                    uiController.hideLoading();
                    logger.warning('No time slots available');
                }
                
                // Initialize Polygon Analytics after map is fully loaded
                this.modules.polygonAnalytics = new PolygonAnalytics(mapManager, timeController, logger);
                this.modules.polygonAnalytics.init();
                
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
        console.log('%c Keyboard Shortcuts:', 'font-weight: bold; font-size: 14px;');
        console.log('  P          - Toggle polygon draw mode');
        console.log('  Enter      - Finish drawing polygon');
        console.log('  Escape     - Cancel drawing');
        console.log('  Space      - Play/Pause time animation');
        console.log('  ←/→        - Previous/Next time slot');
        console.log('  +/-        - Increase/Decrease opacity');
        console.log('  B          - Toggle layer type (multiclass/binary)');
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
        this.modules.polygonAnalytics?.destroy();
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
