from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from app.benchmarks import synthetic_benchmark
from app.schemas import (
    BenchmarkRequest,
    BenchmarkResult,
    Bin,
    BinCreate,
    Depot,
    LocationSearchResult,
    NetworkLoadRequest,
    NetworkStatus,
    OptimizeRequest,
    RoadEdge,
    RouteResponse,
    Truck,
    TruckCreate,
)
from app.services.data import BINS, DEPOT, TRUCKS
from app.services.fleet_optimizer import optimize_fleet
from app.services.road_network import RoadNetworkService

router = APIRouter(prefix="/api")
network_service = RoadNetworkService()
last_route: Optional[RouteResponse] = None


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "road_network_loaded": network_service.network is not None}


@router.get("/locations/search", response_model=List[LocationSearchResult])
def search_locations(query: str = Query(min_length=2, max_length=200)) -> List[dict]:
    try:
        return network_service.search(query)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Location search failed: {error}") from error


@router.get("/network", response_model=NetworkStatus)
def network_status() -> dict:
    return network_service.status()


@router.get("/network/edges", response_model=List[RoadEdge])
def network_edges() -> List[dict]:
    if not network_service.network:
        raise HTTPException(status_code=409, detail="Load an OpenStreetMap road network first")
    return [{"geometry": geometry} for geometry in network_service.edges_geometry()]


@router.post("/network/load", response_model=NetworkStatus)
def load_network(payload: NetworkLoadRequest) -> dict:
    try:
        network_service.load(payload.latitude, payload.longitude, payload.distance_m)
        DEPOT.snapped_node = network_service.network.depot_node
        return network_service.status()
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"OpenStreetMap road network could not be loaded: {error}",
        ) from error


@router.get("/bins", response_model=List[Bin])
def list_bins() -> List[Bin]:
    return list(BINS.values())


@router.post("/bins", response_model=Bin, status_code=201)
def create_bin(payload: BinCreate) -> Bin:
    next_id = max(BINS, default=0) + 1
    item = Bin(id=next_id, **payload.model_dump())
    if network_service.network:
        item.snapped_node = network_service.snap(item.latitude, item.longitude)
    BINS[next_id] = item
    return item


@router.put("/bins/{bin_id}", response_model=Bin)
def update_bin(bin_id: int, payload: BinCreate) -> Bin:
    if bin_id not in BINS:
        raise HTTPException(status_code=404, detail="Bin not found")
    item = Bin(id=bin_id, **payload.model_dump())
    if network_service.network:
        item.snapped_node = network_service.snap(item.latitude, item.longitude)
    BINS[bin_id] = item
    return item


@router.delete("/bins/{bin_id}")
def delete_bin(bin_id: int) -> dict:
    if bin_id not in BINS:
        raise HTTPException(status_code=404, detail="Bin not found")
    del BINS[bin_id]
    return {"message": "Bin deleted"}


@router.get("/trucks", response_model=List[Truck])
def list_trucks() -> List[Truck]:
    return list(TRUCKS.values())


@router.post("/trucks", response_model=Truck, status_code=201)
def create_truck(payload: TruckCreate) -> Truck:
    next_id = max(TRUCKS, default=0) + 1
    item = Truck(id=next_id, **payload.model_dump())
    TRUCKS[next_id] = item
    return item


@router.put("/trucks/{truck_id}", response_model=Truck)
def update_truck(truck_id: int, payload: TruckCreate) -> Truck:
    if truck_id not in TRUCKS:
        raise HTTPException(status_code=404, detail="Truck not found")
    item = Truck(id=truck_id, **payload.model_dump())
    TRUCKS[truck_id] = item
    return item


@router.delete("/trucks/{truck_id}")
def delete_truck(truck_id: int) -> dict:
    if truck_id not in TRUCKS:
        raise HTTPException(status_code=404, detail="Truck not found")
    del TRUCKS[truck_id]
    return {"message": "Truck deleted"}


@router.get("/depot", response_model=Depot)
def get_depot() -> Depot:
    return DEPOT


@router.put("/depot", response_model=Depot)
def update_depot(payload: Depot) -> Depot:
    DEPOT.name = payload.name
    DEPOT.latitude = payload.latitude
    DEPOT.longitude = payload.longitude
    if network_service.network:
        DEPOT.snapped_node = network_service.snap(payload.latitude, payload.longitude)
        network_service.network.depot_node = DEPOT.snapped_node
    return DEPOT


@router.post("/routes/optimize", response_model=RouteResponse)
def optimize(payload: OptimizeRequest) -> RouteResponse:
    if not network_service.network or DEPOT.snapped_node is None:
        raise HTTPException(status_code=409, detail="Load an OpenStreetMap road network before optimizing")
    truck_ids = payload.truck_ids or list(TRUCKS)
    bin_ids = payload.bin_ids or list(BINS)
    unknown_bins = [item for item in bin_ids if item not in BINS]
    if unknown_bins:
        raise HTTPException(status_code=404, detail=f"Unknown bin IDs: {unknown_bins}")
    try:
        routes, unassigned, elapsed = optimize_fleet(
            network_service,
            DEPOT.snapped_node,
            BINS,
            TRUCKS,
            truck_ids,
            bin_ids,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    global last_route
    last_route = RouteResponse(
        routes=routes,
        total_distance_m=sum(item.distance_m for item in routes),
        visited_bins=len(bin_ids) - len(unassigned),
        collected_demand=sum(item.collected_demand for item in routes),
        unassigned_bin_ids=unassigned,
        execution_time_ms=elapsed,
        constraint_violations=[
            f"Bin {item} could not be assigned within selected truck capacities"
            for item in unassigned
        ],
    )
    return last_route


@router.get("/routes", response_model=List[RouteResponse])
def list_routes() -> List[RouteResponse]:
    return [last_route] if last_route else []


@router.post("/benchmarks/synthetic", response_model=BenchmarkResult)
def benchmark(payload: BenchmarkRequest) -> BenchmarkResult:
    return synthetic_benchmark(payload.bin_count, payload.truck_count, payload.capacity, payload.seed)
