# Quick Start Guide - Updated PMTiles Viewer

## Running the Application

```bash
python server.py 8000
```

Then open `http://localhost:8000/viewer.html` in your browser.

## New Features

### 1. Ward Boundaries Choropleth
- **Location**: Sidebar → Layers section
- **Toggle**: "Ward Boundaries (Choropleth)"
- **Functionality**: 
  - Displays city wards as polygons
  - Colored by flood depth using Reds colormap (light red → dark red)
  - Black outlines for ward boundaries
  - Enabled by default

### 2. Static Layers

#### Land Use / Land Cover (LULC)
- **Toggle**: "Land Use / Land Cover"
- **Color**: Green (#4daf4a)
- **Source**: `pmtiles/static/lulc.pmtiles`

#### Roadways
- **Toggle**: "Roadways"
- **Color**: Orange (#ff7f00)
- **Source**: `pmtiles/static/roadways.pmtiles`

### 3. Flood Depth Layer
- **Toggle**: "Flood Depth"
- **Functionality**: Original time-series flood depth data
- **Source**: `pmtiles/flood/PMTile_*.pmtiles`
- **Enabled by default**

## Layer Controls

All layers can be independently toggled on/off using the switches in the "Layers" section:

```
🗺️ Layers
  ☑ Ward Boundaries (Choropleth)
  ☑ Flood Depth
  ☐ Land Use / Land Cover
  ☐ Roadways
```

## Choropleth Color Scale (Reds)

The ward choropleth uses the following color scale based on flood depth:

- **0.0m**: 🟨 #fee5d9 (very light red/pink)
- **0.5m**: 🟧 #fcae91 (light red)
- **1.0m**: 🟥 #fb6a4a (medium red)
- **1.5m**: 🔴 #de2d26 (dark red)
- **2.0m+**: ⚫ #a50f15 (very dark red)

## Tips

1. **Layering**: Layers are rendered in this order (bottom to top):
   - Base map
   - Static layers (LULC, Roadways)
   - Flood depth raster
   - Ward boundaries choropleth
   - Ward outlines

2. **Performance**: Static layers are loaded only when toggled on for the first time

3. **Time Slider**: The flood depth layer updates with the time slider, while other layers remain constant

4. **Opacity Control**: The opacity slider affects the flood depth layer

5. **Base Map Styles**: All layers persist when changing base map styles

## Troubleshooting

### Ward boundaries not showing?
- Check if the toggle is enabled
- Verify `city/city_wards_boundary.geojson` exists
- Check browser console for errors

### Static layers not loading?
- Ensure PMTiles files exist in `pmtiles/static/`
- Check file names match: `lulc.pmtiles`, `roadways.pmtiles`
- Check browser console for network errors

### Flood depth not updating with time?
- Verify PMTiles files exist in `pmtiles/flood/`
- Ensure files are named: `PMTile_YYYYMMDDHHMM.pmtiles`
- Check the time slider has available time slots

## API Endpoints

New endpoints added:

- `GET /api/static-layers` - List available static layers
- `GET /api/ward-boundaries` - Get ward boundaries GeoJSON
- `GET /api/config` - Updated with new directory paths

## Future Enhancements

To implement dynamic ward choropleth based on actual flood depth:

1. Calculate average/max flood depth per ward
2. Join flood data with ward polygons
3. Update ward feature properties with flood depth values
4. The choropleth will automatically render with the correct colors
