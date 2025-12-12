# PMTiles Viewer - Changes Summary

## Latest Update: Smooth Batch Transitions (December 2025)

### Issue: Layer Flickering During Batch Switches

**Problem**: When the time slider moved from one batch to another, the flood layer would flicker or briefly disappear. This happened because the old layer was removed before the new batch was fully loaded.

**User Impact**: Poor UX - users would see a blank/black map momentarily when scrubbing across batch boundaries.

### Solution: Double-Buffering Layer Swap

Implemented a **double-buffering** approach where:
1. **Two layer sets** (`A` and `B`) are available
2. **New batch loads in background**: While the current layer remains visible, the next batch loads into the alternate layer set
3. **Smooth crossfade**: Once the new batch is fully loaded, a 300ms crossfade transition swaps the layers
4. **Old layer cleanup**: The previous layer is removed after the transition completes

**Key Implementation Details**:

```javascript
// Layer naming convention for double-buffering
_getActiveLayerIds() {
    const suffix = this._batchTransition.activeLayerSuffix; // 'A' or 'B'
    return {
        fillId: `pmtiles-layer-${suffix}`,
        outlineId: `pmtiles-outline-${suffix}`,
        sourceId: `pmtiles-source-${suffix}`
    };
}

// Wait for tiles to load before transitioning
await this._waitForSourceLoad(nextIds.sourceId, nextIds.fillId, layerName);

// Smooth crossfade transition
await this._performLayerSwap(nextIds); // 300ms crossfade

// Clean up old layers after transition
this._cleanupOldBatchLayers(currentIds);
```

**Event Coordination**:
- `BATCH_TRANSITION_START`: Emitted when a batch switch begins, pauses playback
- `BATCH_TRANSITION_END`: Emitted when transition completes, resumes playback
- Subtle loading indicator appears at bottom of screen during transitions

**Request Queuing**:
- If user rapidly scrubs through multiple batches, requests are queued
- Only the latest batch request is processed, preventing race conditions

### Files Modified

1. **map-manager.js**:
   - Added `_batchTransition` state object with `activeLayerSuffix`, `isTransitioning`, `pendingBatchInfo`
   - Added `_getActiveLayerIds()` and `_getNextLayerIds()` for layer naming
   - Added `_waitForSourceLoad()` to ensure tiles are rendered before swap
   - Added `_performLayerSwap()` with eased crossfade animation
   - Added `_cleanupOldBatchLayers()` for cleanup after transition
   - Updated all layer references to use dynamic IDs
   
2. **main.js**:
   - Added handlers for `BATCH_TRANSITION_START` and `BATCH_TRANSITION_END` events
   
3. **ui-controller.js**:
   - Added `showBatchTransitionIndicator()` and `hideBatchTransitionIndicator()` methods

4. **time-controller.js** (existing):
   - Already had handlers to pause playback during transitions

### Technical Notes

- **No race conditions**: `isTransitioning` flag prevents concurrent batch loads
- **Graceful timeout**: Source load waits up to 8 seconds before proceeding
- **Request queuing**: Rapid slider scrubbing only processes the final batch
- **Modular design**: All transition logic contained within `MapManager`

---

## Previous Update: Feature-State Based Styling Fix (December 2025)

### Issue: Black Tiles Instead of Colored Flood Visualization

**Problem**: After implementing batch-based PMTiles with `flood_depths` arrays, all flood tiles were rendering as **black** instead of the expected blue gradient colors. However, clicking on a tile correctly showed the depth value in the popup (e.g., "0.566 m").

**Root Cause**: 
- PMTiles (and vector tiles in general) store complex data types like arrays as **JSON strings**, not native JavaScript arrays
- The original code used MapLibre's `['at', index, ['get', 'flood_depths']]` expression
- This expression **does not work** because:
  1. `['get', 'flood_depths']` returns a **string** like `"[0.0, 0.1, 0.2, ...]"`
  2. MapLibre's `['at', ...]` operator expects a native array, not a string
  3. The expression silently fails and returns `null`
  4. The color fallback logic was not properly handling this, resulting in black

**Why the popup worked**: The JavaScript click handler used `JSON.parse()` to convert the string to an array, which worked correctly. But MapLibre expressions don't have a `JSON.parse` equivalent.

### Solution: Feature-State Based Styling

Since MapLibre expressions cannot parse JSON strings, we use **feature-state** to pass the depth values:

1. **On tile load**: Query all rendered features, parse `flood_depths` JSON in JavaScript, extract the value at `currentLocalIndex`
2. **Set feature-state**: Use `map.setFeatureState()` to set `depth` value for each feature by `geo_code`
3. **Style with feature-state**: Use `['feature-state', 'depth']` in the color expression

**Key Code Changes**:

```javascript
// Source must have promoteId to use feature-state
this.map.addSource('pmtiles-source', {
    type: 'vector',
    url: `pmtiles://${pmtilesUrl}`,
    promoteId: 'geo_code'  // Use geo_code as feature ID
});

// Color expression uses feature-state instead of property
_getFeatureStateColorExpression(layerType) {
    const depthValue = ['coalesce', ['feature-state', 'depth'], 0];
    return [
        'case',
        ['<=', depthValue, 0], 'rgba(0, 0, 0, 0)',
        ['interpolate', ['linear'], depthValue,
            0.001, '#f5fbff',
            0.2, '#d6ecff',
            0.5, '#9dd1ff',
            1.0, '#5aa8ff',
            2.0, '#1e6ddf',
            3.0, '#0b3a8c'
        ]
    ];
}

// Update feature states on tile load and time change
_updateFeatureStates() {
    const features = this.map.queryRenderedFeatures({ layers: ['pmtiles-layer'] });
    for (const feature of features) {
        const geoCode = feature.properties?.geo_code;
        const depth = this._getDepthValue(feature.properties); // Uses JSON.parse
        this.map.setFeatureState(
            { source: 'pmtiles-source', sourceLayer: layerName, id: geoCode },
            { depth: depth ?? 0 }
        );
    }
}
```

### Why This Approach Works

1. **JavaScript can parse JSON**: `_getDepthValue()` parses the JSON string to extract array values
2. **Feature-state is dynamic**: Values can be updated without reloading tiles
3. **Time switching is fast**: Just update feature states, no tile reload needed
4. **Geometry stays the same**: The PMTiles geometry is loaded once per batch

### Lessons Learned

1. **Vector tiles serialize complex types**: Arrays and objects become JSON strings in vector tiles
2. **MapLibre expressions are limited**: No `JSON.parse`, `eval`, or custom functions
3. **Feature-state is powerful**: It's the right solution for dynamic, computed values
4. **Always test with real data**: The issue wasn't visible until testing with actual PMTiles

---

## Previous Update: Batch-Based PMTiles with Array Flood Depths (December 2025)

### Overview
Redesigned the visualization engine to use **batched PMTiles files** with consolidated `flood_depths` arrays. Each batch file contains 48 time slots (4 hours of data at 5-minute intervals). This significantly reduces file count and improves data organization while maintaining fast time-slot switching.

### New Data Format
Each batch PMTiles file (e.g., `D202507130200.pmtiles`) contains:
- **Consistent geometry**: Grid cells identified by `geo_code`
- **Consolidated flood depths**: Single `flood_depths` array property containing 48 depth values
- **Array indexing**: `flood_depths[0]` = first time slot, `flood_depths[47]` = last time slot
- **Null handling**: All null values converted to 0.0

**Example GeoJSON feature:**
```json
{
  "geo_code": "FMK55P9P9",
  "flood_depths": [0.0, 0.0, ..., 0.082, 0.107, 0.159, 0.207, 0.225, 0.241, 0.265, 0.291]
}
```

### Key Changes

#### 1. Config Updates (`config.py`)
- `BATCH_SIZE = 48` - Number of time slots per batch file
- `BATCH_DURATION_HOURS = 4` - Each batch covers 4 hours
- Added `get_batch_start_times()` - List of batch start timestamps
- Added `get_batch_files()` - List of batch file info with time ranges
- Added `get_batch_for_time_slot(index)` - Get batch file and local index for any time slot
- Added `get_time_slot_info(index)` - Complete info including batch details

#### 2. Server Updates (`server.py`)
- Updated `/api/config` endpoint to include:
  - `batchSize`: 48
  - `batchDurationHours`: 4
  - `batchFiles`: Array of batch file info with filename, startTime, endTime, paths
  - `totalTimeSlots`: Total number of time slots

#### 3. API Bridge Updates (`js/api-bridge.js`)
- Added `getBatchPMTilesUrl(batchFilename, floodDir)` - Build URL for specific batch file
- Added `getBatchForTimeSlot(globalIndex, batchSize, batchFiles)` - Calculate batch info

#### 4. Map Manager Updates (`js/map-manager.js`) - **MAJOR REFACTOR**
- Added `batchConfig` object tracking:
  - `batchSize`: 48 (default)
  - `batchFiles`: Array of batch file info
  - `currentBatchIndex`: Currently loaded batch
  - `currentBatchFile`: Current batch filename
- Added `currentTimeIndex` and `currentLocalIndex` for tracking
- Added `updateBatchConfig(serverConfig)` - Update batch configuration
- Added `_getBatchForIndex(globalIndex)` - Get batch info for any time index
- **Feature-state based styling** (see above for details)
- Added `_setupFeatureStateUpdater()` - Listen for tile loads
- Added `_scheduleFeatureStateUpdate()` - Debounced update scheduler  
- Added `_updateFeatureStates()` - Parse flood_depths and set feature states
- Added `_getFeatureStateColorExpression()` - Color based on feature-state depth

#### 5. Main App Updates (`js/main.js`)
- Updated TIME_CHANGE handler to pass both index and timeSlot
- Updated _initializeMap to pass index when loading initial data
- Updated _initializeModules to call mapManager.updateBatchConfig

### Batch File Naming Convention
- Format: `D{YYYYMMDDHHmm}.pmtiles`
- Example: `D202507130200.pmtiles` covers 02:00 - 05:55 on July 13, 2025
- Each file contains 48 time slots (indices 0-47)

### Performance Benefits
1. **Reduced file count**: 8 batch files instead of 192+ individual files
2. **Faster switching**: No file reload when switching within same batch
3. **Smaller total size**: Array format more efficient than 48 separate properties
4. **Better caching**: Batch files can be cached effectively

---

## Previous Update: Master PMTiles Time-Series Architecture (December 2025)

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
