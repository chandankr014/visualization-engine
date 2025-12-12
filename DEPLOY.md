Plan: Deploy Flood Visualization App to AWS & Vercel
Complete deployment strategy for a 100-200 MB geospatial application with PMTiles serving, supporting 1000+ concurrent users via CDN optimization.

Steps
AWS Deployment (Recommended) - Set up S3 bucket for static assets, CloudFront CDN with Range request support and gzip, Lambda functions for /api/* endpoints, API Gateway routing, configure Cache-Control headers (PMTiles: 7 days, GeoJSON: 1 hour)

Vercel Deployment (Hybrid) - Deploy frontend + API to Vercel with serverless functions, store PMTiles (100-200 MB) on external S3/CloudFlare R2 due to 50 MB file limit, configure vercel.json with Range request headers, set up automatic HTTPS + edge caching (200+ locations)

Pre-Deployment Optimizations - Convert large GeoJSON files (city_wards_boundary.geojson, ggn_roadways_clean.geojson) to PMTiles using tippecanoe (70-90% size reduction), minify JavaScript modules in js, enable gzip compression for text assets, optimize PMTiles with maximum compression

CDN Configuration - Enable CloudFront/Vercel edge caching for all PMTiles files (immutable, 1-week TTL), cache GeoJSON data (1-hour TTL), enable HTTP/2 + Brotli compression, configure Range request forwarding for PMTiles byte-range requests, set up cache invalidation strategy

Production Server Setup - Replace server.py BaseHTTPServer with production WSGI (Gunicorn/uWSGI) for Lambda, refactor API endpoints into separate Lambda functions (config-handler, geojson-handler, precipitation-handler), implement API response caching (60s TTL), add CloudWatch logging and monitoring

Performance & Monitoring - Set up CloudWatch/Vercel Analytics dashboards, track cache hit ratio (target: >90%), monitor P95 response times (target: <500ms), implement error tracking and alerting, load test with 100+ concurrent users, optimize based on real metrics

Further Considerations
Cost Comparison - AWS: $10-30/month (S3 + CloudFront + Lambda), Vercel Free tier: $0 (100 GB bandwidth/month), Vercel Pro: $20/month (1 TB bandwidth), CloudFlare R2 + Workers: $5-10/month (zero egress fees) - which budget fits best?

File Size Constraint - Vercel has 50 MB file size limit per file; some PMTiles batches may exceed this. Use hybrid approach (Vercel frontend + S3 PMTiles) or pure AWS deployment?

MapTiler API Key Security - Currently hardcoded R0asFVRtuNV5ghpmqbyM in map-manager.js:47-50 - should move to environment variables and implement key rotation strategy