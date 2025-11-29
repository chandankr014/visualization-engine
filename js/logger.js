/**
 * Logger Module
 * High-performance logging with batched DOM updates and filtering.
 */

import { eventBus, AppEvents } from './event-bus.js';

class Logger {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.logs = [];
        this.maxLogs = options.maxLogs || 100;
        this.minLevel = options.minLevel || 'info';
        this.enableConsole = options.enableConsole !== false;
        
        // Batched rendering for performance
        this._pendingRender = [];
        this._renderScheduled = false;
        this._batchDelay = 50; // ms
        
        // Log level priorities
        this._levels = { debug: 0, info: 1, success: 2, warning: 3, error: 4 };
        this._icons = { debug: '🔍', info: 'ℹ️', success: '✓', warning: '⚠️', error: '✗' };
    }

    /**
     * Core logging method with batched rendering
     */
    log(level, message, data = null) {
        // Check log level filter
        if (this._levels[level] < this._levels[this.minLevel]) {
            return;
        }
        
        const timestamp = new Date();
        const logEntry = {
            id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp,
            timeString: timestamp.toLocaleTimeString(),
            level,
            message,
            data
        };
        
        this.logs.push(logEntry);
        
        // Emit event for external listeners
        eventBus.emit(AppEvents.LOG_ENTRY, logEntry);
        
        // Console output
        if (this.enableConsole) {
            const consoleMethod = level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'log';
            console[consoleMethod](`[${logEntry.timeString}] [${level.toUpperCase()}]`, message, data || '');
        }
        
        // Trim old logs
        while (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
        
        // Schedule batched render
        this._pendingRender.push(logEntry);
        this._scheduleRender();
        
        return logEntry;
    }

    debug(message, data = null) { return this.log('debug', message, data); }
    info(message, data = null) { return this.log('info', message, data); }
    success(message, data = null) { return this.log('success', message, data); }
    warning(message, data = null) { return this.log('warning', message, data); }
    error(message, data = null) { return this.log('error', message, data); }

    /**
     * Schedule batched DOM render
     */
    _scheduleRender() {
        if (this._renderScheduled) return;
        
        this._renderScheduled = true;
        requestAnimationFrame(() => {
            this._flushRender();
            this._renderScheduled = false;
        });
    }

    /**
     * Flush pending renders to DOM
     */
    _flushRender() {
        if (!this._pendingRender.length || !this.container) return;
        
        const fragment = document.createDocumentFragment();
        
        for (const entry of this._pendingRender) {
            fragment.appendChild(this._createLogElement(entry));
        }
        
        this.container.appendChild(fragment);
        
        // Trim DOM if needed
        while (this.container.children.length > this.maxLogs) {
            this.container.firstChild?.remove();
        }
        
        // Auto-scroll to bottom
        this.container.scrollTop = this.container.scrollHeight;
        
        this._pendingRender = [];
    }

    /**
     * Create log entry DOM element
     */
    _createLogElement(entry) {
        const div = document.createElement('div');
        div.className = `log-entry ${entry.level}`;
        div.id = entry.id;
        
        const icon = this._icons[entry.level] || 'ℹ️';
        const dataHtml = entry.data 
            ? `<div class="log-data">${this._formatData(entry.data)}</div>` 
            : '';
        
        div.innerHTML = `
            <div class="log-header">
                <span class="log-icon">${icon}</span>
                <span class="log-timestamp">${entry.timeString}</span>
            </div>
            <div class="log-message">${this._escapeHtml(entry.message)}</div>
            ${dataHtml}
        `;
        
        return div;
    }

    /**
     * Format data for display
     */
    _formatData(data) {
        try {
            if (typeof data === 'string') return this._escapeHtml(data);
            return this._escapeHtml(JSON.stringify(data, null, 2));
        } catch {
            return '[Object]';
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Set minimum log level
     */
    setLevel(level) {
        if (this._levels[level] !== undefined) {
            this.minLevel = level;
        }
    }

    /**
     * Clear all logs
     */
    clear() {
        this.logs = [];
        this._pendingRender = [];
        if (this.container) {
            this.container.innerHTML = '';
        }
    }

    /**
     * Get all logs, optionally filtered
     */
    getLogs(filter = null) {
        if (!filter) return [...this.logs];
        return this.logs.filter(log => 
            !filter.level || log.level === filter.level
        );
    }

    /**
     * Export logs as JSON
     */
    exportLogs() {
        return JSON.stringify(this.logs, null, 2);
    }

    /**
     * Export logs for download
     */
    downloadLogs() {
        const data = this.exportLogs();
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pmtiles-logs-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
}

export default Logger;
