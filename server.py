"""
PMTiles HTTP Server with REST API for Python-JavaScript communication.
Run with: python server.py [port]

Features:
- Range request support for efficient PMTiles streaming
- REST API for PMTiles metadata and file discovery
- Time series flood data from single master PMTiles file
- CORS support for development
- Clean error handling
"""

import os
import sys
import json
import struct
from pathlib import Path
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse

# Import configuration
import config

# Configuration
DEFAULT_PORT = 8000
PMTILES_DIR = "pmtiles"
PMTILES_FLOOD_DIR = "pmtiles/flood"
PMTILES_STATIC_DIR = "pmtiles/static"
CITY_DIR = "city"
CITY_NAME = "gurugram"
MASTER_PMTILES_FILE = config.MASTER_PMTILES_FILE


class PMTilesAPI:
    """API handler for PMTiles-related operations."""
    
    def __init__(self, base_dir: str):
        self.base_dir = Path(base_dir)
        self.pmtiles_dir = self.base_dir / PMTILES_DIR / CITY_NAME
        self.master_file_path = self.base_dir / MASTER_PMTILES_FILE
        self.time_slots = config.get_time_slots()
    
    def get_master_file_info(self) -> dict:
        """Get info about the master PMTiles file."""
        if not self.master_file_path.exists():
            return {"success": False, "error": "Master PMTiles file not found"}
        
        stat = self.master_file_path.stat()
        return {
            "success": True,
            "filename": self.master_file_path.name,
            "path": f"/{MASTER_PMTILES_FILE}",
            "size": stat.st_size,
            "sizeFormatted": self._format_size(stat.st_size),
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
        }
    
    def get_available_files(self) -> dict:
        """Return info about master PMTiles file (for backward compatibility)."""
        master_info = self.get_master_file_info()
        if not master_info.get("success"):
            return {
                "success": False,
                "count": 0,
                "files": [],
                "error": master_info.get("error", "Master file not found"),
                "timestamp": datetime.now().isoformat()
            }
        
        return {
            "success": True,
            "count": 1,
            "files": [{
                "filename": master_info["filename"],
                "timeSlot": "master",
                "size": master_info["size"],
                "sizeFormatted": master_info["sizeFormatted"],
                "modified": master_info["modified"],
                "path": master_info["path"]
            }],
            "timestamp": datetime.now().isoformat()
        }
    
    def get_static_layers(self) -> dict:
        """Discover all static PMTiles layers."""
        layers = []
        static_dir = self.base_dir / PMTILES_STATIC_DIR
        if static_dir.exists():
            for pmtile_path in static_dir.glob("*.pmtiles"):
                stat = pmtile_path.stat()
                name = pmtile_path.stem
                
                layers.append({
                    "id": name,
                    "name": name.upper().replace("_", " "),
                    "filename": pmtile_path.name,
                    "size": stat.st_size,
                    "sizeFormatted": self._format_size(stat.st_size),
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "path": f"/{PMTILES_STATIC_DIR}/{pmtile_path.name}"
                })
        
        return {
            "success": True,
            "count": len(layers),
            "layers": layers,
            "timestamp": datetime.now().isoformat()
        }
    
    def get_ward_boundaries(self) -> dict:
        """Get city ward boundary GeoJSON."""
        city_dir = self.base_dir / CITY_DIR / CITY_NAME
        ward_file = city_dir / "city_wards_boundary.geojson"
        
        if not ward_file.exists():
            return {"success": False, "error": "Ward boundaries file not found"}
        
        try:
            with open(ward_file, 'r', encoding='utf-8') as f:
                geojson_data = json.load(f)
            
            stat = ward_file.stat()
            return {
                "success": True,
                "data": geojson_data,
                "size": stat.st_size,
                "sizeFormatted": self._format_size(stat.st_size),
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def get_roadways(self) -> dict:
        """Get roadways GeoJSON."""
        city_dir = self.base_dir / CITY_DIR / CITY_NAME
        roadways_file = city_dir / "ggn_roadways_clean.geojson"
        
        if not roadways_file.exists():
            return {"success": False, "error": "Roadways file not found"}
        
        try:
            with open(roadways_file, 'r', encoding='utf-8') as f:
                geojson_data = json.load(f)
            
            stat = roadways_file.stat()
            return {
                "success": True,
                "data": geojson_data,
                "size": stat.st_size,
                "sizeFormatted": self._format_size(stat.st_size),
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def get_hotspots(self) -> dict:
        """Get hotspots GeoJSON."""
        city_dir = self.base_dir / CITY_DIR / CITY_NAME
        hotspots_file = city_dir / "hotspots.geojson"
        
        if not hotspots_file.exists():
            return {"success": False, "error": "Hotspots file not found"}
        
        try:
            with open(hotspots_file, 'r', encoding='utf-8') as f:
                geojson_data = json.load(f)
            
            stat = hotspots_file.stat()
            return {
                "success": True,
                "data": geojson_data,
                "size": stat.st_size,
                "sizeFormatted": self._format_size(stat.st_size),
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def get_hotspots(self) -> dict:
        """Get hotspots GeoJSON."""
        city_dir = self.base_dir / CITY_DIR / CITY_NAME
        hotspots_file = city_dir / "hotspots.geojson"
        
        if not hotspots_file.exists():
            return {"success": False, "error": "Hotspots file not found"}
        
        try:
            with open(hotspots_file, 'r', encoding='utf-8') as f:
                geojson_data = json.load(f)
            
            stat = hotspots_file.stat()
            return {
                "success": True,
                "data": geojson_data,
                "size": stat.st_size,
                "sizeFormatted": self._format_size(stat.st_size),
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def get_precipitation(self) -> dict:
        """Get precipitation data from CSV file."""
        import csv
        city_dir = self.base_dir / CITY_DIR / CITY_NAME
        
        # Find the precipitation CSV file (pattern: TP_5m_*.csv)
        precip_files = list(city_dir.glob("TP_5m_*.csv"))
        
        if not precip_files:
            return {"success": False, "error": "Precipitation file not found"}
        
        precip_file = precip_files[0]  # Use the first matching file
        
        try:
            data = []
            with open(precip_file, 'r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    try:
                        # Parse time and precipitation value
                        time_val = int(row['Time'])
                        tp_val = float(row['tp'])
                        data.append({
                            "time": time_val,
                            "tp": tp_val,
                            "unit": row.get('tp_unit', 'm')
                        })
                    except (ValueError, KeyError) as e:
                        continue  # Skip invalid rows
            
            stat = precip_file.stat()
            return {
                "success": True,
                "data": data,
                "count": len(data),
                "filename": precip_file.name,
                "size": stat.st_size,
                "sizeFormatted": self._format_size(stat.st_size),
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            }
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def get_file_info(self, filename: str) -> dict:
        """Get detailed info about a specific PMTiles file."""
        file_path = self.pmtiles_dir / filename
        
        if not file_path.exists() or file_path.suffix != '.pmtiles':
            return {"success": False, "error": "File not found"}
        
        stat = file_path.stat()
        header_info = self._read_pmtiles_header(file_path)
        
        return {
            "success": True,
            "filename": filename,
            "size": stat.st_size,
            "sizeFormatted": self._format_size(stat.st_size),
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "header": header_info
        }
    
    def _read_pmtiles_header(self, file_path: Path) -> dict:
        """Read basic PMTiles header information."""
        try:
            with open(file_path, 'rb') as f:
                magic = f.read(7)
                if magic != b'PMTiles':
                    return {"error": "Invalid PMTiles file"}
                
                version = struct.unpack('B', f.read(1))[0]
                root_dir_offset = struct.unpack('<Q', f.read(8))[0]
                root_dir_length = struct.unpack('<Q', f.read(8))[0]
                
                return {
                    "version": version,
                    "rootDirOffset": root_dir_offset,
                    "rootDirLength": root_dir_length
                }
        except Exception as e:
            return {"error": str(e)}
    
    def _format_size(self, size: int) -> str:
        """Format byte size to human readable string."""
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size < 1024:
                return f"{size:.2f} {unit}"
            size /= 1024
        return f"{size:.2f} TB"


class APIRequestHandler(SimpleHTTPRequestHandler):
    """HTTP request handler with Range support and REST API endpoints."""
    
    api = None  # Class-level API instance
    
    def log_error(self, format, *args):
        """Suppress common connection errors."""
        error_strings = ['ConnectionAbortedError', 'ConnectionResetError', 
                         '[WinError 10053]', '[WinError 10054]', 'BrokenPipeError']
        if args and any(err in str(args[0]) for err in error_strings):
            return
        super().log_error(format, *args)
    
    def log_request(self, code='-', size='-'):
        """Override to log with response size in KB."""
        if isinstance(code, str):
            code = code
        
        # Format size in KB
        size_kb = '-'
        if isinstance(size, int) and size >= 0:
            size_kb = f"{size / 1024:.2f} KB"
        elif isinstance(size, str) and size != '-':
            try:
                size_kb = f"{int(size) / 1024:.2f} KB"
            except (ValueError, TypeError):
                size_kb = size
        
        # Skip logging for static assets
        if any(ext in self.path for ext in ['.js', '.css', '.png', '.ico']):
            return
        
        # Log format: [TIME] METHOD PATH STATUS SIZE
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {self.command} {self.path} - {code} - {size_kb}")
    
    def log_message(self, format, *args):
        """Custom log format - handled by log_request."""
        # Skip default logging, use log_request instead
        pass
    
    def handle(self):
        """Handle request with connection error suppression."""
        try:
            super().handle()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, OSError):
            pass
    
    def do_GET(self):
        """Handle GET requests - API endpoints or static files."""
        parsed = urlparse(self.path)
        path = parsed.path
        
        # API endpoints
        if path == '/api/pmtiles':
            self._handle_api_pmtiles_list()
        elif path.startswith('/api/pmtiles/'):
            filename = path.split('/')[-1]
            self._handle_api_pmtiles_info(filename)
        elif path == '/api/static-layers':
            self._handle_api_static_layers()
        elif path == '/api/ward-boundaries':
            self._handle_api_ward_boundaries()
        elif path == '/api/roadways':
            self._handle_api_roadways()
        elif path == '/api/hotspots':
            self._handle_api_hotspots()
        elif path == '/api/precipitation':
            self._handle_api_precipitation()
        elif path == '/api/health':
            self._handle_api_health()
        elif path == '/api/config':
            self._handle_api_config()
        else:
            super().do_GET()
    
    def _handle_api_pmtiles_list(self):
        """Return list of available PMTiles files."""
        self._send_json_response(self.api.get_available_files())
    
    def _handle_api_pmtiles_info(self, filename: str):
        """Return info about a specific PMTiles file."""
        response = self.api.get_file_info(filename)
        self._send_json_response(response, 200 if response.get("success") else 404)
    
    def _handle_api_health(self):
        """Health check endpoint."""
        self._send_json_response({
            "status": "healthy",
            "timestamp": datetime.now().isoformat(),
            "version": "2.0.0"
        })
    
    def _handle_api_static_layers(self):
        """Return list of static layers."""
        self._send_json_response(self.api.get_static_layers())
    
    def _handle_api_ward_boundaries(self):
        """Return ward boundaries GeoJSON."""
        response = self.api.get_ward_boundaries()
        self._send_json_response(response, 200 if response.get("success") else 404)
    
    def _handle_api_roadways(self):
        """Return roadways GeoJSON."""
        response = self.api.get_roadways()
        self._send_json_response(response, 200 if response.get("success") else 404)
    
    def _handle_api_hotspots(self):
        """Return hotspots GeoJSON."""
        response = self.api.get_hotspots()
        self._send_json_response(response, 200 if response.get("success") else 404)
    
    def _handle_api_precipitation(self):
        """Return precipitation data."""
        response = self.api.get_precipitation()
        self._send_json_response(response, 200 if response.get("success") else 404)
    
    def _handle_api_config(self):
        """Return server configuration with time slots and batch info from config."""
        # Get time slots from config module
        time_slots = config.get_time_slots()
        batch_files = config.get_batch_files()
        master_info = self.api.get_master_file_info()
        
        self._send_json_response({
            "success": True,
            "config": {
                "timeSlots": time_slots,
                "totalTimeSlots": len(time_slots),
                "masterPMTilesFile": MASTER_PMTILES_FILE,
                "masterPMTilesPath": master_info.get("path", f"/{MASTER_PMTILES_FILE}"),
                "depthPropertyPrefix": config.DEPTH_PROPERTY_PREFIX,
                "location": config.LOCATION,
                "startTime": config.START_TIME,
                "endTime": config.END_TIME,
                "interval": config.INTERVAL,
                "crs": config.CRS,
                # Batch configuration for optimized PMTiles
                "batchSize": config.BATCH_SIZE,
                "batchDurationHours": config.BATCH_DURATION_HOURS,
                "batchFiles": batch_files,
                "pmtilesFloodDir": PMTILES_FLOOD_DIR,
                "pmtilesStaticDir": PMTILES_STATIC_DIR,
                "initialCenter": [77.0293, 28.4622],
                "initialZoom": 11,
                "initialStyle": "light",
                "initialOpacity": 1.0,
                "statsUpdateInterval": 2000,
                # Google Maps API Key
                "googleMapsApiKey": config.GOOGLE_MAPS_API_KEY
            }
        })
    
    def _send_json_response(self, data: dict, status: int = 200):
        """Send JSON response with proper headers."""
        response = json.dumps(data, indent=2).encode('utf-8')
        response_size = len(response)
        
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', response_size)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        
        try:
            self.wfile.write(response)
            self.log_request(status, response_size)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass
    
    def send_head(self):
        """Handle GET/HEAD with Range request support for PMTiles."""
        path = self.translate_path(self.path)
        
        if os.path.isdir(path):
            return super().send_head()
        
        if not os.path.exists(path):
            self.send_error(404, "File not found")
            return None
        
        try:
            f = open(path, 'rb')
            fs = os.fstat(f.fileno())
            file_size = fs.st_size
        except OSError:
            self.send_error(404, "File not found")
            return None
        
        content_type = self.guess_type(path)
        is_pmtiles = path.endswith('.pmtiles')
        
        # Handle Range requests
        range_header = self.headers.get('Range')
        if range_header:
            try:
                start, end = self._parse_range(range_header, file_size)
                
                if start >= file_size:
                    self.send_error(416, "Range Not Satisfiable")
                    f.close()
                    return None
                
                end = min(end, file_size - 1)
                content_length = end - start + 1
                f.seek(start)
                
                self.send_response(206)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(content_length))
                self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
                self._send_common_headers(is_pmtiles, fs.st_mtime)
                self.end_headers()
                
                # Log the 206 response with size
                self.log_request(206, content_length)
                
                return _RangeFile(f, content_length)
            except (ValueError, IndexError):
                pass
        
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(file_size))
        self._send_common_headers(is_pmtiles, fs.st_mtime)
        self.end_headers()
        
        # Log the 200 response with size
        self.log_request(200, file_size)
        
        return f
    
    def _parse_range(self, range_header: str, file_size: int) -> tuple:
        """Parse Range header and return (start, end)."""
        range_spec = range_header.replace('bytes=', '')
        ranges = range_spec.split('-')
        start = int(ranges[0]) if ranges[0] else 0
        end = int(ranges[1]) if ranges[1] else file_size - 1
        return start, end
    
    def _send_common_headers(self, is_pmtiles: bool, mtime: float):
        """Send common headers for responses."""
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range")
        
        if is_pmtiles:
            self.send_header("Cache-Control", "public, max-age=7200, immutable")
            self.send_header("X-Content-Type-Options", "nosniff")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")
        
        self.send_header("Last-Modified", self.date_time_string(mtime))
    
    def do_OPTIONS(self):
        """Handle CORS preflight requests."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range, Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.end_headers()


class _RangeFile:
    """File wrapper for Range request responses."""
    
    def __init__(self, f, length: int):
        self.f = f
        self.remaining = length
    
    def read(self, size: int = -1) -> bytes:
        """Read with remaining byte limit."""
        if self.remaining <= 0:
            return b''
        
        size = min(size, self.remaining) if size > 0 else self.remaining
        try:
            data = self.f.read(size)
            self.remaining -= len(data)
            return data
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError, OSError):
            self.remaining = 0
            return b''
    
    def close(self):
        """Close underlying file safely."""
        try:
            self.f.close()
        except Exception:
            pass


def run_server(port: int = DEFAULT_PORT, directory: str = None):
    """Start the HTTP server."""
    if directory:
        os.chdir(directory)
    
    base_dir = os.getcwd()
    APIRequestHandler.api = PMTilesAPI(base_dir)
    files_info = APIRequestHandler.api.get_available_files()
    
    server_address = ('', port)
    httpd = HTTPServer(server_address, APIRequestHandler)
    
    print(f"http://localhost:{port} | {files_info['count']} PMTiles files | Dir: {base_dir}\nPress Ctrl+C to stop.")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[Server] Shutting down...")
        httpd.server_close()
        print("[Server] Stopped.")


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    run_server(port)
