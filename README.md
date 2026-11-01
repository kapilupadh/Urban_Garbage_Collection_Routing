# Urban Garbage Collection Route Optimization System

This repository contains a FastAPI and Next.js route-control platform for
municipal waste collection. The upgraded implementation uses real drivable
OpenStreetMap data loaded on demand through OSMnx; it does not substitute an
illustrative adjacency matrix or straight-line route when road data is
unavailable.

## Architecture

- `backend/app/services/road_network.py`: Nominatim location search, OSMnx
  drivable-network download, nearest-road snapping, directed Dijkstra paths and
  road geometry extraction.
- `backend/app/services/fleet_optimizer.py`: capacity-aware multi-truck
  assignment with depot returns and unassigned-bin reporting.
- `backend/app/benchmarks.py`: reproducible synthetic benchmarks for 10, 50,
  100, 500 and 1,000 bins.
- `backend/app/api.py`: location, network, depot, bin, truck, optimization and
  benchmark REST endpoints.
- `frontend/components`: responsive operations dashboard and colored
  road-geometry route map.

The route assignment is a deterministic heuristic, not a proof of global CVRP
optimality. Dijkstra is used for each actual road-to-road shortest path.

## Run locally

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. python -m uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. Search a city or address, select a result, wait
for the OpenStreetMap road graph to load, add bins/trucks, and optimize.
FastAPI documentation is available at `http://localhost:8000/docs`.

## API highlights

- `GET /api/locations/search?query=...`
- `POST /api/network/load`
- `GET|POST|PUT|DELETE /api/bins`
- `GET|POST|PUT|DELETE /api/trucks`
- `GET|PUT /api/depot`
- `POST /api/routes/optimize`
- `POST /api/benchmarks/synthetic`

OpenStreetMap/Nominatim services are rate-limited and network-dependent. Errors
are surfaced to the user; no fake road result is returned.
