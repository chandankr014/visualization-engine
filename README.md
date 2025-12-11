# 🌊 AIResQ ClimSols - Flood Visualization Engine

> **Advanced tile-based visualization system for time-series flood depth data**  
> Built with Python backend + JavaScript frontend + MapLibre GL + PMTiles

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.8%2B-blue)](https://www.python.org/)
[![MapLibre](https://img.shields.io/badge/MapLibre-GL-green)](https://maplibre.org/)

---

## 📋 Table of Contents

- [System Overview](#-system-overview)
- [Key Features](#-key-features)
- [Performance Optimizations](#-performance-optimizations)
- [Why PMTiles?](#-why-pmtiles)
- [Tile Serving Workflow](#-tile-serving-workflow-core-concept)
- [Architecture](#-architecture)
- [Backend (Python)](#-backend-python)
- [Frontend (JavaScript)](#-frontend-javascript)
- [Setup Guide](#-setup-guide)
- [API Reference](#-api-reference)
- [Recent Updates](#-recent-updates)

---

## 🎯 System Overview

### What is this?

**AIResQ ClimSols Flood Visualization Engine** is a professional-grade, tile-based geospatial visualization system that displays time-series flood depth data on an interactive map with advanced analytics capabilities.

**Key Components:**
- **Python backend** → Serves pre-processed PMTiles files via HTTP with range request support
- **JavaScript frontend** → Dynamic time-series visualization using MapLibre GL
- **PMTiles format** → Efficient cloud-optimized vector tile storage
- **Master PMTiles** → Single file containing all time-series data (D-prefixed properties)
- **Polygon Analytics** → Draw custom areas and analyze flood impact over time

### Purpose

Traditional approaches load **entire GeoJSON files** (often hundreds of MBs) into the browser, causing:
- Slow initial load times
- High memory usage
- Poor performance on large datasets

**Our solution:**
- Pre-convert GeoJSON → PMTiles (offline)
- Browser requests **only the tiles it needs** for the current view
- Backend streams **byte ranges** (not full files)
- MapLibre renders tiles progressively
- Single master file with time-series properties for efficient time switching

**Result:** Fast loading, low bandwidth, smooth panning/zooming, and instant time-slot switching even with massive time-series datasets.

---

## ✨ Key Features

### 🎨 Visualization

- **Time-Series Animation** - 0.5s interval playback with smooth transitions
- **Dual Visualization Modes** - Multiclass depth gradient or binary flood/no-flood
- **Dynamic Opacity Control** - Real-time transparency adjustment (default 100%)
- **Smart Cell Rendering** - Null/0 depth cells are fully transparent
- **Multiple Base Maps** - OpenStreetMap, Light, Dark, Satellite, Topographic

### 📊 Analytics

- **Polygon Drawing Tool** - Draw custom analysis areas (press 'P' to toggle)
- **Time-Series Charts** - Visualize depth changes over time for drawn areas
- **Real-time Statistics** - Min/max/mean depth, flooded area, total area
- **Visible Area Stats** - Dynamic stats for current map viewport
- **Export Capabilities** - Download analysis data

### 🗺️ Layers

- **Ward Boundaries** - Administrative choropleth overlay
- **Hotspots** - Critical flood-prone locations
- **Roadways** - Infrastructure network visualization  
- **Land Use (LULC)** - Multi-select land classification overlay
- **DEM** - Digital elevation model

### 🚀 Performance

- **Optimized Throttling** - Stats updates every 2s (was causing log spam)
- **Efficient Event Handling** - Reduced mousemove throttle to 100ms
- **Minimal Bandwidth** - Range requests load only visible tiles
- **No Redundant Logging** - Debug-level stats to prevent activity log clutter
- **GPU Acceleration** - Hardware-accelerated rendering via MapLibre GL

---

## ⚡ Performance Optimizations

### Recent Performance Improvements

1. **Activity Log Spam Fix**
   - Changed stats logging from `info` to `debug` level
   - Prevents "Stats: X features..." from flooding activity log every 2 seconds
   - Users only see important application events

2. **Throttling Optimization**
   - Stats update throttle: 500ms → 2000ms (4x reduction in calculations)
   - Mouse move throttle: 50ms → 100ms (2x reduction in cursor updates)
   - Significantly reduced CPU usage during map interactions

3. **Zero-Opacity Rendering**
   - Cells with null/NA/0 depth render at 0% opacity
   - Reduces visual clutter and improves map readability
   - Dynamic opacity expression: `['case', ['!', hasValidDepth], 0, ['<=', depth, 0], 0, 1]`

4. **Single Master PMTiles Architecture**
   - Time switching changes property expression only (no geometry reload)
   - Instant time-slot transitions without network requests
   - All time-series data in one optimized file

5. **Efficient Stats Calculation**
   - Batched DOM updates using `requestAnimationFrame`
   - Filtered null values before calculations
   - Polygon area calculated once (not per grid cell)

---

## � Why PMTiles?

### Traditional Formats vs PMTiles

| Format | Size | Loading | Bandwidth | Cloud-Ready |
|--------|------|---------|-----------|-------------|
| **GeoJSON** | Large (100MB+) | Load all at once | Very high | ❌ |
| **MBTiles** | Medium | Requires tile server | Medium | ❌ |
| **PMTiles** | Small (optimized) | Load only visible tiles | Very low | ✅ |

### PMTiles Benefits

✅ **Single file** → No complex tile server setup  
✅ **HTTP Range requests** → Download only needed bytes  
✅ **Cloud-native** → Works directly on S3/CDN without server  
✅ **Vector tiles** → Client-side styling and interactivity  
✅ **Z-order curve** → Efficient spatial indexing

---

## 🔄 Tile Serving Workflow (Core Concept)

### The Complete Journey: GeoJSON → Browser

```
┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: Offline Preprocessing (One-time)                  │
└─────────────────────────────────────────────────────────────┘

   GeoJSON File (100 MB)
         ↓
   Conversion Tool (tippecanoe, felt, etc.)
         ↓
   PMTiles File (15 MB) → Stored on Backend Server


┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: Runtime Serving (On-demand)                       │
└─────────────────────────────────────────────────────────────┘

   User Opens Browser
         ↓
   JavaScript Loads → Initializes MapLibre GL
         ↓
   User Pans Map to View Area
         ↓
   MapLibre Calculates: "I need tiles 12/2048/1536, 12/2049/1536"
         ↓
   Browser Requests: GET /pmtiles/file.pmtiles
         with HTTP Header: Range: bytes=1024-2048
         ↓
   Python Backend Receives Range Request
         ↓
   Backend Reads ONLY bytes 1024-2048 from file
         ↓
   Backend Responds: HTTP 206 Partial Content
         Size: 1 KB (not 15 MB!)
         ↓
   Browser Receives Tile Data
         ↓
   MapLibre Decodes Vector Tile (MVT format)
         ↓
   MapLibre Renders Geometry on Map (GPU-accelerated)
         ↓
   User Sees Flood Depth Polygons
```

### Why Byte-Range Serving is Game-Changing

**Without Range Requests:**
```
Browser: "Give me the entire 15 MB file"
Server:  "Here's 15 MB" (15,000 KB downloaded)
Browser: "I only needed 50 KB of that..."
```

**With Range Requests (HTTP 206):**
```
Browser: "Give me bytes 1024-2048"
Server:  "Here's 1 KB" (1 KB downloaded)
Browser: "Perfect! That's exactly what I need"
```

**Performance Impact:**
- **15,000 KB** vs **1 KB** per request
- **15,000x** less bandwidth
- **Instant** loading instead of waiting seconds

### How This Enables Cloud-Scale Deployment

PMTiles can be deployed:

1. **Static Server** (this project)
   - Python serves files with Range support
   - No database, no complex setup

2. **Cloud Storage** (S3, GCS, Azure Blob)
   ```
   pmtiles://https://mybucket.s3.amazonaws.com/flood.pmtiles
   ```
   - No backend server needed!
   - Pay only for bytes downloaded
   - Global CDN distribution

3. **GitHub Pages / Netlify**
   - Free static hosting
   - Direct PMTiles loading from CDN

---

## 🏗️ Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER                              │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  viewer.html (UI)                                    │  │
│  │  ├─ Time slider, opacity, controls                   │  │
│  │  └─ Map container div                                │  │
│  └─────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  JavaScript Modules                                  │  │
│  │  ├─ main.js          (app orchestrator)              │  │
│  │  ├─ api-bridge.js    (HTTP client)                   │  │
│  │  ├─ map-manager.js   (MapLibre + PMTiles)            │  │
│  │  ├─ ui-controller.js (controls handler)              │  │
│  │  ├─ time-controller.js (time slider)                 │  │
│  │  ├─ stats-tracker.js (performance metrics)           │  │
│  │  ├─ event-bus.js     (module communication)          │  │
│  │  └─ logger.js        (activity logs)                 │  │
│  └─────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  MapLibre GL JS                                      │  │
│  │  ├─ Renders map tiles                                │  │
│  │  ├─ Handles user interactions (pan, zoom, click)     │  │
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
│  │  ├─ /api/config      → Time slots + settings         │  │
│  │  ├─ /api/pmtiles     → List available files          │  │
│  │  ├─ /api/pmtiles/:id → File metadata                 │  │
│  │  └─ /api/health      → Server status                 │  │
│  └─────────────────────────────────────────────────────┘  │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  File System                                         │  │
│  │  └─ pmtiles/                                         │  │
│  │     ├─ PMTile_202511251600.pmtiles                   │  │
│  │     └─ PMTile_202512011200.pmtiles                   │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🐍 Backend (Python)

### Folder Structure

```
app1/
├── server.py              ← Main entry point
├── pmtiles/               ← PMTiles files stored here
│   ├── PMTile_202511251600.pmtiles
│   └── PMTile_202512011200.pmtiles
├── viewer.html            ← Frontend HTML
├── css/
│   └── styles.css
└── js/
    ├── main.js
    ├── api-bridge.js
    ├── map-manager.js
    └── ...
```

### Main Entry File: `server.py`

**Core Responsibilities:**
1. Serve static files (HTML, CSS, JS)
2. Serve PMTiles with Range request support
3. Provide REST API for configuration
4. Log all requests with size in KB

### Key Classes & Functions

#### 1. `APIRequestHandler` (Main Request Handler)

**Methods:**

- `do_GET()` → Route incoming GET requests
  - `/api/*` → API endpoints
  - `/*` → Static files or PMTiles

- `send_head()` → **Critical for Range Requests**
  - Parses `Range: bytes=start-end` header
  - Opens file and seeks to byte position
  - Returns `206 Partial Content` response
  - **Logs response size in KB**

- `log_request(code, size)` → **Request Logging**
  - Formats size as KB
  - Prints: `[TIME] METHOD PATH - STATUS - SIZE_KB`
  - Example: `[10:30:45] GET /pmtiles/file.pmtiles - 206 - 32.50 KB`

#### 2. `PMTilesAPI` (Metadata Handler)

**Methods:**

- `get_available_files()` → Scans `pmtiles/` directory
  - Returns list of files with time slots
  - Used by frontend to populate time slider

- `get_file_info(filename)` → File details
  - Size, modification date
  - PMTiles header info (version, offsets)

#### 3. `_RangeFile` (Byte Stream Wrapper)

Wraps file handle to read **only** the requested byte range:

```python
class _RangeFile:
    def __init__(self, f, length):
        self.f = f              # File handle
        self.remaining = length  # Bytes left to read
    
    def read(self, size):
        # Only read up to self.remaining bytes
        size = min(size, self.remaining)
        data = self.f.read(size)
        self.remaining -= len(data)
        return data
```

### Where Request Size Logging is Implemented

**Location:** `APIRequestHandler.log_request()` method

**How it works:**

1. `send_head()` calls `self.log_request(206, content_length)` for Range requests
2. `send_head()` calls `self.log_request(200, file_size)` for full file requests
3. `_send_json_response()` calls `self.log_request(status, response_size)` for API responses

**Output Format:**
```
[10:15:30] GET /api/config - 200 - 0.85 KB
[10:15:35] GET /pmtiles/PMTile_202511251600.pmtiles - 206 - 45.32 KB
[10:15:36] GET /pmtiles/PMTile_202511251600.pmtiles - 206 - 12.67 KB
[10:15:37] GET /viewer.html - 200 - 8.12 KB
```

### Starting the Backend

```bash
python server.py          # Runs on port 8000
python server.py 3000     # Runs on port 3000
```

**Server Output:**
```
╔══════════════════════════════════════════════════════════════╗
║           PMTiles Viewer Server v2.0.0                       ║
╠══════════════════════════════════════════════════════════════╣
║  Server:     http://localhost:8000                           ║
║  Viewer:     http://localhost:8000/viewer.html               ║
║  PMTiles Files: 2 found                                      ║
╚══════════════════════════════════════════════════════════════╝
```

---

## 🎨 Frontend (JavaScript)

### Module Structure

The frontend uses an **event-driven modular architecture**:

```
main.js (Orchestrator)
   ↓
   ├─→ api-bridge.js    (Talks to Python backend)
   ├─→ map-manager.js   (MapLibre + PMTiles rendering)
   ├─→ ui-controller.js (Controls like opacity slider)
   ├─→ time-controller.js (Time slider + playback)
   ├─→ stats-tracker.js (Performance metrics)
   ├─→ event-bus.js     (Inter-module communication)
   └─→ logger.js        (Activity logs)
```

### Key Modules

#### 1. **main.js** (Application Orchestrator)

**Responsibilities:**
- Initialize all modules
- Load configuration from backend
- Setup event bus connections
- Handle app lifecycle

**Flow:**
```javascript
1. Load config from /api/config
2. Initialize modules (logger, stats, UI, map)
3. Setup event listeners
4. Load initial PMTiles
5. Start stats updater
```

#### 2. **api-bridge.js** (Backend Communication)

**Methods:**

```javascript
apiBridge.getConfig()           // GET /api/config
apiBridge.getPMTilesList()      // GET /api/pmtiles
apiBridge.getPMTilesInfo(filename) // GET /api/pmtiles/:id
apiBridge.buildPMTilesUrl(timeSlot) // Build PMTiles URL
```

**Features:**
- Promise-based API
- Automatic retries on failure
- Response caching
- Request deduplication

#### 3. **map-manager.js** (MapLibre + PMTiles Core)

**Critical Methods:**

##### `init()` - Initialize MapLibre

```javascript
this.map = new maplibregl.Map({
    container: 'map',
    style: baseStyle,
    center: [77.0293, 28.4622],
    zoom: 11
});

// Setup PMTiles protocol
this.protocol = new pmtiles.Protocol();
maplibregl.addProtocol('pmtiles', this.protocol.tile);
```

##### `loadPMTiles(timeSlot)` - Load Tile Layer

**Step-by-step:**

1. **Build PMTiles URL**
   ```javascript
   const url = `http://localhost:8000/pmtiles/PMTile_${timeSlot}.pmtiles`;
   ```

2. **Create PMTiles instance**
   ```javascript
   const p = new pmtiles.PMTiles(url);
   const metadata = await p.getMetadata();
   const header = await p.getHeader();
   ```

3. **Add source to MapLibre**
   ```javascript
   map.addSource('pmtiles-source', {
       type: 'vector',
       url: `pmtiles://${url}`,  // Special protocol!
       minzoom: 0,
       maxzoom: 14
   });
   ```

4. **Add layer with styling**
   ```javascript
   map.addLayer({
       id: 'pmtiles-layer',
       type: 'fill',
       source: 'pmtiles-source',
       'source-layer': 'gridded_data',
       paint: {
           'fill-color': [
               'interpolate', ['linear'], ['get', 'depth'],
               0, '#f5fbff',    // 0m = light blue
               0.2, '#d6ecff',  // 0.2m
               0.5, '#9dd1ff',  // 0.5m
               1.0, '#5aa8ff',  // 1m
               2.0, '#1e6ddf',  // 2m
               3.0, '#0b3a8c'   // 3m+ = dark blue
           ],
           'fill-opacity': 0.8
       }
   });
   ```

**How Tile URLs are Constructed:**

When MapLibre needs tile `12/2048/1536`, it converts:

```
pmtiles://http://localhost:8000/pmtiles/file.pmtiles
         ↓
pmtiles.Protocol intercepts this
         ↓
Looks up byte offset for tile 12/2048/1536 in PMTiles header
         ↓
Makes HTTP request:
   GET http://localhost:8000/pmtiles/file.pmtiles
   Range: bytes=1024000-1048576
```

#### 4. **ui-controller.js** (UI Controls)

Manages:
- Opacity slider → Emits `OPACITY_CHANGE` event
- Layer type selector → Emits `LAYER_TYPE_CHANGE` event
- Base map style → Emits `MAP_STYLE_CHANGE` event
- Loading overlay

#### 5. **time-controller.js** (Time Slider)

Manages:
- Time slot selection
- Playback (auto-advance through time)
- Emits `TIME_CHANGE` event when user changes time

#### 6. **event-bus.js** (Inter-Module Communication)

**Pattern:**
```javascript
// Module A emits event
eventBus.emit(AppEvents.TIME_CHANGE, { timeSlot: '202512011200' });

// Module B listens for event
eventBus.on(AppEvents.TIME_CHANGE, ({ timeSlot }) => {
    console.log('Time changed to:', timeSlot);
});
```

**Events:**
- `TIME_CHANGE` → Load new PMTiles
- `OPACITY_CHANGE` → Update layer opacity
- `LAYER_TYPE_CHANGE` → Switch visualization mode
- `MAP_STYLE_CHANGE` → Change base map
- `MAP_READY` → Map initialized
- `MAP_LAYER_LOADED` → Tiles loaded successfully

---

## 🔁 Backend ↔ Frontend Data Flow

### Complete Request Cycle

#### Scenario: User Changes Time Slot

```
┌──────────────────────────────────────────────────────────────┐
│  USER ACTION: Moves time slider to "202512011200"           │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND: time-controller.js                                │
│  - Detects slider change                                     │
│  - Emits: AppEvents.TIME_CHANGE                              │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND: main.js (Event Handler)                           │
│  - Receives TIME_CHANGE event                                │
│  - Shows loading overlay                                     │
│  - Calls: mapManager.loadPMTiles('202512011200')             │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND: map-manager.js                                    │
│  - Builds URL: /pmtiles/PMTile_202512011200.pmtiles          │
│  - Creates PMTiles instance                                  │
│  - Calls: p.getHeader() to read file metadata                │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  HTTP REQUEST #1: Get PMTiles Header                         │
│  GET /pmtiles/PMTile_202512011200.pmtiles                    │
│  Range: bytes=0-16383                                        │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  BACKEND: server.py → APIRequestHandler.send_head()          │
│  - Parses Range header: start=0, end=16383                   │
│  - Opens file, seeks to byte 0                               │
│  - Reads 16,384 bytes                                        │
│  - Logs: [10:30:45] GET /pmtiles/... - 206 - 16.00 KB       │
│  - Returns HTTP 206 with header data                         │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND: PMTiles Library                                   │
│  - Parses header (version, root directory offset, bounds)    │
│  - Reads tile directory metadata                             │
│  - Builds tile index                                         │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND: map-manager.js                                    │
│  - Adds source to MapLibre                                   │
│  - Adds styled layer                                         │
│  - MapLibre calculates visible tiles                         │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND: MapLibre GL                                       │
│  - Determines needed tiles: 11/1024/768, 11/1025/768, ...    │
│  - Requests each tile via PMTiles protocol                   │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  HTTP REQUEST #2, #3, #4, ... : Get Individual Tiles         │
│  GET /pmtiles/PMTile_202512011200.pmtiles                    │
│  Range: bytes=102400-115200   (Tile 1)                       │
│                                                              │
│  GET /pmtiles/PMTile_202512011200.pmtiles                    │
│  Range: bytes=115201-128000   (Tile 2)                       │
│                                                              │
│  ... (parallel requests for all visible tiles)               │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  BACKEND: server.py (Multiple Concurrent Range Requests)     │
│  - Each request handled independently                        │
│  - Logs each: [10:30:46] GET /pmtiles/... - 206 - 12.50 KB  │
│  - Returns tile bytes (12-50 KB each)                        │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  FRONTEND: MapLibre GL                                       │
│  - Receives vector tile data (MVT format)                    │
│  - Decodes geometry (polygons, points, lines)                │
│  - Applies styling (colors based on flood depth)             │
│  - Renders to GPU → Screen                                   │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│  USER SEES: Flood depth map rendered on screen!              │
└──────────────────────────────────────────────────────────────┘
```

### Vector Tile Journey: Disk → Network → GPU

```
1. STORAGE (Backend Disk)
   PMTiles file: 15 MB binary file
   Contains: Compressed vector tiles + spatial index
   ↓

2. NETWORK (HTTP Range Request)
   Backend reads specific byte range
   Streams: 12-50 KB per tile (not full 15 MB!)
   ↓

3. DECODING (Browser)
   PMTiles library decompresses tile
   Parses MVT (Mapbox Vector Tile) format
   Extracts: Polygons, properties (depth values)
   ↓

4. STYLING (MapLibre)
   Applies fill-color based on depth property
   Creates: Styled geometries with colors
   ↓

5. RENDERING (GPU)
   Converts vector shapes to pixels
   GPU-accelerated drawing
   Result: Smooth 60 FPS rendering
```

---

## ⚡ Execution Flow

### 1. Backend Starts

```bash
$ python server.py

[Server starts]
  ↓
[Scans pmtiles/ directory]
  ↓
[Finds: PMTile_202511251600.pmtiles, PMTile_202512011200.pmtiles]
  ↓
[Binds to port 8000]
  ↓
[Ready to serve HTTP requests]
```

**Terminal Output:**
```
╔══════════════════════════════════════════════════════════════╗
║           PMTiles Viewer Server v2.0.0                       ║
╠══════════════════════════════════════════════════════════════╣
║  Server:     http://localhost:8000                           ║
║  Viewer:     http://localhost:8000/viewer.html               ║
║  PMTiles Files: 2 found                                      ║
╚══════════════════════════════════════════════════════════════╝
```

### 2. Frontend Loads

```
User opens: http://localhost:8000/viewer.html
  ↓
[Browser downloads HTML, CSS, JS files]
  ↓
[main.js executes]
  ↓
[Fetches: GET /api/config]
  ← Server returns: { timeSlots: ["202511251600", "202512011200"], ... }
  ↓
[Initializes modules: logger, stats, UI, map]
  ↓
[MapLibre creates map container]
  ↓
[Registers PMTiles protocol]
  ↓
[Map fires 'load' event]
```

**Activity Log:**
```
10:30:42  PMTiles Viewer v2.1.0
10:30:42  Initializing application...
10:30:43  Configuration loaded from server
10:30:43  All modules initialized
10:30:43  Map initialized with PMTiles protocol
10:30:44  Map loaded successfully
```

### 3. User Pans Map

```
User drags map
  ↓
[MapLibre detects new viewport bounds]
  ↓
[Calculates which tiles are now visible]
  ↓
[Requests tiles via pmtiles:// protocol]
  ↓
[PMTiles library intercepts]
  ↓
[Makes HTTP Range requests to backend]
  ↓
[Backend streams tile bytes]
  ↓
[MapLibre decodes and renders tiles]
  ↓
[User sees new area of map]
```

**Backend Terminal:**
```
[10:30:50] GET /pmtiles/PMTile_202512011200.pmtiles - 206 - 15.23 KB
[10:30:50] GET /pmtiles/PMTile_202512011200.pmtiles - 206 - 18.45 KB
[10:30:50] GET /pmtiles/PMTile_202512011200.pmtiles - 206 - 12.67 KB
[10:30:51] GET /pmtiles/PMTile_202512011200.pmtiles - 206 - 21.09 KB
```

### 4. User Zooms In

```
User scrolls mousewheel to zoom in
  ↓
[MapLibre increases zoom level: 11 → 12]
  ↓
[Determines higher-resolution tiles needed]
  ↓
[Requests tiles at zoom 12]
  ↓
[Backend serves more detailed tile data]
  ↓
[MapLibre renders higher detail]
```

**Note:** Higher zoom = more tiles = more requests, but each tile is still small (10-50 KB)

### 5. User Changes Time Slot

```
User moves time slider
  ↓
[time-controller.js emits TIME_CHANGE event]
  ↓
[main.js receives event]
  ↓
[Shows loading overlay]
  ↓
[map-manager.js removes old layers]
  ↓
[Loads new PMTiles file]
  ↓
[Requests header + tiles from new file]
  ↓
[Backend serves different .pmtiles file]
  ↓
[MapLibre renders new time slot data]
  ↓
[Hides loading overlay]
```

**Activity Log:**
```
10:35:20  Loading PMTiles: 202512011200
10:35:21  PMTiles loaded in 0.85s
```

---

## 📦 Setup Guide

### Prerequisites

- **Python 3.7+** (No external dependencies required!)
- **Modern web browser** (Chrome, Firefox, Edge, Safari)

### Step 1: Prepare PMTiles Files

**Option A:** Use existing files
- Place `.pmtiles` files in `pmtiles/` directory

**Option B:** Convert GeoJSON to PMTiles

Using [tippecanoe](https://github.com/felt/tippecanoe):
```bash
tippecanoe -o output.pmtiles -Z0 -z14 input.geojson
```

Using [Felt](https://felt.com/):
- Upload GeoJSON to Felt
- Export as PMTiles

**Naming Convention:**
```
PMTile_YYYYMMDDHHMM.pmtiles

Examples:
  PMTile_202511251600.pmtiles  → Nov 25, 2025, 16:00
  PMTile_202512011200.pmtiles  → Dec 01, 2025, 12:00
```

### Step 2: Start Python Backend

```bash
# Navigate to project directory
cd app1

# Start server on default port 8000
python server.py

# Or specify custom port
python server.py 3000
```

**Expected Output:**
```
╔══════════════════════════════════════════════════════════════╗
║           PMTiles Viewer Server v2.0.0                       ║
╠══════════════════════════════════════════════════════════════╣
║  Server:     http://localhost:8000                           ║
║  Viewer:     http://localhost:8000/viewer.html               ║
║  PMTiles Files: 2 found                                      ║
╚══════════════════════════════════════════════════════════════╝
```

### Step 3: Open Frontend

**Method 1:** Direct Browser
```
Open browser → Navigate to http://localhost:8000/viewer.html
```

**Method 2:** Command Line (Windows)
```powershell
Start-Process "http://localhost:8000/viewer.html"
```

**Method 3:** Command Line (Mac/Linux)
```bash
open http://localhost:8000/viewer.html    # Mac
xdg-open http://localhost:8000/viewer.html # Linux
```

### Step 4: Verify Setup

**Check Backend:**
- Terminal shows server running
- No error messages

**Check Frontend:**
1. Map loads and displays
2. Time slider shows available time slots
3. Activity log shows initialization messages
4. Map statistics update when you pan/zoom

**Check Browser Console:**
```javascript
// Open DevTools (F12) → Console
// You should see:
PMTiles Viewer v2.1.0
Available Commands:
  window.pmtilesApp.getVersion()
  window.pmtilesApp.getStats()
```

### Troubleshooting Setup

**Problem:** "No PMTiles files found"
- **Solution:** Add `.pmtiles` files to `pmtiles/` directory

**Problem:** Map doesn't load
- **Solution:** Check browser console for errors
- **Solution:** Verify server is running on correct port

**Problem:** Tiles don't appear
- **Solution:** Check backend logs for 206 responses
- **Solution:** Verify PMTiles files aren't corrupted

**Problem:** CORS errors in browser
- **Solution:** Access via `http://localhost:8000` (not `file://`)

---

## 🐛 Debugging & Performance Monitoring

### Backend Logging

#### Understanding Log Output

**Format:**
```
[HH:MM:SS] METHOD PATH - STATUS - SIZE_KB
```

**Example Logs:**
```
[10:30:42] GET /api/config - 200 - 0.85 KB
[10:30:43] GET /viewer.html - 200 - 8.12 KB
[10:30:45] GET /pmtiles/PMTile_202512011200.pmtiles - 206 - 16.00 KB
[10:30:46] GET /pmtiles/PMTile_202512011200.pmtiles - 206 - 12.50 KB
[10:30:46] GET /pmtiles/PMTile_202512011200.pmtiles - 206 - 15.23 KB
[10:30:46] GET /pmtiles/PMTile_202512011200.pmtiles - 206 - 18.45 KB
```

#### Interpreting HTTP Status Codes

**200 (OK)** - Full file served
```
[10:30:43] GET /viewer.html - 200 - 8.12 KB
```
- Used for: HTML, CSS, JS, API responses
- Size = entire file

**206 (Partial Content)** - Byte range served
```
[10:30:45] GET /pmtiles/PMTile_202512011200.pmtiles - 206 - 16.00 KB
```
- Used for: PMTiles tile requests
- Size = only the requested byte range
- **This is the magic that makes it fast!**

**404 (Not Found)**
```
[10:31:00] GET /pmtiles/missing.pmtiles - 404 - 0 KB
```
- File doesn't exist
- Check filename spelling

#### Understanding Byte Ranges

**Backend Logs:**
```
[10:30:45] GET /pmtiles/file.pmtiles - 206 - 16.00 KB
[10:30:46] GET /pmtiles/file.pmtiles - 206 - 12.50 KB
```

**What's Happening:**
1. **First request (16 KB):** Header + directory metadata
2. **Subsequent requests (12-50 KB each):** Individual tiles

**Behind the Scenes:**
```
Request:  Range: bytes=0-16383
Response: 206 Partial Content
          Content-Range: bytes 0-16383/15728640
          Size: 16.00 KB

Request:  Range: bytes=102400-115200
Response: 206 Partial Content
          Content-Range: bytes 102400-115200/15728640
          Size: 12.50 KB
```

### Frontend Monitoring

#### Activity Logs Panel

Located in left sidebar → "Activity Logs" section

**Example Logs:**
```
10:30:42  PMTiles Viewer v2.1.0
10:30:42  Initializing application...
10:30:43  Configuration loaded from server
10:30:43  All modules initialized
10:30:44  Map initialized with PMTiles protocol
10:30:44  Map loaded successfully
10:30:45  Loading PMTiles: 202512011200
10:30:46  PMTiles loaded in 0.85s
```

#### Map Statistics Panel

Real-time performance metrics:

| Metric | What It Means | Good Value |
|--------|---------------|------------|
| **Current Zoom** | Map zoom level (0-22) | 8-15 (for city-scale) |
| **Loaded Tiles** | Tiles in memory | 50-200 (normal panning) |
| **Visible Features** | Polygons rendered | 100-10,000 (depends on zoom) |
| **PMTiles Size** | File header size | 16 KB (typical) |
| **Load Time** | Time to load PMTiles | < 1s (fast), 1-3s (normal) |

#### Browser DevTools

**Network Tab:**
1. Open DevTools (F12) → Network
2. Filter: `pmtiles`
3. Look for:
   - **Status:** 206 (Partial Content)
   - **Size:** 10-50 KB per request
   - **Time:** < 100ms per tile

**Example Network Log:**
```
Name                               Status  Type    Size    Time
PMTile_202512011200.pmtiles        206     xhr     16 KB   45ms
PMTile_202512011200.pmtiles        206     xhr     12 KB   38ms
PMTile_202512011200.pmtiles        206     xhr     18 KB   52ms
```

**Console Commands:**
```javascript
// Get app version
window.pmtilesApp.getVersion()
// → "2.1.0"

// Get current stats
window.pmtilesApp.getStats()
// → { zoom: 11.42, tiles: 48, features: 1254, ... }

// Export logs
window.pmtilesApp.exportLogs()
// → Prints logs to console as table

// Download logs as JSON
window.pmtilesApp.downloadLogs()
// → Downloads logs.json file
```

### Performance Bottleneck Detection

#### Slow Tile Loading

**Symptoms:**
- Map takes > 3 seconds to load
- Tiles appear slowly when panning
- Backend logs show many requests

**Check:**
```
Backend Terminal:
[10:30:45] GET /pmtiles/file.pmtiles - 206 - 16.00 KB
[10:30:46] GET /pmtiles/file.pmtiles - 206 - 12.50 KB
[10:30:46] GET /pmtiles/file.pmtiles - 206 - 15.23 KB
... (20+ rapid requests)
```

**Diagnose:**
- **Too many tiles:** Zoom level too high → reduce maxZoom
- **Large tiles:** Each tile > 100 KB → re-generate PMTiles with more compression
- **Network latency:** Check browser Network tab times

**Fix:**
```javascript
// In map-manager.js, adjust maxzoom:
map.addSource('pmtiles-source', {
    type: 'vector',
    url: `pmtiles://${url}`,
    minzoom: 0,
    maxzoom: 12  // Reduce from 14 to 12
});
```

#### High Memory Usage

**Symptoms:**
- Browser tab crashes
- Map lags when zooming
- "Loaded Tiles" stat > 500

**Check:**
```
Map Statistics:
Loaded Tiles: 847  ← Too high!
```

**Diagnose:**
- MapLibre caching too many tiles
- User zoomed in too far on large area

**Fix:**
```javascript
// Set tile cache size limit
this.map = new maplibregl.Map({
    container: 'map',
    style: baseStyle,
    maxTileCacheSize: 200  // Limit tiles in memory
});
```

#### Backend Server Overload

**Symptoms:**
- Slow response times
- 500 errors in frontend
- Server terminal shows errors

**Check:**
```
Backend Terminal:
[10:30:45] GET /pmtiles/file.pmtiles - 206 - 16.00 KB
[10:30:46] GET /pmtiles/file.pmtiles - 206 - 12.50 KB
... (no logs for 5+ seconds)
Traceback (most recent call last):
  ...
```

**Diagnose:**
- Too many concurrent connections
- Large PMTiles files (> 500 MB)
- Slow disk I/O

**Fix:**
- Use production WSGI server (Gunicorn, uWSGI)
- Move PMTiles to SSD
- Deploy to CDN (S3, Cloudflare)

### Request Size Analysis

#### What to Look For

**Healthy Pattern:**
```
[10:30:45] GET /pmtiles/file.pmtiles - 206 - 16.00 KB   ← Header
[10:30:46] GET /pmtiles/file.pmtiles - 206 - 12.50 KB   ← Tile
[10:30:46] GET /pmtiles/file.pmtiles - 206 - 15.23 KB   ← Tile
[10:30:46] GET /pmtiles/file.pmtiles - 206 - 18.45 KB   ← Tile
[10:30:46] GET /pmtiles/file.pmtiles - 206 - 21.09 KB   ← Tile
```
- First request: ~16 KB (header + directory)
- Subsequent requests: 10-50 KB (individual tiles)
- **Total bandwidth for view:** ~100-500 KB

**Compare to GeoJSON:**
```
[10:30:45] GET /data/flood.geojson - 200 - 102400.00 KB
```
- Single request: 100 MB (entire dataset)
- **Total bandwidth:** 100,000 KB

**Result:** PMTiles uses **200x less bandwidth**!

#### Calculating Bandwidth Savings

**Formula:**
```
Bandwidth Saved = GeoJSON Size - (Header + Visible Tiles)

Example:
GeoJSON Size: 100 MB (102,400 KB)
PMTiles Header: 16 KB
Visible Tiles: 10 tiles × 15 KB = 150 KB
Total PMTiles: 166 KB

Savings: 102,400 - 166 = 102,234 KB (99.8% reduction!)
```

---

## 📚 API Reference

### Backend REST API

#### GET /api/config

Get server configuration and available time slots.

**Response:**
```json
{
  "success": true,
  "config": {
    "timeSlots": ["202511251600", "202512011200"],
    "pmtilesDir": "pmtiles",
    "initialCenter": [77.0293, 28.4622],
    "initialZoom": 11,
    "initialStyle": "light",
    "statsUpdateInterval": 2000
  }
}
```

#### GET /api/pmtiles

List all available PMTiles files.

**Response:**
```json
{
  "success": true,
  "count": 2,
  "files": [
    {
      "filename": "PMTile_202511251600.pmtiles",
      "timeSlot": "202511251600",
      "size": 15728640,
      "sizeFormatted": "15.00 MB",
      "modified": "2025-11-25T16:00:00",
      "path": "/pmtiles/PMTile_202511251600.pmtiles"
    }
  ],
  "timestamp": "2025-12-01T10:30:45"
}
```

#### GET /api/pmtiles/:filename

Get detailed information about a specific PMTiles file.

**Response:**
```json
{
  "success": true,
  "filename": "PMTile_202511251600.pmtiles",
  "size": 15728640,
  "sizeFormatted": "15.00 MB",
  "modified": "2025-11-25T16:00:00",
  "header": {
    "version": 3,
    "rootDirOffset": 127,
    "rootDirLength": 16256
  }
}
```

#### GET /api/health

Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-12-01T10:30:45",
  "version": "2.0.0"
}
```

### Frontend JavaScript API

#### PMTilesViewerApp

**Methods:**

```javascript
// Get app version
app.getVersion()
// → "2.1.0"

// Get configuration
app.getConfig()
// → { timeSlots: [...], initialCenter: [...], ... }

// Refresh config from server
await app.refreshConfig()

// Export logs
app.exportLogs()
// → [{ timestamp: "10:30:45", level: "info", message: "..." }]

// Download logs as file
app.downloadLogs()

// Get current statistics
app.getStats()
// → { zoom: 11.42, tiles: 48, features: 1254, ... }

// Access event bus
app.getEventBus()
// → EventBus instance

// Access API bridge
app.getAPIBridge()
// → APIBridge instance
```

**Global Access:**
```javascript
// Available as window.pmtilesApp after initialization
window.pmtilesApp.getVersion()
```

---

## 🆕 Recent Updates

### Version 2.2.0 (December 2025)

#### 🐛 Bug Fixes

1. **Activity Log Spam Resolved**
   - Fixed stats logging appearing every 2 seconds in activity log
   - Changed log level from `info` to `debug` for stats calculations
   - Users now see only relevant application events

2. **Transparent Null/Zero Cells**
   - Grid cells with null, NA, or 0 depth now render at 0% opacity
   - Improves visual clarity by hiding irrelevant cells
   - Dynamic opacity expression with proper null handling

3. **Polygon Analysis Area Calculation**
   - Fixed "Total Area" to show actual polygon area (not grid cells sum)
   - More accurate flooded area percentage calculation
   - `floodPercent = (floodedArea / polygonArea) * 100`

#### ⚡ Performance Improvements

1. **Optimized Event Throttling**
   - Stats updates: 500ms → 2000ms (75% reduction in calculations)
   - Mouse move: 50ms → 100ms (50% reduction in cursor updates)
   - Significant CPU usage reduction during map interactions

2. **Enhanced Logger**
   - Added `debug()` method for non-critical logging
   - Prevents performance monitoring from cluttering activity feed
   - Maintains detailed console logs for debugging

3. **Time Slider Speed**
   - Playback interval: 1500ms → 500ms (0.5 second intervals)
   - Smoother time-series animation
   - Better user experience for temporal analysis

#### 🎨 UI/UX Enhancements

1. **Professional Sidebar Redesign**
   - Enhanced glassmorphism effect with better backdrop blur
   - Improved color gradients (blue → purple spectrum)
   - Better shadows and depth perception
   - Increased font sizes and weights for readability
   - Smooth hover animations on all interactive elements

2. **Enhanced Visual Hierarchy**
   - Larger brand name (1.75rem) with animated pulse effect
   - Better section spacing and padding
   - Improved info card design with hover effects
   - Professional toggle switches with gradient backgrounds
   - Enhanced slider thumbs with white borders and shadows

3. **Color Palette Upgrade**
   - Primary: #2563eb → #1e40af gradient
   - Accent purple: #8b5cf6 for visual interest
   - Better contrast ratios for accessibility
   - Consistent gradient usage across components

4. **Typography Improvements**
   - Inter font family for modern look
   - Increased font weights (600-700) for better readability
   - Better letter-spacing and line-height
   - Monospace fonts for data values

5. **Interactive Feedback**
   - Hover effects on all sections
   - Transform animations (translateY, scale)
   - Better shadow transitions
   - Smooth color transitions (cubic-bezier easing)

6. **Enhanced Scrollbar**
   - Blue gradient scrollbar thumb
   - Larger width (10px) for easier interaction
   - Smooth hover states

#### 🔧 Technical Improvements

1. **CSS Architecture**
   - Enhanced CSS variables for better theme management
   - Improved shadow system (sm, md, lg, xl)
   - Better transition timing functions
   - Increased border radius values for softer edges

2. **Component Optimization**
   - Removed unnecessary re-renders
   - Better event listener management
   - Improved memory usage

3. **Code Quality**
   - Consistent styling patterns
   - Better separation of concerns
   - Improved code documentation

---

## 📊 Browser Compatibility

| Browser | Version | Status |
|---------|---------|--------|
| Chrome | 90+ | ✅ Fully Supported |
| Firefox | 88+ | ✅ Fully Supported |
| Safari | 14+ | ✅ Fully Supported |
| Edge | 90+ | ✅ Fully Supported |

---

## 🎓 Summary

### Key Takeaways

1. **PMTiles = Efficient Vector Tiles**
   - Single file, no tile server needed
   - HTTP Range requests for on-demand loading
   - 100-1000x less bandwidth than GeoJSON

2. **Backend = Data Streaming**
   - Python serves byte ranges (not full files)
   - HTTP 206 responses for partial content
   - Logs show request size in KB

3. **Frontend = Rendering Engine**
   - MapLibre renders vector tiles
   - PMTiles protocol handles byte range logic
   - Event-driven modular architecture

4. **Data Flow = Network Efficiency**
   - Browser requests only visible tiles
   - Each tile: 10-50 KB (not MBs)
   - GPU-accelerated rendering

5. **Monitoring = Performance Visibility**
   - Backend logs: Request size in KB
   - Frontend stats: Tiles, features, load time
   - Browser DevTools: Network analysis

### Next Steps

- **Add More Data:** Convert GeoJSON → PMTiles
- **Customize Styling:** Modify fill-color expressions
- **Deploy to Cloud:** Upload PMTiles to S3, remove backend
- **Add Features:** Time series animation, data export, layers

---

## 📝 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

---

## 📧 Contact

For questions or support, please contact the AIResQ ClimSols team.

---

**Built with ❤️ by AIResQ ClimSols Team**

