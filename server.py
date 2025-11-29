"""
PMTiles HTTP Server with REST API for Python-JavaScript communication.
Run with: python server.py [port]

Features:
- Range request support for efficient PMTiles streaming
- REST API for PMTiles metadata and file discovery
- Dynamic time slot discovery from filesystem
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

# Configuration
DEFAULT_PORT = 8000
PMTILES_DIR = "pmtiles"


class PMTilesAPI:
    """API handler for PMTiles-related operations."""
    
    def __init__(self, base_dir: str):
        self.base_dir = Path(base_dir)
        self.pmtiles_dir = self.base_dir / PMTILES_DIR
    
    def get_available_files(self) -> dict:
        """Discover all available PMTiles files with metadata."""
        files = []
        if self.pmtiles_dir.exists():
            for pmtile_path in self.pmtiles_dir.glob("*.pmtiles"):
                stat = pmtile_path.stat()
                name = pmtile_path.stem
                time_slot = name.replace("PMTile_", "") if name.startswith("PMTile_") else name
                
                files.append({
                    "filename": pmtile_path.name,
                    "timeSlot": time_slot,
                    "size": stat.st_size,
                    "sizeFormatted": self._format_size(stat.st_size),
                    "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                    "path": f"/{PMTILES_DIR}/{pmtile_path.name}"
                })
        
        files.sort(key=lambda x: x["timeSlot"])
        
        return {
            "success": True,
            "count": len(files),
            "files": files,
            "timestamp": datetime.now().isoformat()
        }
    
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
    
    def log_message(self, format, *args):
        """Custom log format - skip static assets."""
        path = args[0] if args else ''
        # Only filter if path is a string (not an int like HTTP status codes)
        if isinstance(path, str) and any(ext in path for ext in ['.js', '.css', '.png', '.ico']):
            return
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {format % args}")
    
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
    
    def _handle_api_config(self):
        """Return server configuration with dynamic time slots."""
        files_response = self.api.get_available_files()
        time_slots = [f["timeSlot"] for f in files_response.get("files", [])]
        
        self._send_json_response({
            "success": True,
            "config": {
                "timeSlots": time_slots,
                "pmtilesDir": PMTILES_DIR,
                "initialCenter": [77.0293, 28.4622],
                "initialZoom": 11,
                "initialStyle": "light",
                "statsUpdateInterval": 2000
            }
        })
    
    def _send_json_response(self, data: dict, status: int = 200):
        """Send JSON response with proper headers."""
        response = json.dumps(data, indent=2).encode('utf-8')
        
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', len(response))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        
        try:
            self.wfile.write(response)
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
                
                return _RangeFile(f, content_length)
            except (ValueError, IndexError):
                pass
        
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(file_size))
        self._send_common_headers(is_pmtiles, fs.st_mtime)
        self.end_headers()
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
    
    print(f"""
╔══════════════════════════════════════════════════════════════╗
║           PMTiles Viewer Server v2.0.0                       ║
╠══════════════════════════════════════════════════════════════╣
║  Server:     http://localhost:{port:<24}           ║
║  Viewer:     http://localhost:{port}/viewer.html{' '*14}║
║  Directory:  {base_dir[:45]:<45}║
╠══════════════════════════════════════════════════════════════╣
║  API Endpoints:                                              ║
║    GET /api/pmtiles      - List available PMTiles files      ║
║    GET /api/pmtiles/:id  - Get file details                  ║
║    GET /api/config       - Get server configuration          ║
║    GET /api/health       - Health check                      ║
╠══════════════════════════════════════════════════════════════╣
║  PMTiles Files: {files_info['count']:<3} found                                    ║
╚══════════════════════════════════════════════════════════════╝
    
Press Ctrl+C to stop the server
""")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[Server] Shutting down...")
        httpd.server_close()
        print("[Server] Stopped.")


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PORT
    run_server(port)
