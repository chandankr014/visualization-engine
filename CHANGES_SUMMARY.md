# PMTiles Viewer - Changes Summary

## Latest Update: Master PMTiles Time-Series Architecture (December 2025)

### Overview
Redesigned the visualization engine to use a **single master PMTiles file** (`flood_depth_master.pmtiles`) containing time-series flood depth data. This eliminates the need to reload geometry when switching time slots - only the color expression is updated based on the selected time property.

### Data Format
The master PMTiles file contains:
- **Consistent geometry**: Grid cells identified by `geo_code`
- **Time-series properties**: Flood depth values as properties with names like `D202512101000`, `D202512101015`, etc.
- **Property format**: `D{YYYYMMDDHHmm}` - e.g., `D202512101000` for December 10, 2025 at 10:00

### Key Changes

#### 1. Config Updates (`config.py`)
- Added `MASTER_PMTILES_FILE` - path to the single master file
- Added `DEPTH_PROPERTY_PREFIX = "D"` - prefix for time slot properties
- Added `generate_time_slots()` - generates time slot property names from START_TIME, END_TIME, INTERVAL
- Added `get_time_slots()` - helper to get all configured time slots

#### 2. Server Updates (`server.py`)
- Imports configuration from `config.py`
- Modified `PMTilesAPI` to work with master file
- Updated `/api/config` endpoint to return:
  - `timeSlots`: List of property names (e.g., `['D202512101000', 'D202512101015', ...]`)
  - `masterPMTilesPath`: Path to master file
  - `depthPropertyPrefix`: The prefix used for depth properties
  - `startTime`, `endTime`, `interval`: Time configuration

#### 3. API Bridge Updates (`js/api-bridge.js`)
- Added `getMasterPMTilesUrl()` - returns URL to master PMTiles file
- Updated `buildPMTilesUrl()` - now returns master file URL (for backward compatibility)

#### 4. Time Controller Updates (`js/time-controller.js`)
- Updated to work with D-prefixed property names
- Fixed time formatting for new format (`D{YYYYMMDDHHmm}`)
- Stores `depthPropertyPrefix` from server config

#### 5. Map Manager Updates (`js/map-manager.js`) - **MAJOR REFACTOR**
- Added `_masterPMTilesLoaded` flag - tracks if master file is loaded
- Added `currentDepthProperty` - current time slot property name
- **New `loadPMTiles(timeSlot)`** behavior:
  - First call: Loads master PMTiles file and initial time slot
  - Subsequent calls: Delegates to `switchTimeSlot()` (no reload!)
- **New `switchTimeSlot(timeSlot)`** method:
  - Updates `fill-color` expression to use new time property
  - No geometry reload - instant time switching!
  - Logs switch time (typically < 10ms)
- Updated `_getDepthExpression(timeSlot)` - uses specific time property
- Updated `_getDepthValue(properties)` - reads from current time property
- Updated popup to show current time slot
- Updated `changeBaseStyle()` to preserve current time slot

#### 6. Main.js Updates (`js/main.js`)
- Updated `TIME_CHANGE` event handler:
  - Checks if master is loaded, uses `switchTimeSlot()` if yes
  - Only shows loading overlay for initial load
- Updated style change handler - no PMTiles reload needed

#### 7. Polygon Analytics Updates (`js/polygon-analytics.js`)
- Removed `depthPropertyCandidates` - now uses map manager's current property
- Updated `_getDepthValue()` - uses `mapManager.currentDepthProperty`
- Added `_getDepthValueForTimeSlot(properties, timeSlotProperty)`
- **Optimized `analyzeAllTimeSlots()`**:
  - Queries features once (geometry is same for all time slots)
  - Iterates over time slots, reading different properties
  - No PMTiles reloading - much faster analysis!
- Updated `_formatTimeLabel()` for D-prefixed format

### Performance Benefits
1. **Faster time switching**: No geometry reload, just style expression update (~10ms)
2. **Faster polygon analysis**: Query features once, analyze all time slots from properties
3. **Reduced network traffic**: Single file load instead of multiple files
4. **Better caching**: Browser caches single master file

---

## Previous Update: Static Layers and Ward Boundaries

## Overview
Updated the application to support the new PMTiles directory structure and added ward boundary choropleth visualization with toggle controls for static layers.

## Changes Made

### 1. Server Updates (`server.py`)

#### New Configuration
- Added `PMTILES_FLOOD_DIR = "pmtiles/flood"` - directory for time-series flood data
- Added `PMTILES_STATIC_DIR = "pmtiles/static"` - directory for static layers (LULC, roadways)
- Added `CITY_DIR = "city"` - directory for city ward boundaries

#### New API Endpoints
- `GET /api/static-layers` - Returns list of available static PMTiles layers
- `GET /api/ward-boundaries` - Returns city ward boundary GeoJSON

#### Modified Methods
- `get_available_files()` - Now scans `pmtiles/flood/` subdirectory instead of root
- `get_static_layers()` - New method to discover static layers in `pmtiles/static/`
- `get_ward_boundaries()` - New method to load and serve `city/city_wards_boundary.geojson`
- Updated config endpoint to include new directory paths

### 2. API Bridge Updates (`js/api-bridge.js`)

#### New Methods
- `getStaticLayers()` - Fetches available static layers from server
- `getWardBoundaries()` - Fetches ward boundaries GeoJSON
- `buildStaticLayerUrl(layerId)` - Builds URL for static layer PMTiles

#### Modified Methods
- `buildPMTilesUrl(timeSlot)` - Updated to use `pmtiles/flood/` path

### 3. Map Manager Updates (`js/map-manager.js`)

#### New Properties
- `wardBoundariesData` - Stores loaded ward boundary GeoJSON
- `staticLayers` - Map to track loaded static layers

#### New Methods
- `loadWardBoundaries()` - Loads ward boundaries from server
- `addWardChoropleth(floodDepthData)` - Adds ward choropleth layer with Reds colormap
  - Uses interpolation for flood depth: 0m (light) → 2m+ (dark red)
  - Adds outline layer for ward boundaries
- `toggleStaticLayer(layerId, visible)` - Shows/hides static layers (LULC, roadways)
- `_getStaticLayerColor(layerId)` - Returns appropriate color for each static layer

#### Modified Methods
- `_removeExistingLayers()` - Now also handles ward layers
- Constructor - Added ward boundaries and static layers tracking

### 4. UI Updates (`viewer.html`)

#### New Section: Layers Control
Added new "Layers" section with toggle switches for:
- **Ward Boundaries (Choropleth)** - Shows wards colored by flood depth
- **Flood Depth** - Original flood depth raster layer
- **Land Use / Land Cover** - Static LULC layer
- **Roadways** - Static roadways layer

All toggles are checkbox-based with modern switch styling.

### 5. UI Controller Updates (`js/ui-controller.js`)

#### New Elements
- `toggleWardBoundaries` - Ward boundaries toggle
- `toggleFloodDepth` - Flood depth layer toggle
- `toggleLULC` - LULC layer toggle
- `toggleRoadways` - Roadways layer toggle

#### Modified Methods
- `_setupEventListeners()` - Added event handlers for layer toggles
- Each toggle emits `AppEvents.LAYER_TOGGLE` with layer name and visibility state

### 6. Styling Updates (`css/styles.css`)

#### New Styles
- `.toggle-label` - Container for checkbox toggle switches
- `input[type="checkbox"]` - Custom styled toggle switches
  - Modern iOS-style switches with sliding animation
  - Blue color when active
  - Smooth transitions

### 7. Event Bus Updates (`js/event-bus.js`)

#### New Events
- `AppEvents.LAYER_TOGGLE` - Emitted when a layer is toggled on/off

### 8. Main Application Updates (`js/main.js`)

#### Modified Methods
- `_setupEventBus()` - Added handler for `LAYER_TOGGLE` events
  - Handles ward boundaries visibility
  - Handles flood depth layer visibility
  - Handles static layers (LULC, roadways) toggling
- `_initializeMap()` - Now loads ward boundaries on initialization
  - Loads and displays ward choropleth by default

## Features

### Ward Choropleth Mapping
- Ward boundaries displayed with choropleth coloring based on flood depth
- Uses **Reds colormap** as requested:
  - 0m: `#fee5d9` (very light red/pink)
  - 0.5m: `#fcae91` (light red)
  - 1.0m: `#fb6a4a` (medium red)
  - 1.5m: `#de2d26` (dark red)
  - 2.0m+: `#a50f15` (very dark red)
- Black outlines for ward boundaries (1.5px, 50% opacity)
- Can be toggled on/off

### Static Layers
- LULC (Land Use / Land Cover) - Green color (#4daf4a)
- Roadways - Orange color (#ff7f00)
- Both layers can be independently toggled on/off
- Loaded on-demand (only when toggled on)

### Layer Management
- All layers have independent visibility controls
- Smooth toggle switches with modern UI
- Layers persist across time slot changes
- Layers properly restored after base map style changes

## File Structure

```
pmtiles/
├── flood/
│   ├── PMTile_202511251600.pmtiles
│   └── PMTile_202512011200.pmtiles
└── static/
    ├── lulc.pmtiles
    └── roadways.pmtiles

city/
└── city_wards_boundary.geojson
```

## Testing Recommendations

1. **Server Testing**
   - Verify `/api/static-layers` returns LULC and roadways
   - Verify `/api/ward-boundaries` returns valid GeoJSON
   - Check that flood PMTiles are correctly served from `pmtiles/flood/`

2. **UI Testing**
   - Toggle each layer on/off and verify visibility
   - Check that ward choropleth displays correct colors
   - Verify static layers load and display correctly
   - Test layer persistence across time slot changes
   - Test layer restoration after base map style changes

3. **Visual Testing**
   - Verify ward boundaries are visible and properly colored
   - Check that choropleth uses Reds colormap correctly
   - Ensure static layers have appropriate colors
   - Verify layer overlays don't conflict with each other

## Browser Compatibility
- Modern browsers with ES6+ support
- MapLibre GL JS compatible browsers
- PMTiles protocol support

## Notes
- Ward choropleth currently shows static coloring (placeholder for actual flood depth data joining)
- To implement dynamic choropleth, flood depth data needs to be joined with ward polygons
- Static layers are loaded lazily for better performance
- All layers properly cleaned up on map style changes
