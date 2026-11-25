from functools import wraps
from itertools import count
from math import fsum
from threading import RLock
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
state_lock = RLock()
bin_ids_sequence = count(max(BINS, default=0) + 1)
truck_ids_sequence = count(max(TRUCKS, default=0) + 1)


def synchronized(handler):
    @wraps(handler)
    def call(*args, **kwargs):
        with state_lock:
            return handler(*args, **kwargs)
    return call


def set_depot(name, latitude, longitude, network, node):
    DEPOT.name = name
    DEPOT.latitude, DEPOT.longitude = latitude, longitude
    DEPOT.snapped_node = node
    road_node = network.graph.nodes[node] if network is not None and node is not None else {}
    DEPOT.snapped_latitude = road_node.get("y")
    DEPOT.snapped_longitude = road_node.get("x")


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "road_network_loaded": network_service.network is not None}


@router.get("/locations/search", response_model=List[LocationSearchResult])
def search_locations(query: str = Query(min_length=2, max_length=200)) -> List[dict]:
    if len(query.strip()) < 2:
        raise HTTPException(status_code=422, detail="Enter at least two characters to search")
    try:
        return network_service.search(query)
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Location search failed: {error}") from error


@router.get("/network", response_model=NetworkStatus)
@synchronized
def network_status() -> dict:
    return network_service.status()


@router.get("/network/edges", response_model=List[RoadEdge])
@synchronized
def network_edges() -> List[dict]:
    if not network_service.network:
        raise HTTPException(status_code=409, detail="Load an OpenStreetMap road network first")
    return [{"geometry": geometry} for geometry in network_service.edges_geometry()]


@router.post("/network/load", response_model=NetworkStatus)
def load_network(payload: NetworkLoadRequest) -> dict:
    try:
        network = network_service.fetch(payload.latitude, payload.longitude, payload.distance_m)
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"OpenStreetMap road network could not be loaded: {error}",
        ) from error
    with state_lock:
        network_service.network = network
        set_depot(DEPOT.name, *network.center, network, network.depot_node)
        for item in list(BINS.values()):
            node = network.snap_within_bounds(item.latitude, item.longitude)
            BINS[item.id] = item.model_copy(update={"snapped_node": node})
        global last_route
        last_route = None
        return network_service.status()


@router.get("/bins", response_model=List[Bin])
@synchronized
def list_bins() -> List[Bin]:
    return list(BINS.values())


@router.post("/bins", response_model=Bin, status_code=201)
@synchronized
def create_bin(payload: BinCreate) -> Bin:
    item = Bin(id=next(bin_ids_sequence), **payload.model_dump())
    if network_service.network:
        item.snapped_node = network_service.network.snap_within_bounds(item.latitude, item.longitude)
    BINS[item.id] = item
    global last_route
    last_route = None
    return item


@router.put("/bins/{bin_id}", response_model=Bin)
@synchronized
def update_bin(bin_id: int, payload: BinCreate) -> Bin:
    if bin_id not in BINS:
        raise HTTPException(status_code=404, detail="Bin not found")
    item = Bin(id=bin_id, **payload.model_dump())
    if network_service.network:
        item.snapped_node = network_service.network.snap_within_bounds(item.latitude, item.longitude)
    BINS[bin_id] = item
    global last_route
    last_route = None
    return item


@router.delete("/bins/{bin_id}")
@synchronized
def delete_bin(bin_id: int) -> dict:
    if bin_id not in BINS:
        raise HTTPException(status_code=404, detail="Bin not found")
    del BINS[bin_id]
    global last_route
    last_route = None
    return {"message": "Bin deleted"}


@router.get("/trucks", response_model=List[Truck])
@synchronized
def list_trucks() -> List[Truck]:
    return list(TRUCKS.values())


@router.post("/trucks", response_model=Truck, status_code=201)
@synchronized
def create_truck(payload: TruckCreate) -> Truck:
    item = Truck(id=next(truck_ids_sequence), **payload.model_dump())
    TRUCKS[item.id] = item
    global last_route
    last_route = None
    return item


@router.put("/trucks/{truck_id}", response_model=Truck)
@synchronized
def update_truck(truck_id: int, payload: TruckCreate) -> Truck:
    if truck_id not in TRUCKS:
        raise HTTPException(status_code=404, detail="Truck not found")
    item = Truck(id=truck_id, **payload.model_dump())
    TRUCKS[truck_id] = item
    global last_route
    last_route = None
    return item


@router.delete("/trucks/{truck_id}")
@synchronized
def delete_truck(truck_id: int) -> dict:
    if truck_id not in TRUCKS:
        raise HTTPException(status_code=404, detail="Truck not found")
    del TRUCKS[truck_id]
    global last_route
    last_route = None
    return {"message": "Truck deleted"}


@router.get("/depot", response_model=Depot)
@synchronized
def get_depot() -> Depot:
    return DEPOT.model_copy()


@router.put("/depot", response_model=Depot)
@synchronized
def update_depot(payload: Depot) -> Depot:
    node = None
    network = network_service.network
    if network:
        node = network.snap_depot(payload.latitude, payload.longitude)
        if node is None:
            raise HTTPException(status_code=422, detail="Choose a depot inside the loaded road area")
        network.depot_node = node
    set_depot(payload.name, payload.latitude, payload.longitude, network, node)
    global last_route
    last_route = None
    return DEPOT.model_copy()


@router.post("/routes/optimize", response_model=RouteResponse)
@synchronized
def optimize(payload: OptimizeRequest) -> RouteResponse:
    if not network_service.network or DEPOT.snapped_node is None:
        raise HTTPException(status_code=409, detail="Load an OpenStreetMap road network before optimizing")
    truck_ids = list(TRUCKS) if payload.truck_ids is None else list(dict.fromkeys(payload.truck_ids))
    bin_ids = list(BINS) if payload.bin_ids is None else list(dict.fromkeys(payload.bin_ids))
    unknown_trucks = [item for item in truck_ids if item not in TRUCKS]
    if unknown_trucks:
        raise HTTPException(status_code=404, detail=f"Unknown truck IDs: {unknown_trucks}")
    unknown_bins = [item for item in bin_ids if item not in BINS]
    if unknown_bins:
        raise HTTPException(status_code=404, detail=f"Unknown bin IDs: {unknown_bins}")
    try:
        routes, unassigned, elapsed, covered_edges, excluded_edges, postman_distance = optimize_fleet(
            network_service,
            DEPOT.snapped_node,
            BINS,
            TRUCKS,
            truck_ids,
            bin_ids,
            DEPOT.name,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    global last_route
    last_route = RouteResponse(
        routes=routes,
        total_distance_m=fsum(item.distance_m for item in routes),
        postman_distance_m=postman_distance,
        covered_edges=covered_edges,
        excluded_edges=excluded_edges,
        visited_bins=len(bin_ids) - len(unassigned),
        collected_demand=sum(item.collected_demand for item in routes),
        unassigned_bin_ids=sorted(unassigned),
        execution_time_ms=elapsed,
        constraint_violations=[unassigned[item] for item in sorted(unassigned)],
    )
    return last_route


@router.get("/routes", response_model=List[RouteResponse])
@synchronized
def list_routes() -> List[RouteResponse]:
    return [last_route] if last_route else []


@router.post("/benchmarks/synthetic", response_model=BenchmarkResult)
def benchmark(payload: BenchmarkRequest) -> BenchmarkResult:
    return synthetic_benchmark(payload.bin_count, payload.truck_count, payload.capacity, payload.seed)
