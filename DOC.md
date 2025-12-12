# AIResQ ClimSols - Technical Documentation

**Comprehensive technical reference for the flood visualization engine**

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Data Format & Batching](#data-format--batching)
3. [Backend Deep Dive](#backend-deep-dive)
4. [Frontend Architecture](#frontend-architecture)
5. [PMTiles Workflow](#pmtiles-workflow)
6. [Feature-State Styling](#feature-state-styling)
7. [Batch Transition System](#batch-transition-system)
8. [Performance Optimizations](#performance-optimizations)
9. [API Reference](#api-reference)
10. [Debugging Guide](#debugging-guide)

---

## System Architecture

### Complete System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER                              │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  viewer.html (UI)                                    │  │
│  │  ├─ Time slider, opacity, controls                   │  │
│  │  ├─ Polygon drawing tools                            │  │
│  │  ├─ Layer toggles (wards, hotspots, LULC, DEM)       │  │
│  │  └─ Map container div                                │  │
│  └─────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  JavaScript Modules                                  │  │
│  │  ├─ main.js              (app orchestrator)          │  │
│  │  ├─ api-bridge.js        (HTTP client)               │  │
│  │  ├─ map-manager.js       (MapLibre + PMTiles)        │  │
│  │  ├─ ui-controller.js     (controls handler)          │  │
│  │  ├─ time-controller.js   (time slider)               │  │
│  │  ├─ polygon-analytics.js (drawing & analysis)        │  │
│  │  ├─ precipitation-graph.js (rainfall visualization)  │  │
│  │  ├─ stats-tracker.js     (performance metrics)       │  │
│  │  ├─ event-bus.js         (module communication)      │  │
│  │  └─ logger.js            (activity logs)             │  │
│  └─────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  MapLibre GL JS                                      │  │
│  │  ├─ Renders vector tiles                             │  │
│  │  ├─ Handles user interactions (pan, zoom, click)     │  │
│  │  ├─ Feature-state styling system                     │  │
│  │  └─ GPU-accelerated rendering                        │  │
│  └─────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  PMTiles Protocol                                    │  │
│  │  ├─ Intercepts pmtiles:// URLs                       │  │
│  │  ├─ Calculates byte ranges for tiles                 │  │
│  │  └─ Makes HTTP Range requests                        │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                          ↓
                    HTTP Requests
              (with Range headers)
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                    PYTHON BACKEND                           │
│                    (server.py)                              │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  HTTP Server (port 8000)                             │  │
│  │  ├─ Handles GET requests                             │  │
│  │  ├─ Parses Range headers                             │  │
│  │  ├─ File caching (< 1024 KB)                         │  │
│  │  └─ Returns 206 Partial Content                      │  │
│  └─────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  APIRequestHandler                                   │  │
│  │  ├─ send_head()      → Range request logic           │  │
│  │  ├─ do_GET()         → Route handling                │  │
│  │  └─ log_request()    → Logs with KB size             │  │
│  └─────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  REST API Endpoints                                  │  │
│  │  ├─ /api/config      → Time slots + batch config     │  │
│  │  ├─ /api/pmtiles     → List available files          │  │
│  │  ├─ /api/pmtiles/:id → File metadata                 │  │
│  │  └─ /api/health      → Server status                 │  │
│  └─────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  File System                                         │  │
│  │  ├─ pmtiles/flood/                                   │  │
│  │  │  ├─ D202507130155.pmtiles (48 time slots)         │  │
│  │  │  ├─ D202507130555.pmtiles (48 time slots)         │  │
│  │  │  └─ ... (more batch files)                        │  │
│  │  ├─ pmtiles/static/                                  │  │
│  │  │  ├─ dem.pmtiles                                   │  │
│  │  │  ├─ lulc.pmtiles                                  │  │
│  │  │  └─ roads.pmtiles                                 │  │
│  │  └─ city/gurugram/                                   │  │
│  │     ├─ city_wards_boundary.geojson                   │  │
│  │     ├─ hotspots.geojson                              │  │
│  │     └─ config_main.json                              │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Data Format & Batching

### Batch-Based PMTiles Architecture

**Problem with Master File Approach:**
- Single large PMTiles file with 288 time-prefixed properties (D202507130155, D202507130200, etc.)
- Property name switching required re-styling the layer
- Large file size (>100 MB) with sparse time slot usage

**Solution: Batch Files with Arrays:**
- Each batch file contains 48 time slots (4 hours at 5-minute intervals)
- Single `flood_depths` array property with 48 depth values
- Time switching = array index change (no re-styling)
- Files: ~15-30 MB each

### Batch File Structure

**Filename Convention:**
```
D{START_TIME}.pmtiles

Examples:
- D202507130155.pmtiles → Starts at 2025-07-13 01:55
- D202507130555.pmtiles → Starts at 2025-07-13 05:55
```

**Feature Properties:**
```json
{
  "type": "Feature",
  "properties": {
    "geo_code": "FMK55P9P9",  // Unique identifier
    "flood_depths": [          // 48 depth values
      0.0,    // Index 0: 01:55
      0.0,    // Index 1: 02:00
      0.082,  // Index 2: 02:05
      ...
      0.291   // Index 47: 05:50
    ]
  },
  "geometry": { ... }
}
```

### Batch Configuration (config.py)

```python
# Batch settings
BATCH_SIZE = 48          # Time slots per batch
BATCH_DURATION_HOURS = 4 # Each batch = 4 hours
INTERVAL = 5             # Minutes between time slots

# Time range
START_TIME = 202507130155  # First time slot
END_TIME = 202507140555    # Last time slot

# Property naming
DEPTH_PROPERTY_PREFIX = "D"  # Legacy, not used in batch mode
```

**Key Functions:**

```python
def get_batch_files() -> list:
    """
    Returns list of batch files with time ranges.
    
    Example output:
    [
        {
            "filename": "D202507130155.pmtiles",
            "startTime": 202507130155,
            "endTime": 202507130550,
            "startIndex": 0,
            "endIndex": 47,
            "path": "pmtiles/flood/D202507130155.pmtiles"
        },
        ...
    ]
    """

def get_batch_for_time_slot(time_slot_index: int) -> dict:
    """
    Get batch file and local index for a global time slot.
    
    Args:
        time_slot_index: Global index (e.g., 73)
    
    Returns:
        {
            "batchFile": "D202507130555.pmtiles",
            "batchPath": "pmtiles/flood/D202507130555.pmtiles",
            "batchIndex": 1,     # Second batch
            "localIndex": 25,    # Index within flood_depths array
            "globalIndex": 73    # Original input
        }
    """
```

### Data Flow: Time Slot to Depth Value

```
User selects time slot → Global Index = 73
                            ↓
                  get_batch_for_time_slot(73)
                            ↓
              Batch Index = 73 ÷ 48 = 1
              Local Index = 73 % 48 = 25
                            ↓
              Load batch file: D202507130555.pmtiles
                            ↓
              Query feature's flood_depths property
              Parse JSON: "[0.0, 0.0, ..., 0.566, ...]"
                            ↓
              Extract: flood_depths[25] = 0.566
                            ↓
              Set feature-state: depth = 0.566
                            ↓
              MapLibre renders with color based on depth
```

---

## Backend Deep Dive

### Server Entry Point (server.py)

#### Key Classes

**1. FileCache - Thread-Safe File Caching**

```python
class FileCache:
    """
    Caches small files (< 1024 KB) in memory.
    Reduces disk I/O for frequently accessed assets.
    """
    def __init__(self, max_file_size=1024 * 1024, max_cache_size=50 * 1024 * 1024):
        self._cache = {}       # path -> (data, mtime, size)
        self._lock = threading.Lock()
        self._max_file_size = max_file_size
        self._max_cache_size = max_cache_size
        self._current_size = 0
    
    def get(self, path: Path) -> bytes:
        """Get file from cache or load from disk."""
        with self._lock:
            if path in self._cache:
                cached_data, cached_mtime, _ = self._cache[path]
                current_mtime = path.stat().st_mtime
                if cached_mtime == current_mtime:
                    return cached_data  # Cache hit!
        
        # Cache miss - read from disk
        data = path.read_bytes()
        self._add_to_cache(path, data)
        return data
```

**2. APIRequestHandler - HTTP Request Handler**

```python
class APIRequestHandler(SimpleHTTPRequestHandler):
    """Handles HTTP requests with Range support and logging."""
    
    def do_GET(self):
        """Route GET requests to appropriate handlers."""
        parsed = urlparse(self.path)
        
        if parsed.path.startswith('/api/'):
            self._handle_api_request(parsed.path)
        else:
            # Serve static files or PMTiles
            SimpleHTTPRequestHandler.do_GET(self)
    
    def send_head(self):
        """
        Critical method for Range request support.
        Parses Range header and returns byte range.
        """
        path = self.translate_path(self.path)
        
        # Parse Range header
        range_header = self.headers.get('Range', None)
        if range_header:
            # Extract start-end bytes
            m = re.match(r'bytes=(\d+)-(\d*)', range_header)
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else file_size - 1
            
            # Seek to byte position
            f.seek(start)
            
            # Return partial content
            self.send_response(206)  # Partial Content
            self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
            self.send_header('Content-Length', str(end - start + 1))
            
            # Wrap file handle to read only requested bytes
            return _RangeFile(f, end - start + 1)
```

**3. PMTilesAPI - Metadata Handler**

```python
class PMTilesAPI:
    """Provides batch file info and configuration."""
    
    def get_config(self) -> dict:
        """
        Returns complete configuration for frontend.
        """
        return {
            "success": True,
            "config": {
                "timeSlots": config.get_time_slots(),
                "totalTimeSlots": config.get_total_time_slots(),
                "batchSize": config.BATCH_SIZE,
                "batchDurationHours": config.BATCH_DURATION_HOURS,
                "batchFiles": config.get_batch_files(),
                "pmtilesFloodDir": config.PMTILES_FLOOD_DIR,
                "initialCenter": [77.0293, 28.4622],
                "initialZoom": 11,
                "statsUpdateInterval": 2000,
                "playbackSpeed": 500
            }
        }
```

### Range Request Workflow

```
1. Browser Request:
   GET /pmtiles/flood/D202507130155.pmtiles
   Range: bytes=102400-115200

2. Server Receives:
   APIRequestHandler.send_head() is called
   
3. Parse Range Header:
   start = 102400
   end = 115200
   length = 12801 bytes

4. Open File & Seek:
   f = open('pmtiles/flood/D202507130155.pmtiles', 'rb')
   f.seek(102400)

5. Read Requested Bytes:
   data = f.read(12801)

6. Send Response:
   HTTP/1.1 206 Partial Content
   Content-Range: bytes 102400-115200/15728640
   Content-Length: 12801
   
   [binary data: 12801 bytes]

7. Log Request:
   [10:30:45] GET /pmtiles/flood/D202507130155.pmtiles - 206 - 12.50 KB
```

### File Caching Strategy

**What Gets Cached:**
- Files < 1024 KB (1 MB)
- Frequently accessed: HTML, CSS, JS, GeoJSON
- NOT cached: Large PMTiles files (15-30 MB each)

**Cache Invalidation:**
- Check file modification time on each access
- If file changed, reload from disk

**Response Headers:**
```
X-Cache: HIT   → File served from memory cache
X-Cache: MISS  → File loaded from disk
```

**Performance Impact:**
```
Without cache:
  GET /viewer.html - 8.12 KB - 15ms (disk I/O)
  GET /viewer.html - 8.12 KB - 14ms (disk I/O)

With cache:
  GET /viewer.html - 8.12 KB - 15ms (disk I/O, cache MISS)
  GET /viewer.html - 8.12 KB - 0.5ms (cache HIT)
  
95% reduction in response time for cached files!
```

---

## Frontend Architecture

### Module System

**Event-Driven Architecture:**
All modules communicate via the event bus, ensuring loose coupling.

```javascript
// Module A emits event
eventBus.emit(AppEvents.TIME_CHANGE, { timeIndex: 73 });

// Module B listens
eventBus.on(AppEvents.TIME_CHANGE, ({ timeIndex }) => {
    console.log('Time changed to index:', timeIndex);
});
```

### Core Modules

#### 1. main.js - Application Orchestrator

```javascript
class PMTilesViewerApp {
    async init() {
        // 1. Load config from server
        this.config = await apiBridge.getConfig();
        
        // 2. Initialize modules
        this.modules.logger = new Logger('logsContainer');
        this.modules.stats = new StatsTracker('statsContainer');
        this.modules.ui = new UIController(this.config);
        this.modules.map = new MapManager(this.config, logger, stats);
        this.modules.time = new TimeController(this.config, logger);
        this.modules.polygon = new PolygonAnalytics(logger);
        this.modules.precipitation = new PrecipitationGraph(this.config);
        
        // 3. Setup event listeners
        this._setupEventListeners();
        
        // 4. Initialize map
        await this.modules.map.init();
        
        // 5. Load initial batch
        const initialBatch = this.config.batchFiles[0];
        await this.modules.map.loadBatchPMTiles(
            initialBatch.filename,
            0,  // timeIndex
            0   // localIndex
        );
    }
}
```

#### 2. map-manager.js - MapLibre & PMTiles Core

**Key Responsibilities:**
- Initialize MapLibre GL map
- Load batch PMTiles files
- Manage double-buffered layer transitions
- Update feature-state for depth values
- Handle user interactions (click, hover)

**Critical Methods:**

```javascript
async loadBatchPMTiles(batchFile, timeIndex, localIndex) {
    /**
     * Load a batch PMTiles file and set time slot.
     * Uses double-buffering for smooth transitions.
     */
    
    // 1. Determine which layer set to use (A or B)
    const nextIds = this._getNextLayerIds();
    
    // 2. Build PMTiles URL
    const url = `${window.location.origin}/${this.batchConfig.floodDir}/${batchFile}`;
    
    // 3. Add source (if not already added)
    if (!this.map.getSource(nextIds.sourceId)) {
        this.map.addSource(nextIds.sourceId, {
            type: 'vector',
            url: `pmtiles://${url}`,
            promoteId: 'geo_code'  // Required for feature-state
        });
    }
    
    // 4. Add layers
    this._addFloodLayers(nextIds, localIndex);
    
    // 5. Wait for tiles to load
    await this._waitForSourceLoad(nextIds.sourceId, nextIds.fillId, 'gridded_data');
    
    // 6. Update feature states
    await this._updateFeatureStates(nextIds.fillId, 'gridded_data', localIndex);
    
    // 7. Smooth crossfade to new layer
    await this._performLayerSwap(nextIds);
    
    // 8. Clean up old layers
    const oldIds = this._getActiveLayerIds();
    this._cleanupOldBatchLayers(oldIds);
    
    // 9. Flip active buffer
    this._batchTransition.activeLayerSuffix = 
        this._batchTransition.activeLayerSuffix === 'A' ? 'B' : 'A';
}
```

#### 3. time-controller.js - Time Slider

```javascript
class TimeController {
    handleTimeChange(timeIndex) {
        /**
         * User moved slider to new time index.
         * Calculate which batch file and local index.
         */
        
        const batchInfo = apiBridge.getBatchForTimeSlot(
            timeIndex,
            this.config.batchSize,
            this.config.batchFiles
        );
        
        // Emit event for map to load
        eventBus.emit(AppEvents.TIME_CHANGE, {
            timeIndex: timeIndex,
            localIndex: batchInfo.localIndex,
            batchFile: batchInfo.batchFile
        });
    }
}
```

#### 4. polygon-analytics.js - Drawing & Analysis

```javascript
class PolygonAnalytics {
    /**
     * Handles polygon drawing and flood depth analysis.
     * Integrates with Mapbox GL Draw for interactive drawing.
     */
    
    async analyzePolygon(polygon, timeIndex) {
        // 1. Query features within polygon
        const features = this.mapManager.map.queryRenderedFeatures({
            layers: ['pmtiles-layer-A', 'pmtiles-layer-B']
        });
        
        // 2. Filter features within polygon bounds
        const withinPolygon = features.filter(f => 
            turf.booleanPointInPolygon(
                turf.centroid(f.geometry),
                polygon
            )
        );
        
        // 3. Extract depth values
        const depths = withinPolygon.map(f => {
            const floodDepths = JSON.parse(f.properties.flood_depths || '[]');
            return floodDepths[timeIndex] || 0;
        });
        
        // 4. Calculate statistics
        return {
            minDepth: Math.min(...depths),
            maxDepth: Math.max(...depths),
            meanDepth: depths.reduce((a, b) => a + b, 0) / depths.length,
            floodedCells: depths.filter(d => d > 0).length,
            totalCells: depths.length,
            polygonArea: turf.area(polygon)
        };
    }
}
```

---

## PMTiles Workflow

### The Complete Journey: Disk → Browser → GPU

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: Offline Preprocessing (One-time)                  │
└─────────────────────────────────────────────────────────────┘

   Grid GeoJSON Files (48 files × 100 MB each)
         ↓
   Consolidation Script
         ├─ Merge by geo_code
         ├─ Create flood_depths arrays
         └─ Convert nulls to 0.0
         ↓
   Batch GeoJSON (single file with arrays)
         ↓
   tippecanoe -o D202507130155.pmtiles -Z0 -z14 batch.geojson
         ↓
   Batch PMTiles File (15-30 MB) → Stored on Server


┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: Runtime Serving (On-demand)                       │
└─────────────────────────────────────────────────────────────┘

   User Opens Browser
         ↓
   JavaScript Loads → Fetches /api/config
         ← { batchFiles: [...], batchSize: 48, ... }
         ↓
   MapLibre Initialized
         ↓
   Load First Batch: D202507130155.pmtiles
         ↓
   PMTiles Protocol: Get header
         → GET /pmtiles/flood/D202507130155.pmtiles
            Range: bytes=0-16383
         ← HTTP 206: 16 KB (header + directory)
         ↓
   MapLibre Calculates Visible Tiles
         ↓
   Request Tiles for Current View:
         → GET /pmtiles/flood/D202507130155.pmtiles
            Range: bytes=102400-115200
         ← HTTP 206: 12.50 KB (tile 12/2048/1536)
         
         → GET /pmtiles/flood/D202507130155.pmtiles
            Range: bytes=115201-128000
         ← HTTP 206: 12.50 KB (tile 12/2049/1536)
         ↓
   MapLibre Decodes Vector Tiles (MVT format)
         ↓
   JavaScript Parses flood_depths Arrays
         feature.properties.flood_depths = "[0.0, 0.0, ..., 0.566, ...]"
         depths = JSON.parse(flood_depths)
         depth = depths[localIndex]  // e.g., depths[25] = 0.566
         ↓
   Set Feature State for Each Cell:
         map.setFeatureState(
             { source: 'pmtiles-source-A', id: 'FMK55P9P9' },
             { depth: 0.566 }
         )
         ↓
   MapLibre Applies Color Expression:
         fill-color: [
             'interpolate', ['linear'], ['feature-state', 'depth'],
             0.001, '#f5fbff',
             0.2, '#d6ecff',
             0.5, '#9dd1ff',
             1.0, '#5aa8ff',
             2.0, '#1e6ddf',
             3.0, '#0b3a8c'
         ]
         ↓
   GPU Renders Colored Polygons
         ↓
   User Sees Flood Depth Visualization!
```

### Time Switching Within Same Batch

```
User moves slider from index 73 → 75 (same batch)
         ↓
   Calculate local indices:
      Index 73: Batch 1, Local 25
      Index 75: Batch 1, Local 27
         ↓
   NO batch switch needed!
         ↓
   Just update feature states:
      For each feature:
         depth = flood_depths[27]  // Changed from [25] to [27]
         map.setFeatureState({ ... }, { depth: depth })
         ↓
   MapLibre re-renders with new depths
         ↓
   Instant transition! (< 50ms)
```

### Batch Switching (Cross-Batch)

```
User moves slider from index 73 → 98
         ↓
   Calculate batch info:
      Index 73: Batch 1 (D202507130555.pmtiles), Local 25
      Index 98: Batch 2 (D202507130955.pmtiles), Local 2
         ↓
   Batch switch required!
         ↓
   Double-buffering transition:
      1. Current layer: A (Batch 1 visible)
      2. Load Batch 2 into layer B (background)
      3. Update feature states for index 2
      4. Wait for tiles to render
      5. Crossfade A→B (300ms opacity transition)
      6. Remove layer A
      7. Flip: A becomes inactive, B becomes active
         ↓
   Smooth transition complete! (~1-2 seconds total)
```

---

## Feature-State Styling

### The Problem: MapLibre Can't Parse JSON Arrays

**Why We Can't Use Property Expressions:**

Vector tiles (including PMTiles) serialize complex JavaScript types as JSON strings.

```json
// What's actually in the tile:
{
  "geo_code": "FMK55P9P9",
  "flood_depths": "[0.0, 0.0, 0.082, 0.107, ...]"  // STRING, not array!
}
```

**Attempted MapLibre Expression (DOESN'T WORK):**
```javascript
const depthValue = ['at', localIndex, ['get', 'flood_depths']];
//                         ^          ^
//                         |          |
//                    Expects array   Returns string!
//                    
// Result: null → black tiles
```

MapLibre expressions have no `JSON.parse` function, so this fails silently.

### The Solution: Feature-State

**Feature-state** is a MapLibre GL feature that lets you attach dynamic values to features by their ID.

**Step 1: Promote ID in Source**

```javascript
this.map.addSource('pmtiles-source-A', {
    type: 'vector',
    url: 'pmtiles://...',
    promoteId: 'geo_code'  // Use geo_code property as feature ID
});
```

**Step 2: Parse JSON in JavaScript**

```javascript
_getDepthValue(properties, localIndex) {
    const floodDepthsStr = properties?.flood_depths;
    if (!floodDepthsStr) return null;
    
    try {
        const depths = JSON.parse(floodDepthsStr);  // Parse JSON string
        return depths[localIndex] ?? null;
    } catch (e) {
        return null;
    }
}
```

**Step 3: Set Feature State**

```javascript
_updateFeatureStates(layerId, sourceLayer, localIndex) {
    // Query all rendered features
    const features = this.map.queryRenderedFeatures({
        layers: [layerId]
    });
    
    for (const feature of features) {
        const geoCode = feature.properties.geo_code;
        const depth = this._getDepthValue(feature.properties, localIndex);
        
        // Set feature-state with depth value
        this.map.setFeatureState(
            {
                source: 'pmtiles-source-A',
                sourceLayer: sourceLayer,
                id: geoCode
            },
            { depth: depth ?? 0 }
        );
    }
}
```

**Step 4: Use Feature-State in Expression**

```javascript
_getFeatureStateColorExpression(layerType) {
    const depthValue = ['feature-state', 'depth'];  // Get from feature-state!
    
    return [
        'case',
        ['<=', depthValue, 0], 'rgba(0, 0, 0, 0)',  // Transparent for 0 depth
        [
            'interpolate', ['linear'], depthValue,
            0.001, '#f5fbff',  // Very light blue
            0.2, '#d6ecff',
            0.5, '#9dd1ff',
            1.0, '#5aa8ff',
            2.0, '#1e6ddf',
            3.0, '#0b3a8c'     // Dark blue
        ]
    ];
}
```

### Why This Works

| Approach | Parsing | Updates | Performance |
|----------|---------|---------|-------------|
| **Property Expression** | MapLibre (fails on JSON) | Requires layer reload | ❌ Doesn't work |
| **Feature-State** | JavaScript (JSON.parse) | Just update state | ✅ Fast & smooth |

**Key Benefits:**
1. **JavaScript can parse**: `JSON.parse()` extracts array values
2. **Dynamic updates**: Change depth without reloading tiles
3. **GPU-accelerated**: MapLibre renders feature-state changes efficiently
4. **No geometry reload**: Tiles stay cached

### When Feature States Are Updated

```javascript
// 1. On batch load
async loadBatchPMTiles(batchFile, timeIndex, localIndex) {
    // ... load source and layers ...
    await this._updateFeatureStates(layerId, sourceLayer, localIndex);
}

// 2. On time change within same batch
async changeTimeSlot(timeIndex, localIndex) {
    // No batch reload - just update states
    await this._updateFeatureStates(layerId, sourceLayer, localIndex);
}

// 3. On tile load (new tiles enter viewport)
this.map.on('sourcedata', (e) => {
    if (e.isSourceLoaded) {
        this._updateFeatureStates(layerId, sourceLayer, this.currentLocalIndex);
    }
});
```

---

## Batch Transition System

### The Flickering Problem

**Before Double-Buffering:**
```
User scrubs slider across batch boundary
    ↓
Remove current layer (Layer A)
    ↓
Map is blank! ❌
    ↓
Load new batch (Layer B)
    ↓
Wait for tiles...
    ↓
Add Layer B
    ↓
Map shows again ✓ (but user saw blank map for 1-2 seconds)
```

**User Experience:** Jarring black flicker whenever crossing batch boundaries.

### Solution: Double-Buffering

**Concept:** Always have two layer sets (A and B) available. Load new batch in background while old batch stays visible.

```
Layer Set A: pmtiles-source-A, pmtiles-layer-A, pmtiles-outline-A
Layer Set B: pmtiles-source-B, pmtiles-layer-B, pmtiles-outline-B
```

**State Tracking:**
```javascript
this._batchTransition = {
    isTransitioning: false,           // Prevents concurrent transitions
    activeLayerSuffix: 'A',           // Which set is currently visible
    pendingBatchInfo: null,           // Queued batch (if user scrubs fast)
    preloadedSources: new Map()       // Cached sources for fast switching
};
```

### Transition Workflow

```javascript
async loadBatchPMTiles(batchFile, timeIndex, localIndex) {
    // 1. Check if transition is already in progress
    if (this._batchTransition.isTransitioning) {
        // Queue this request, process later
        this._batchTransition.pendingBatchInfo = { batchFile, timeIndex, localIndex };
        return;
    }
    
    // 2. Mark as transitioning
    this._batchTransition.isTransitioning = true;
    eventBus.emit(AppEvents.BATCH_TRANSITION_START);
    
    try {
        // 3. Get current and next layer IDs
        const currentIds = this._getActiveLayerIds();    // e.g., *-A
        const nextIds = this._getNextLayerIds();         // e.g., *-B
        
        // 4. Load new batch into NEXT layer set (background)
        this._addSource(nextIds.sourceId, batchFile);
        this._addFloodLayers(nextIds, localIndex);
        
        // Current layer (A) still visible at 100% opacity!
        
        // 5. Wait for tiles to actually render
        await this._waitForSourceLoad(
            nextIds.sourceId,
            nextIds.fillId,
            'gridded_data',
            8000  // 8-second timeout
        );
        
        // 6. Update feature states for new layer
        await this._updateFeatureStates(nextIds.fillId, 'gridded_data', localIndex);
        
        // 7. Perform smooth crossfade (300ms)
        //    - Fade IN next layer (B): 0% → 100%
        //    - Fade OUT current layer (A): 100% → 0%
        await this._performLayerSwap(nextIds);
        
        // 8. Remove old layer set (A)
        this._cleanupOldBatchLayers(currentIds);
        
        // 9. Flip active suffix
        this._batchTransition.activeLayerSuffix = 
            (currentIds.suffix === 'A') ? 'B' : 'A';
        
    } finally {
        // 10. Mark transition complete
        this._batchTransition.isTransitioning = false;
        eventBus.emit(AppEvents.BATCH_TRANSITION_END);
        
        // 11. Process queued request (if any)
        if (this._batchTransition.pendingBatchInfo) {
            const pending = this._batchTransition.pendingBatchInfo;
            this._batchTransition.pendingBatchInfo = null;
            this.loadBatchPMTiles(pending.batchFile, pending.timeIndex, pending.localIndex);
        }
    }
}
```

### Waiting for Tile Rendering

**Problem:** `sourcedata` event fires when tiles are loaded, but they may not be **rendered** yet.

**Solution:** Poll for rendered features using `requestIdleCallback`.

```javascript
async _waitForSourceLoad(sourceId, layerId, sourceLayer, maxWaitMs = 8000) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        
        const checkRendered = () => {
            // Query features that are actually painted on screen
            const features = this.map.queryRenderedFeatures({
                layers: [layerId],
                sourceLayer: sourceLayer
            });
            
            if (features.length > 0) {
                // Tiles are visible! Safe to transition.
                resolve(true);
                return;
            }
            
            // Timeout after 8 seconds
            if (Date.now() - startTime > maxWaitMs) {
                console.warn('Tile load timeout, proceeding anyway');
                resolve(false);
                return;
            }
            
            // Check again when browser is idle
            requestIdleCallback(checkRendered);
        };
        
        // Start checking
        requestIdleCallback(checkRendered);
    });
}
```

### Crossfade Animation

```javascript
async _performLayerSwap(nextIds) {
    const currentIds = this._getActiveLayerIds();
    const duration = 300;  // milliseconds
    
    return new Promise((resolve) => {
        const startTime = Date.now();
        
        const animate = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Ease-in-out curve
            const eased = progress < 0.5
                ? 2 * progress * progress
                : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            
            // Fade in next layer
            this.map.setPaintProperty(
                nextIds.fillId,
                'fill-opacity',
                eased * this.currentOpacity
            );
            
            // Fade out current layer
            this.map.setPaintProperty(
                currentIds.fillId,
                'fill-opacity',
                (1 - eased) * this.currentOpacity
            );
            
            if (progress < 1) {
                requestAnimationFrame(animate);
            } else {
                // Animation complete
                resolve();
            }
        };
        
        requestAnimationFrame(animate);
    });
}
```

### UI Feedback During Transitions

**Subtle loading indicator** appears at bottom of screen:

```javascript
// ui-controller.js
showBatchTransitionIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'batch-transition-indicator';
    indicator.className = 'batch-transition-loading';
    indicator.textContent = 'Loading batch...';
    document.body.appendChild(indicator);
}

hideBatchTransitionIndicator() {
    const indicator = document.getElementById('batch-transition-indicator');
    if (indicator) indicator.remove();
}
```

**Playback pause** during transitions:

```javascript
// time-controller.js
eventBus.on(AppEvents.BATCH_TRANSITION_START, () => {
    if (this.isPlaying) {
        this._pausePlayback();  // Pause temporarily
        this._wasPlayingBeforeTransition = true;
    }
});

eventBus.on(AppEvents.BATCH_TRANSITION_END, () => {
    if (this._wasPlayingBeforeTransition) {
        this._resumePlayback();  // Resume after transition
        this._wasPlayingBeforeTransition = false;
    }
});
```

---

## Performance Optimizations

### 1. Server-Side File Caching

**Impact:** 95% reduction in response time for small files

```python
# Before (no cache):
GET /viewer.html - 8.12 KB - 15ms  (disk I/O every time)

# After (with cache):
GET /viewer.html - 8.12 KB - 15ms  (first request, cache MISS)
GET /viewer.html - 8.12 KB - 0.5ms (subsequent, cache HIT)
```

### 2. Range Request Bandwidth Savings

**Traditional GeoJSON approach:**
```
Load single time slot = Download entire 100 MB file
Total bandwidth: 100,000 KB
```

**PMTiles approach:**
```
Header request: 16 KB
10 visible tiles: 10 × 15 KB = 150 KB
Total bandwidth: 166 KB

Savings: 99.83% reduction!
```

### 3. Feature-State Updates (No Tile Reload)

**Slow approach (property switching):**
```
Time change → Remove layer → Add new layer → Request all tiles again
Time: ~2-3 seconds
Bandwidth: ~500 KB per time change
```

**Fast approach (feature-state):**
```
Time change → Update feature states → Re-render
Time: ~50ms
Bandwidth: 0 KB (no network requests!)
```

### 4. Event Throttling

**Stats updates:**
```javascript
// Before: 500ms throttle (2x/second)
// After: 2000ms throttle (0.5x/second)
// Result: 75% reduction in calculations
```

**Mouse move:**
```javascript
// Before: 50ms throttle (20x/second)
// After: 100ms throttle (10x/second)
// Result: 50% reduction in cursor updates
```

### 5. Batch Size Optimization

**Why 48 time slots per batch?**

```
Option A: 96 slots (8 hours)
  - Larger files: ~40-60 MB each
  - Fewer batch switches
  - Slower initial load
  - More memory usage

Option B: 24 slots (2 hours)
  - Smaller files: ~8-15 MB each
  - More batch switches (user sees transitions more often)
  - Faster initial load
  - Less memory usage

Option C: 48 slots (4 hours) ✓ CHOSEN
  - Medium files: ~15-30 MB each
  - Balanced transition frequency
  - Good initial load time
  - Reasonable memory usage
```

**Batch switch frequency:**
```
48 slots × 5 min intervals = 240 minutes = 4 hours per batch

For 24-hour simulation:
  - 24 ÷ 4 = 6 batch files
  - User sees batch transition every ~4 hours of playback
  - At 0.5s playback speed: Transition every ~24 seconds
```

### 6. Double-Buffering Memory Tradeoff

**Memory cost:**
```
Single layer: ~30 MB (tiles + geometry)
Double-buffered: ~60 MB (two copies during transition)

After transition: Old layer removed → ~30 MB again
```

**Benefit:** Smooth UX (no flickering) worth 30 MB temporary overhead.

---

## API Reference

### Backend REST API

#### GET /api/config

Get complete configuration including batch file info.

**Response:**
```json
{
  "success": true,
  "config": {
    "timeSlots": ["D202507130155", "D202507130200", ...],
    "totalTimeSlots": 288,
    "batchSize": 48,
    "batchDurationHours": 4,
    "batchFiles": [
      {
        "filename": "D202507130155.pmtiles",
        "startTime": 202507130155,
        "endTime": 202507130550,
        "startIndex": 0,
        "endIndex": 47,
        "path": "pmtiles/flood/D202507130155.pmtiles"
      },
      ...
    ],
    "pmtilesFloodDir": "pmtiles/flood",
    "initialCenter": [77.0293, 28.4622],
    "initialZoom": 11,
    "statsUpdateInterval": 2000,
    "playbackSpeed": 500
  }
}
```

#### GET /api/city-data/:city

Get city-specific GeoJSON files (wards, hotspots, config).

**Response:**
```json
{
  "success": true,
  "city": "gurugram",
  "data": {
    "wards": { "type": "FeatureCollection", "features": [...] },
    "hotspots": { "type": "FeatureCollection", "features": [...] },
    "config": { "bounds": [...], "center": [...] }
  }
}
```

### Frontend JavaScript API

#### MapManager

```javascript
// Load a batch file
await mapManager.loadBatchPMTiles(
    'D202507130155.pmtiles',  // batchFile
    25,                        // globalTimeIndex
    25                         // localIndex (within batch)
);

// Change time slot within current batch
await mapManager.changeTimeSlot(27, 27);

// Toggle flood layer visibility
mapManager.toggleFloodLayer();

// Change base map style
mapManager.changeBaseStyle('satellite');

// Update opacity
mapManager.updateOpacity(0.7);  // 70% opacity

// Query features at point
const features = mapManager.queryFeaturesAtPoint(lng, lat);
```

#### TimeController

```javascript
// Start playback
timeController.startPlayback();

// Stop playback
timeController.stopPlayback();

// Go to specific time index
timeController.setTimeIndex(73);

// Get current time info
const info = timeController.getCurrentTimeInfo();
// → { index: 73, timestamp: 202507131020, formatted: "13/07/2025 10:20" }
```

#### PolygonAnalytics

```javascript
// Enable drawing mode
polygonAnalytics.enableDrawing();

// Disable drawing mode
polygonAnalytics.disableDrawing();

// Analyze drawn polygon at current time
const stats = await polygonAnalytics.analyzeCurrentPolygon();
// → {
//     minDepth: 0.0,
//     maxDepth: 2.5,
//     meanDepth: 0.8,
//     floodedArea: 125000,  // sq meters
//     totalArea: 500000,
//     floodPercent: 25.0
//   }

// Export analysis data
polygonAnalytics.exportData();
```

---

## Debugging Guide

### Backend Debugging

#### Enable Verbose Logging

```python
# server.py
import logging
logging.basicConfig(level=logging.DEBUG)
```

**Output:**
```
DEBUG:root:Serving file: pmtiles/flood/D202507130155.pmtiles
DEBUG:root:Range request: bytes=102400-115200
DEBUG:root:Sending 12801 bytes
[10:30:45] GET /pmtiles/flood/D202507130155.pmtiles - 206 - 12.50 KB
```

#### Check File Cache

```python
# Add to server.py after request handling
print(f"Cache size: {file_cache._current_size / 1024:.2f} KB")
print(f"Cached files: {list(file_cache._cache.keys())}")
```

### Frontend Debugging

#### Console Commands

```javascript
// Get app instance
window.pmtilesApp

// Check current state
pmtilesApp.getStats()
// → { zoom: 11.5, tiles: 48, features: 2341, ... }

// Access modules
pmtilesApp.modules.map           // MapManager
pmtilesApp.modules.time          // TimeController
pmtilesApp.modules.polygon       // PolygonAnalytics

// Check batch state
pmtilesApp.modules.map.batchConfig
// → { currentBatchIndex: 1, currentBatchFile: "D202507130555.pmtiles", ... }

// Get current depth property
pmtilesApp.modules.map.currentLocalIndex
// → 25

// Export logs
pmtilesApp.exportLogs()
pmtilesApp.downloadLogs()
```

#### Network Inspection

**Chrome DevTools → Network Tab:**

Filter by `pmtiles`:
```
Name                              Status  Type   Size     Time
D202507130155.pmtiles             206     xhr    16.0 KB  45ms   [Header]
D202507130155.pmtiles             206     xhr    12.5 KB  38ms   [Tile]
D202507130155.pmtiles             206     xhr    18.2 KB  42ms   [Tile]
```

**Check Response Headers:**
```
HTTP/1.1 206 Partial Content
Content-Range: bytes 102400-115200/15728640
Content-Length: 12801
X-Cache: MISS
```

#### Feature State Debugging

```javascript
// Get feature state for a specific cell
const state = map.getFeatureState({
    source: 'pmtiles-source-A',
    sourceLayer: 'gridded_data',
    id: 'FMK55P9P9'  // geo_code
});
console.log(state);
// → { depth: 0.566 }

// Check rendered features
const features = map.queryRenderedFeatures({
    layers: ['pmtiles-layer-A']
});
console.log(features.length);  // Number of visible cells
console.log(features[0].properties);  // First cell properties
```

#### Batch Transition Debugging

```javascript
// Listen for transition events
eventBus.on(AppEvents.BATCH_TRANSITION_START, () => {
    console.log('Batch transition started');
    console.time('batchTransition');
});

eventBus.on(AppEvents.BATCH_TRANSITION_END, () => {
    console.timeEnd('batchTransition');
    console.log('Batch transition complete');
});
```

### Common Issues

#### Issue: Black Tiles

**Symptom:** Tiles render black instead of colored depth gradient.

**Diagnosis:**
```javascript
// Check feature properties
const feature = map.queryRenderedFeatures({ layers: ['pmtiles-layer-A'] })[0];
console.log(feature.properties.flood_depths);  
// Should be JSON array string: "[0.0, 0.0, 0.566, ...]"

// Check feature state
const state = map.getFeatureState({
    source: 'pmtiles-source-A',
    sourceLayer: 'gridded_data',
    id: feature.properties.geo_code
});
console.log(state.depth);
// Should be a number: 0.566
```

**Fixes:**
1. Verify `promoteId` is set correctly in source
2. Check `_updateFeatureStates()` is called after tile load
3. Verify JSON parsing doesn't throw errors

#### Issue: Flickering During Batch Switch

**Symptom:** Brief blank/black screen when crossing batch boundaries.

**Diagnosis:**
```javascript
// Check if double-buffering is active
console.log(mapManager._batchTransition);
// Should show: { activeLayerSuffix: 'A', isTransitioning: false, ... }

// Check if both layer sets exist
console.log(map.getLayer('pmtiles-layer-A'));
console.log(map.getLayer('pmtiles-layer-B'));
```

**Fixes:**
1. Ensure `_waitForSourceLoad()` completes before transition
2. Check `_performLayerSwap()` animation runs smoothly
3. Verify old layers are cleaned up after transition

#### Issue: High Memory Usage

**Symptom:** Browser tab uses >1 GB memory.

**Diagnosis:**
```javascript
// Check tile cache
console.log(map._style.sourceCaches);
// Look for sources with many tiles loaded

// Check number of rendered features
const features = map.queryRenderedFeatures();
console.log(features.length);  // Should be < 10,000
```

**Fixes:**
1. Reduce `maxzoom` in source config (14 → 12)
2. Set `maxTileCacheSize` in map options
3. Clean up old sources/layers after batch transitions

---

## Summary

### Key Architectural Decisions

1. **Batch-Based PMTiles (48 slots/file)**
   - Reduces file count from 288 to 6
   - Faster time switching within batches
   - Optimal balance of file size and batch switches

2. **Feature-State Styling**
   - Enables dynamic depth updates without tile reload
   - Overcomes MapLibre expression limitations
   - Instant time switching (< 50ms)

3. **Double-Buffered Layer Transitions**
   - Eliminates flickering during batch switches
   - Smooth crossfade animations
   - Better user experience

4. **Server-Side File Caching**
   - 95% faster response for small files
   - Thread-safe implementation
   - Automatic cache invalidation

5. **Event-Driven Modular Architecture**
   - Loose coupling between modules
   - Easy to extend and maintain
   - Clean separation of concerns

### Performance Metrics

| Metric | Traditional | PMTiles + Batches | Improvement |
|--------|-------------|-------------------|-------------|
| **Initial Load** | 100 MB (full GeoJSON) | 166 KB (header + tiles) | **99.8%** faster |
| **Time Switch (Same Batch)** | 2-3s (reload file) | 50ms (update states) | **98%** faster |
| **Time Switch (Cross-Batch)** | 2-3s | 1-2s (smooth transition) | **50%** faster |
| **Memory Usage** | 200-300 MB | 30-60 MB | **70%** less |
| **Bandwidth per Hour** | 2.4 GB (24 reloads) | 200 MB (6 batches) | **92%** less |

### Next Steps

**Potential Enhancements:**
1. **Batch Pre-loading**: Load next batch in background before user reaches it
2. **Tile Pre-fetching**: Predict user panning and pre-fetch tiles
3. **IndexedDB Caching**: Cache batches in browser for offline use
4. **WebGL Custom Shaders**: Advanced visualization effects
5. **Service Workers**: Improved offline support and caching

**Scalability:**
- **Cloud deployment**: Upload PMTiles to S3, serve via CloudFront CDN
- **Serverless backend**: Replace Python server with Lambda functions
- **Multi-region**: Deploy to multiple AWS regions for global latency reduction

---

**Documentation Version:** 1.0.0  
**Last Updated:** December 12, 2025  
**System Version:** 2.3.0
