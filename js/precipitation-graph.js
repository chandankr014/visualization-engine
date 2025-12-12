/**
 * Precipitation Graph Module
 * Displays a synchronized precipitation graph that tracks flood simulation time.
 * 
 * Features:
 * - Interactive line graph showing precipitation over simulation period
 * - Moving pointer synced with flood time slider
 * - Click-to-jump functionality for quick navigation
 * - Responsive sizing (max 30% screen width, 1:4 aspect ratio)
 */

import { eventBus, AppEvents } from './event-bus.js';

class PrecipitationGraph {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        
        // Data
        this.precipitationData = []; // All precip data from CSV
        this.filteredData = []; // Filtered to match config start/end times
        this.timeSlots = [];
        this.currentIndex = 0;
        this.startTime = config.startTime || null;
        this.endTime = config.endTime || null;
        
        // DOM elements
        this.container = null;
        this.canvas = null;
        this.ctx = null;
        this.pointer = null;
        this.tooltip = null;
        
        // Graph dimensions
        this.width = 0;
        this.height = 0;
        this.padding = { top: 25, right: 15, bottom: 30, left: 45 };
        
        // State
        this.isVisible = false;
        this.isDataLoaded = false;
        
        // Time mapping cache
        this._timeToIndexMap = new Map();
        
        this._init();
    }

    _init() {
        this._createContainer();
        this._setupEventListeners();
        this.logger.info('Precipitation graph initialized');
    }

    _createContainer() {
        // Create main container
        this.container = document.createElement('div');
        this.container.id = 'precipitationGraphContainer';
        this.container.className = 'precipitation-graph-container';
        this.container.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            width: 45vw;
            max-width: 600px;
            min-width: 350px;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
            padding: 12px;
            z-index: 1000;
            display: none;
            backdrop-filter: blur(8px);
            border: 1px solid rgba(0, 0, 0, 0.1);
            transition: opacity 0.3s ease, transform 0.3s ease;
        `;

        // Create header
        const header = document.createElement('div');
        header.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px solid #e5e7eb;
        `;
        header.innerHTML = `
            <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 16px;">🌧️</span>
                <span style="font-size: 13px; font-weight: 600; color: #1e3a8a;">Precipitation</span>
            </div>
            <span id="precipCurrentValue" style="font-size: 12px; color: #6b7280; font-family: monospace;">--</span>
        `;
        this.container.appendChild(header);

        // Create canvas wrapper for responsive sizing
        const canvasWrapper = document.createElement('div');
        canvasWrapper.style.cssText = `
            position: relative;
            width: 100%;
        `;

        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'precipitationCanvas';
        this.canvas.style.cssText = `
            width: 100%;
            cursor: pointer;
            border-radius: 6px;
        `;
        canvasWrapper.appendChild(this.canvas);

        // Create pointer line
        this.pointer = document.createElement('div');
        this.pointer.id = 'precipPointer';
        this.pointer.style.cssText = `
            position: absolute;
            top: 0;
            width: 2px;
            height: 100%;
            background: #ef4444;
            pointer-events: none;
            transition: left 0.15s ease-out;
            box-shadow: 0 0 4px rgba(239, 68, 68, 0.5);
        `;
        canvasWrapper.appendChild(this.pointer);

        // Create tooltip
        this.tooltip = document.createElement('div');
        this.tooltip.id = 'precipTooltip';
        this.tooltip.style.cssText = `
            position: absolute;
            background: rgba(15, 23, 42, 0.9);
            color: white;
            padding: 6px 10px;
            border-radius: 6px;
            font-size: 11px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.15s ease;
            white-space: nowrap;
            z-index: 10;
        `;
        canvasWrapper.appendChild(this.tooltip);

        this.container.appendChild(canvasWrapper);

        // Create time labels
        const timeLabels = document.createElement('div');
        timeLabels.style.cssText = `
            display: flex;
            justify-content: space-between;
            margin-top: 4px;
            font-size: 10px;
            color: #9ca3af;
        `;
        timeLabels.innerHTML = `
            <span id="precipStartTime">--:--</span>
            <span id="precipEndTime">--:--</span>
        `;
        this.container.appendChild(timeLabels);

        // Add to DOM
        document.body.appendChild(this.container);

        // Setup canvas context
        this.ctx = this.canvas.getContext('2d');

        // Add resize observer
        this._setupResizeObserver();
    }

    _setupResizeObserver() {
        const resizeObserver = new ResizeObserver(() => {
            this._updateCanvasSize();
            if (this.isDataLoaded) {
                this._draw();
            }
        });
        resizeObserver.observe(this.container);
    }

    _updateCanvasSize() {
        const containerWidth = this.container.clientWidth - 24; // Account for padding
        const aspectRatio = 5; // width:height = 5:1 (more stretched)
        
        this.width = containerWidth;
        this.height = containerWidth / aspectRatio;
        
        // Set canvas size with device pixel ratio for crisp rendering
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = this.width * dpr;
        this.canvas.height = this.height * dpr;
        this.canvas.style.height = `${this.height}px`;
        
        this.ctx.scale(dpr, dpr);
    }

    _setupEventListeners() {
        // Listen for time changes
        eventBus.on(AppEvents.TIME_CHANGE, ({ index }) => {
            this.setCurrentIndex(index);
        });

        // Listen for time slots update
        eventBus.on(AppEvents.TIME_SLOTS_UPDATED, (slots) => {
            this.timeSlots = slots;
            this._buildTimeMapping();
        });

        // Canvas click for time jump
        this.canvas.addEventListener('click', (e) => {
            this._handleCanvasClick(e);
        });

        // Canvas hover for tooltip
        this.canvas.addEventListener('mousemove', (e) => {
            this._handleCanvasHover(e);
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.tooltip.style.opacity = '0';
        });
    }

    /**
     * Load precipitation data from API
     */
    async loadData() {
        try {
            this.logger.info('Loading precipitation data...');
            
            const response = await fetch('/api/precipitation');
            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to load precipitation data');
            }
            
            this.precipitationData = result.data;
            
            // Filter data to match config start/end times
            this._filterDataByConfigTimes();
            
            this.isDataLoaded = true;
            
            this._buildTimeMapping();
            this._updateTimeLabels();
            this._updateCanvasSize();
            this._draw();
            
            this.logger.success(`Loaded ${this.filteredData.length} precipitation records (filtered to simulation period)`);
            return true;
        } catch (error) {
            this.logger.error('Failed to load precipitation data', error.message);
            return false;
        }
    }

    /**
     * Filter precipitation data to match config start/end times
     */
    _filterDataByConfigTimes() {
        if (!this.startTime || !this.endTime) {
            this.filteredData = this.precipitationData;
            return;
        }
        
        this.filteredData = this.precipitationData.filter(d => {
            return d.time >= this.startTime && d.time <= this.endTime;
        });
        
        this.logger.debug(`Filtered precipitation: ${this.precipitationData.length} -> ${this.filteredData.length} records`);
    }

    /**
     * Build mapping from time slot timestamps to precipitation data indices
     */
    _buildTimeMapping() {
        this._timeToIndexMap.clear();
        
        if (!this.timeSlots.length || !this.filteredData.length) return;
        
        // Create a map from timestamp to precip index for O(1) lookup
        const precipTimeMap = new Map();
        this.filteredData.forEach((d, i) => {
            precipTimeMap.set(d.time, i);
        });
        
        // Map each time slot to its corresponding precip index
        this.timeSlots.forEach((slot, slotIndex) => {
            // Extract timestamp from slot (e.g., 'D202507130200' -> 202507130200)
            const timestamp = parseInt(slot.substring(1));
            
            if (precipTimeMap.has(timestamp)) {
                this._timeToIndexMap.set(slotIndex, precipTimeMap.get(timestamp));
            }
        });
    }

    /**
     * Set time slots from config
     */
    setTimeSlots(slots) {
        this.timeSlots = slots;
        this._buildTimeMapping();
        
        if (this.isDataLoaded) {
            this._updateTimeLabels();
            this._draw();
        }
    }

    /**
     * Update time labels from config or filtered data
     */
    _updateTimeLabels() {
        // Use config times if available, otherwise use data bounds
        const startTime = this.startTime || (this.filteredData.length > 0 ? this.filteredData[0].time : null);
        const endTime = this.endTime || (this.filteredData.length > 0 ? this.filteredData[this.filteredData.length - 1].time : null);
        
        if (!startTime || !endTime) return;
        
        const formatTime = (t) => {
            const str = String(t);
            const day = str.substring(6, 8);
            const hour = str.substring(8, 10);
            const min = str.substring(10, 12);
            return `${day}/${str.substring(4,6)} ${hour}:${min}`;
        };
        
        const startLabel = document.getElementById('precipStartTime');
        const endLabel = document.getElementById('precipEndTime');
        
        if (startLabel) startLabel.textContent = formatTime(startTime);
        if (endLabel) endLabel.textContent = formatTime(endTime);
    }

    /**
     * Set current time index and update pointer
     */
    setCurrentIndex(index) {
        this.currentIndex = index;
        this._updatePointer();
        this._updateCurrentValue();
    }

    /**
     * Update pointer position based on current index
     */
    _updatePointer() {
        if (!this.filteredData.length || !this.isVisible) return;
        
        const precipIndex = this._timeToIndexMap.get(this.currentIndex);
        if (precipIndex === undefined) return;
        
        const graphWidth = this.width - this.padding.left - this.padding.right;
        const x = this.padding.left + (precipIndex / (this.filteredData.length - 1)) * graphWidth;
        
        this.pointer.style.left = `${x}px`;
    }

    /**
     * Update current precipitation value display
     */
    _updateCurrentValue() {
        const valueEl = document.getElementById('precipCurrentValue');
        if (!valueEl) return;
        
        const precipIndex = this._timeToIndexMap.get(this.currentIndex);
        if (precipIndex !== undefined && this.filteredData[precipIndex]) {
            const value = this.filteredData[precipIndex].tp * 1000; // Convert to mm
            valueEl.textContent = `${value.toFixed(2)} mm`;
        } else {
            valueEl.textContent = '--';
        }
    }

    /**
     * Handle canvas click to jump to time
     */
    _handleCanvasClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        
        const graphWidth = this.width - this.padding.left - this.padding.right;
        const relativeX = (x - this.padding.left) / graphWidth;
        
        if (relativeX < 0 || relativeX > 1) return;
        
        const precipIndex = Math.round(relativeX * (this.filteredData.length - 1));
        const precipTime = this.filteredData[precipIndex]?.time;
        
        if (!precipTime) return;
        
        // Find the closest time slot
        const timeSlotIndex = this._findClosestTimeSlotIndex(precipTime);
        
        if (timeSlotIndex !== -1) {
            // Emit time change event
            const timeSlot = this.timeSlots[timeSlotIndex];
            eventBus.emit(AppEvents.PRECIP_GRAPH_CLICK, { index: timeSlotIndex, timeSlot });
        }
    }

    /**
     * Find closest time slot index for a given timestamp
     */
    _findClosestTimeSlotIndex(timestamp) {
        let closestIndex = -1;
        let closestDiff = Infinity;
        
        this.timeSlots.forEach((slot, index) => {
            const slotTime = parseInt(slot.substring(1));
            const diff = Math.abs(slotTime - timestamp);
            
            if (diff < closestDiff) {
                closestDiff = diff;
                closestIndex = index;
            }
        });
        
        return closestIndex;
    }

    /**
     * Handle canvas hover for tooltip
     */
    _handleCanvasHover(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        
        const graphWidth = this.width - this.padding.left - this.padding.right;
        const relativeX = (x - this.padding.left) / graphWidth;
        
        if (relativeX < 0 || relativeX > 1) {
            this.tooltip.style.opacity = '0';
            return;
        }
        
        const precipIndex = Math.round(relativeX * (this.filteredData.length - 1));
        const data = this.filteredData[precipIndex];
        
        if (!data) {
            this.tooltip.style.opacity = '0';
            return;
        }
        
        // Format tooltip content
        const timeStr = String(data.time);
        const formattedTime = `${timeStr.substring(6, 8)}/${timeStr.substring(4, 6)} ${timeStr.substring(8, 10)}:${timeStr.substring(10, 12)}`;
        const value = (data.tp * 1000).toFixed(3); // Convert to mm
        
        this.tooltip.innerHTML = `
            <div style="font-weight: 600;">${formattedTime}</div>
            <div>${value} mm</div>
        `;
        
        // Position tooltip
        const tooltipX = Math.min(x, this.width - 100);
        const tooltipY = 10;
        
        this.tooltip.style.left = `${tooltipX}px`;
        this.tooltip.style.top = `${tooltipY}px`;
        this.tooltip.style.opacity = '1';
    }

    /**
     * Draw the precipitation graph
     */
    _draw() {
        if (!this.ctx || !this.filteredData.length) return;
        
        const ctx = this.ctx;
        const data = this.filteredData;
        
        // Clear canvas
        ctx.clearRect(0, 0, this.width, this.height);
        
        // Calculate graph area
        const graphLeft = this.padding.left;
        const graphRight = this.width - this.padding.right;
        const graphTop = this.padding.top;
        const graphBottom = this.height - this.padding.bottom;
        const graphWidth = graphRight - graphLeft;
        const graphHeight = graphBottom - graphTop;
        
        // Find min/max values
        const values = data.map(d => d.tp);
        const minVal = 0;
        const maxVal = Math.max(...values) * 1.1; // Add 10% headroom
        
        // Draw grid lines
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        
        // Horizontal grid lines (5 lines)
        for (let i = 0; i <= 4; i++) {
            const y = graphTop + (graphHeight / 4) * i;
            ctx.beginPath();
            ctx.moveTo(graphLeft, y);
            ctx.lineTo(graphRight, y);
            ctx.stroke();
            
            // Y-axis labels
            const value = ((maxVal - minVal) * (1 - i / 4) + minVal) * 1000; // Convert to mm
            ctx.fillStyle = '#9ca3af';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(`${value.toFixed(1)}`, graphLeft - 5, y + 3);
        }
        
        // Draw area fill
        ctx.beginPath();
        ctx.moveTo(graphLeft, graphBottom);
        
        data.forEach((d, i) => {
            const x = graphLeft + (i / (data.length - 1)) * graphWidth;
            const y = graphBottom - ((d.tp - minVal) / (maxVal - minVal)) * graphHeight;
            
            if (i === 0) {
                ctx.lineTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        
        ctx.lineTo(graphRight, graphBottom);
        ctx.closePath();
        
        // Create gradient for fill
        const gradient = ctx.createLinearGradient(0, graphTop, 0, graphBottom);
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0.05)');
        ctx.fillStyle = gradient;
        ctx.fill();
        
        // Draw line
        ctx.beginPath();
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        
        data.forEach((d, i) => {
            const x = graphLeft + (i / (data.length - 1)) * graphWidth;
            const y = graphBottom - ((d.tp - minVal) / (maxVal - minVal)) * graphHeight;
            
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
        
        ctx.stroke();
        
        // Y-axis label
        ctx.save();
        ctx.translate(12, graphTop + graphHeight / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillStyle = '#6b7280';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Precip (mm)', 0, 0);
        ctx.restore();
    }

    /**
     * Show the precipitation graph
     */
    show() {
        if (this.isVisible) return;
        
        this.container.style.display = 'block';
        this.container.style.opacity = '0';
        this.container.style.transform = 'translateY(20px)';
        
        // Trigger reflow
        this.container.offsetHeight;
        
        this.container.style.opacity = '1';
        this.container.style.transform = 'translateY(0)';
        
        this.isVisible = true;
        
        // Load data if not already loaded
        if (!this.isDataLoaded) {
            this.loadData();
        } else {
            this._updateCanvasSize();
            this._draw();
            this._updatePointer();
        }
        
        this.logger.info('Precipitation graph shown');
    }

    /**
     * Hide the precipitation graph
     */
    hide() {
        if (!this.isVisible) return;
        
        this.container.style.opacity = '0';
        this.container.style.transform = 'translateY(20px)';
        
        setTimeout(() => {
            this.container.style.display = 'none';
        }, 300);
        
        this.isVisible = false;
        this.logger.info('Precipitation graph hidden');
    }

    /**
     * Toggle visibility
     */
    toggle() {
        if (this.isVisible) {
            this.hide();
        } else {
            this.show();
        }
        return this.isVisible;
    }

    /**
     * Check if graph is visible
     */
    isShowing() {
        return this.isVisible;
    }

    /**
     * Destroy the graph and clean up
     */
    destroy() {
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}

export default PrecipitationGraph;
