/**
 * Time Controller Module
 * Manages time slot selection and playback with dynamic slot discovery.
 */

import { eventBus, AppEvents } from './event-bus.js';
import apiBridge from './api-bridge.js';

class TimeController {
    constructor(config, logger) {
        this.logger = logger;
        this.timeSlots = config.timeSlots || [];
        this.currentIndex = 0;
        this.isPlaying = false;
        this.playbackInterval = null;
        this.playbackSpeed = config.playbackSpeed || 1500;
        
        // DOM elements
        this.elements = {
            slider: document.getElementById('timeSlider'),
            currentTime: document.getElementById('currentTime'),
            timeStart: document.getElementById('timeStart'),
            timeEnd: document.getElementById('timeEnd'),
            playPauseBtn: document.getElementById('playPauseBtn')
        };
        
        // Callbacks (for backward compatibility)
        this.onTimeChange = null;
        
        this._init();
    }

    async _init() {
        // Try to fetch dynamic time slots from server
        await this._loadDynamicTimeSlots();
        
        this._setupSlider();
        this._setupEventListeners();
        
        this.logger.success(`Time controller initialized with ${this.timeSlots.length} slots`);
    }

    /**
     * Fetch time slots from server API
     */
    async _loadDynamicTimeSlots() {
        try {
            const response = await apiBridge.getConfig();
            if (response.success && response.config?.timeSlots?.length > 0) {
                this.timeSlots = response.config.timeSlots;
                this.logger.info(`Loaded ${this.timeSlots.length} time slots from server`);
                eventBus.emit(AppEvents.TIME_SLOTS_UPDATED, this.timeSlots);
            }
        } catch (error) {
            this.logger.warning('Using fallback time slots', error.message);
        }
    }

    /**
     * Setup slider control
     */
    _setupSlider() {
        const { slider, timeStart, timeEnd, currentTime } = this.elements;
        
        if (!slider) return;
        
        slider.min = 0;
        slider.max = Math.max(0, this.timeSlots.length - 1);
        slider.value = this.currentIndex;
        
        // Update labels
        if (this.timeSlots.length > 0) {
            if (timeStart) timeStart.textContent = this._formatTimeSlot(this.timeSlots[0]);
            if (timeEnd) timeEnd.textContent = this._formatTimeSlot(this.timeSlots[this.timeSlots.length - 1]);
            if (currentTime) currentTime.textContent = this._formatDisplayTime(this.timeSlots[0]);
        }
    }

    /**
     * Setup event listeners
     */
    _setupEventListeners() {
        const { slider, playPauseBtn } = this.elements;
        
        // Slider input with debounce
        let sliderTimeout;
        slider?.addEventListener('input', (e) => {
            const index = parseInt(e.target.value, 10);
            
            // Update display immediately
            this._updateCurrentTimeDisplay(index);
            
            // Debounce actual time change to prevent rapid PMTiles loading
            clearTimeout(sliderTimeout);
            sliderTimeout = setTimeout(() => {
                this.setTimeIndex(index);
            }, 150);
        });
        
        // Play/Pause button
        playPauseBtn?.addEventListener('click', () => this.togglePlayPause());
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Only handle if not in input
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
            
            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    this.togglePlayPause();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    this.previous();
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    this.next();
                    break;
            }
        });
    }

    /**
     * Update current time display without triggering load
     */
    _updateCurrentTimeDisplay(index) {
        const { currentTime } = this.elements;
        if (currentTime && this.timeSlots[index]) {
            currentTime.textContent = this._formatDisplayTime(this.timeSlots[index]);
        }
    }

    /**
     * Format time slot for end labels (HH:MM)
     */
    _formatTimeSlot(timeSlot) {
        if (!timeSlot || timeSlot.length < 12) return timeSlot || '--:--';
        return `${timeSlot.substring(8, 10)}:${timeSlot.substring(10, 12)}`;
    }

    /**
     * Format time slot for display (full date-time)
     */
    _formatDisplayTime(timeSlot) {
        if (!timeSlot || timeSlot.length < 12) return timeSlot || 'N/A';
        
        const year = timeSlot.substring(0, 4);
        const month = timeSlot.substring(4, 6);
        const day = timeSlot.substring(6, 8);
        const hour = timeSlot.substring(8, 10);
        const minute = timeSlot.substring(10, 12);
        
        return `${day}/${month}/${year} ${hour}:${minute}`;
    }

    /**
     * Set current time index
     */
    setTimeIndex(index, skipEmit = false) {
        if (index < 0 || index >= this.timeSlots.length) return;
        if (index === this.currentIndex) return;
        
        this.currentIndex = index;
        
        // Update slider
        if (this.elements.slider) {
            this.elements.slider.value = index;
        }
        
        // Update display
        this._updateCurrentTimeDisplay(index);
        
        if (!skipEmit) {
            const timeSlot = this.timeSlots[index];
            
            // Emit event
            eventBus.emit(AppEvents.TIME_CHANGE, { timeSlot, index });
            
            // Call legacy callback
            if (this.onTimeChange) {
                this.onTimeChange(timeSlot, index);
            }
        }
    }

    /**
     * Get current time slot
     */
    getCurrentTimeSlot() {
        return this.timeSlots[this.currentIndex] || null;
    }

    /**
     * Get current index
     */
    getCurrentIndex() {
        return this.currentIndex;
    }

    /**
     * Get all time slots
     */
    getTimeSlots() {
        return [...this.timeSlots];
    }

    /**
     * Go to next time slot
     */
    next() {
        const nextIndex = (this.currentIndex + 1) % this.timeSlots.length;
        this.setTimeIndex(nextIndex);
    }

    /**
     * Go to previous time slot
     */
    previous() {
        const prevIndex = this.currentIndex === 0 
            ? this.timeSlots.length - 1 
            : this.currentIndex - 1;
        this.setTimeIndex(prevIndex);
    }

    /**
     * Toggle play/pause
     */
    togglePlayPause() {
        this.isPlaying ? this.pause() : this.play();
    }

    /**
     * Start playback
     */
    play() {
        if (this.isPlaying || this.timeSlots.length < 2) return;
        
        this.isPlaying = true;
        this._updatePlayPauseButton();
        this.logger.info('Starting time playback');
        eventBus.emit(AppEvents.TIME_PLAY);
        
        this.playbackInterval = setInterval(() => {
            this.next();
        }, this.playbackSpeed);
    }

    /**
     * Pause playback
     */
    pause() {
        if (!this.isPlaying) return;
        
        this.isPlaying = false;
        this._updatePlayPauseButton();
        this.logger.info('Paused time playback');
        eventBus.emit(AppEvents.TIME_PAUSE);
        
        if (this.playbackInterval) {
            clearInterval(this.playbackInterval);
            this.playbackInterval = null;
        }
    }

    /**
     * Update play/pause button state
     */
    _updatePlayPauseButton() {
        const btn = this.elements.playPauseBtn;
        if (!btn) return;
        
        if (this.isPlaying) {
            btn.innerHTML = '⏸️ Pause';
            btn.classList.add('playing');
            btn.setAttribute('aria-pressed', 'true');
        } else {
            btn.innerHTML = '▶️ Play';
            btn.classList.remove('playing');
            btn.setAttribute('aria-pressed', 'false');
        }
    }

    /**
     * Set playback speed
     */
    setPlaybackSpeed(speed) {
        this.playbackSpeed = speed;
        if (this.isPlaying) {
            this.pause();
            this.play();
        }
    }

    /**
     * Update time slots dynamically
     */
    updateTimeSlots(newSlots) {
        this.pause();
        this.timeSlots = newSlots;
        this.currentIndex = 0;
        this._setupSlider();
        eventBus.emit(AppEvents.TIME_SLOTS_UPDATED, newSlots);
    }

    /**
     * Cleanup resources
     */
    destroy() {
        this.pause();
    }
}

export default TimeController;
