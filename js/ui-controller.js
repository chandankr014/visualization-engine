/**
 * UI Controller Module
 * Manages UI controls, interactions, and visual state.
 */

import { eventBus, AppEvents } from './event-bus.js';

// Legend configurations
const LEGEND_CONFIGS = {
    multiclass: {
        items: [
            { colors: ['#f5fbff', '#d6ecff'], label: '0 - 0.2m', severity: '', severityLabel: '' },
            { colors: ['#d6ecff', '#9dd1ff'], label: '0.2 - 0.5m', severity: '', severityLabel: '' },
            { colors: ['#9dd1ff', '#5aa8ff'], label: '0.5 - 1m', severity: '', severityLabel: '' },
            { colors: ['#5aa8ff', '#1e6ddf'], label: '1 - 2m', severity: '', severityLabel: '' },
            { colors: ['#1e6ddf', '#0b3a8c'], label: '> 2m', severity: '', severityLabel: '' }
        ]
    },
    binary: {
        items: [
            { color: '#10b981', label: 'Depth ≤ 1m', severity: '', severityLabel: '' },
            { color: '#ef4444', label: 'Depth > 1m', severity: '', severityLabel: '' }
        ]
    }
};

class UIController {
    constructor(logger) {
        this.logger = logger;
        
        // Cache DOM elements
        this.elements = {
            opacitySlider: document.getElementById('opacitySlider'),
            opacityValue: document.getElementById('opacityValue'),
            baseMapStyle: document.getElementById('baseMapStyle'),
            floodLayerType: document.getElementById('floodLayerType'),
            legendItems: document.getElementById('legendItems'),
            legendTitle: document.getElementById('legendTitle'),
            loadingOverlay: document.getElementById('loadingOverlay'),
            loadingText: document.querySelector('.loading-text'),
            toggleWardBoundaries: document.getElementById('toggleWardBoundaries'),
            toggleFloodDepth: document.getElementById('toggleFloodDepth'),
            toggleRoadways: document.getElementById('toggleRoadways'),
            // toggleHotspots: document.getElementById('toggleHotspots'),  // Commented out
            togglePrecipGraph: document.getElementById('togglePrecipGraph'),
            lulcDropdown: document.getElementById('lulcDropdown'),
            lulcDropdownBtn: document.getElementById('lulcDropdownBtn'),
            lulcDropdownMenu: document.getElementById('lulcDropdownMenu'),
            lulcSelectAll: document.getElementById('lulcSelectAll'),
            lulcClassToggles: document.querySelectorAll('.lulc-class')
        };
        
        // State
        this.state = {
            opacity: 100, // Default to 100% opacity
            style: 'openstreetmap',
            layerType: 'multiclass',
            isLoading: false
        };
        
        // Callbacks (for backward compatibility)
        this.onOpacityChange = null;
        this.onStyleChange = null;
        this.onLayerTypeChange = null;
        
        this._init();
    }

    _init() {
        this._setupEventListeners();
        this._setupKeyboardShortcuts();
        // Set initial opacity to 100%
        if (this.elements.opacitySlider) {
            this.elements.opacitySlider.value = 100;
            this._updateOpacityDisplay(100);
        }
        this.logger.info('UI controller initialized');
    }

    /**
     * Setup control event listeners
     */
    _setupEventListeners() {
        const { opacitySlider, baseMapStyle, floodLayerType, 
                toggleWardBoundaries, toggleFloodDepth, toggleRoadways, /* toggleHotspots, */ togglePrecipGraph,
                lulcDropdown, lulcDropdownBtn, lulcSelectAll, lulcClassToggles } = this.elements;
        
        // Opacity slider with debounce
        let opacityTimeout;
        opacitySlider?.addEventListener('input', (e) => {
            const value = parseInt(e.target.value, 10);
            this._updateOpacityDisplay(value);
            
            clearTimeout(opacityTimeout);
            opacityTimeout = setTimeout(() => {
                this.setOpacity(value);
            }, 50);
        });
        
        // Base map style
        baseMapStyle?.addEventListener('change', (e) => {
            this.setStyle(e.target.value);
        });
        
        // Flood layer type
        floodLayerType?.addEventListener('change', (e) => {
            this.setLayerType(e.target.value);
        });

        // Layer toggles
        toggleWardBoundaries?.addEventListener('change', (e) => {
            eventBus.emit(AppEvents.LAYER_TOGGLE, { layer: 'ward-boundaries', visible: e.target.checked });
        });

        toggleFloodDepth?.addEventListener('change', (e) => {
            eventBus.emit(AppEvents.LAYER_TOGGLE, { layer: 'flood-depth', visible: e.target.checked });
        });

        toggleRoadways?.addEventListener('change', (e) => {
            eventBus.emit(AppEvents.LAYER_TOGGLE, { layer: 'roadways', visible: e.target.checked });
        });

        // Hotspot layer toggle - Commented out
        // toggleHotspots?.addEventListener('change', (e) => {
        //     eventBus.emit(AppEvents.LAYER_TOGGLE, { layer: 'hotspots', visible: e.target.checked });
        // });

        togglePrecipGraph?.addEventListener('change', (e) => {
            eventBus.emit(AppEvents.LAYER_TOGGLE, { layer: 'precipitation-graph', visible: e.target.checked });
        });

        // LULC dropdown toggle
        lulcDropdownBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            lulcDropdown?.classList.toggle('open');
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (lulcDropdown && !lulcDropdown.contains(e.target)) {
                lulcDropdown.classList.remove('open');
            }
        });

        // LULC Select All toggle
        lulcSelectAll?.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            lulcClassToggles?.forEach(cb => {
                cb.checked = isChecked;
            });
            this._updateLulcSelection();
        });

        // LULC class toggles
        lulcClassToggles?.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this._updateLulcSelection();
                // Update select all checkbox state
                this._updateSelectAllState();
            });
        });
    }

    /**
     * Update LULC selection and emit event
     */
    _updateLulcSelection() {
        const { lulcDropdownBtn, lulcClassToggles } = this.elements;
        const selectedClasses = Array.from(lulcClassToggles)
            .filter(cb => cb.checked)
            .map(cb => cb.dataset.class);
        
        // Update dropdown button text
        const btnText = lulcDropdownBtn?.querySelector('span:first-child');
        if (btnText) {
            btnText.textContent = selectedClasses.length > 0 
                ? `${selectedClasses.length} class(es) selected`
                : 'Select Land Use Classes';
        }
        
        eventBus.emit(AppEvents.LAYER_TOGGLE, { layer: 'lulc', classes: selectedClasses });
    }

    /**
     * Update select all checkbox based on individual selections
     */
    _updateSelectAllState() {
        const { lulcSelectAll, lulcClassToggles } = this.elements;
        if (!lulcSelectAll || !lulcClassToggles) return;
        
        const total = lulcClassToggles.length;
        const checked = Array.from(lulcClassToggles).filter(cb => cb.checked).length;
        
        lulcSelectAll.checked = checked === total;
        lulcSelectAll.indeterminate = checked > 0 && checked < total;
    }

    /**
     * Setup keyboard shortcuts
     */
    _setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Skip if in input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            
            switch (e.key) {
                case '+':
                case '=':
                    e.preventDefault();
                    this.setOpacity(Math.min(100, this.state.opacity + 10));
                    break;
                case '-':
                    e.preventDefault();
                    this.setOpacity(Math.max(0, this.state.opacity - 10));
                    break;
                case 'b':
                    e.preventDefault();
                    this._cycleLayerType();
                    break;
            }
        });
    }

    /**
     * Cycle through layer types
     */
    _cycleLayerType() {
        const types = ['multiclass', 'binary'];
        const currentIndex = types.indexOf(this.state.layerType);
        const nextType = types[(currentIndex + 1) % types.length];
        this.setLayerType(nextType);
    }

    /**
     * Update opacity display without triggering callback
     */
    _updateOpacityDisplay(value) {
        if (this.elements.opacityValue) {
            this.elements.opacityValue.textContent = `${value}%`;
        }
    }

    /**
     * Set opacity
     */
    setOpacity(value) {
        value = Math.max(0, Math.min(100, value));
        this.state.opacity = value;
        
        if (this.elements.opacitySlider) {
            this.elements.opacitySlider.value = value;
        }
        this._updateOpacityDisplay(value);
        
        const normalizedOpacity = value / 100;
        eventBus.emit(AppEvents.OPACITY_CHANGE, normalizedOpacity);
        
        if (this.onOpacityChange) {
            this.onOpacityChange(normalizedOpacity);
        }
    }

    /**
     * Get current opacity (0-1)
     */
    getOpacity() {
        return this.state.opacity / 100;
    }

    /**
     * Set base map style
     */
    setStyle(style) {
        this.state.style = style;
        
        if (this.elements.baseMapStyle) {
            this.elements.baseMapStyle.value = style;
        }
        
        this.logger.info(`Base map style: ${style}`);
        eventBus.emit(AppEvents.MAP_STYLE_CHANGE, style);
        
        if (this.onStyleChange) {
            this.onStyleChange(style);
        }
    }

    /**
     * Get current style
     */
    getStyle() {
        return this.state.style;
    }

    /**
     * Set layer type
     */
    setLayerType(layerType) {
        if (!LEGEND_CONFIGS[layerType]) return;
        
        this.state.layerType = layerType;
        
        if (this.elements.floodLayerType) {
            this.elements.floodLayerType.value = layerType;
        }
        
        this._updateLegend(layerType);
        this.logger.info(`Layer type: ${layerType}`);
        eventBus.emit(AppEvents.LAYER_TYPE_CHANGE, layerType);
        
        if (this.onLayerTypeChange) {
            this.onLayerTypeChange(layerType);
        }
    }

    /**
     * Get current layer type
     */
    getLayerType() {
        return this.state.layerType;
    }

    /**
     * Update legend display
     */
    _updateLegend(layerType) {
        const { legendItems, legendTitle } = this.elements;
        if (!legendItems || !legendTitle) return;
        
        const config = LEGEND_CONFIGS[layerType];
        legendTitle.textContent = config.title;
        
        legendItems.innerHTML = config.items.map(item => {
            const colorStyle = item.colors 
                ? `background: linear-gradient(to right, ${item.colors[0]}, ${item.colors[1]});`
                : `background: ${item.color};`;
            
            return `
                <div class="legend-item">
                    <div class="legend-color" style="${colorStyle}" role="presentation"></div>
                    <span class="legend-label">${item.label}</span>
                    <span class="legend-severity ${item.severity}">${item.severityLabel}</span>
                </div>
            `;
        }).join('');
    }

    /**
     * Show loading overlay
     */
    showLoading(message = 'Loading PMTiles...') {
        this.state.isLoading = true;
        
        if (this.elements.loadingOverlay) {
            this.elements.loadingOverlay.style.display = 'flex';
        }
        if (this.elements.loadingText) {
            this.elements.loadingText.textContent = message;
        }
        
        eventBus.emit(AppEvents.LOADING_START, { message });
    }

    /**
     * Hide loading overlay
     */
    hideLoading() {
        this.state.isLoading = false;
        
        if (this.elements.loadingOverlay) {
            this.elements.loadingOverlay.style.display = 'none';
        }
        
        eventBus.emit(AppEvents.LOADING_END);
    }

    /**
     * Check if currently loading
     */
    isLoading() {
        return this.state.isLoading;
    }

    /**
     * Show a subtle batch transition indicator (non-blocking)
     * This appears briefly during batch switches without blocking interaction
     */
    showBatchTransitionIndicator() {
        // Create indicator if it doesn't exist
        if (!this._batchTransitionIndicator) {
            this._batchTransitionIndicator = document.createElement('div');
            this._batchTransitionIndicator.className = 'batch-transition-indicator';
            this._batchTransitionIndicator.innerHTML = `
                <div class="batch-transition-spinner"></div>
                <span>Loading next batch...</span>
            `;
            this._batchTransitionIndicator.style.cssText = `
                position: fixed;
                bottom: 80px;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(30, 58, 138, 0.9);
                color: white;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 12px;
                display: flex;
                align-items: center;
                gap: 8px;
                z-index: 1000;
                box-shadow: 0 2px 10px rgba(0,0,0,0.2);
                opacity: 0;
                transition: opacity 0.2s ease;
            `;
            document.body.appendChild(this._batchTransitionIndicator);
            
            // Add spinner styles if not already present
            if (!document.getElementById('batch-transition-styles')) {
                const style = document.createElement('style');
                style.id = 'batch-transition-styles';
                style.textContent = `
                    .batch-transition-spinner {
                        width: 14px;
                        height: 14px;
                        border: 2px solid rgba(255,255,255,0.3);
                        border-top-color: white;
                        border-radius: 50%;
                        animation: batch-spin 0.8s linear infinite;
                    }
                    @keyframes batch-spin {
                        to { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }
        }
        
        // Show with fade-in
        this._batchTransitionIndicator.style.display = 'flex';
        requestAnimationFrame(() => {
            this._batchTransitionIndicator.style.opacity = '1';
        });
    }

    /**
     * Hide the batch transition indicator
     */
    hideBatchTransitionIndicator() {
        if (this._batchTransitionIndicator) {
            this._batchTransitionIndicator.style.opacity = '0';
            setTimeout(() => {
                if (this._batchTransitionIndicator) {
                    this._batchTransitionIndicator.style.display = 'none';
                }
            }, 200);
        }
    }

    /**
     * Get current state
     */
    getState() {
        return { ...this.state };
    }
}

export default UIController;
