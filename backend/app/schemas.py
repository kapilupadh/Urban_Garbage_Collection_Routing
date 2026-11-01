from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class Bin(BaseModel):
    id: int
    name: str
    demand: float = Field(gt=0)
    latitude: float
    longitude: float
    status: str = "Pending"
    snapped_node: Optional[int] = None


class BinCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    demand: float = Field(gt=0)
    latitude: float
    longitude: float


class Truck(BaseModel):
    id: int
    name: str
    capacity: float = Field(gt=0)
    status: str = "Available"


class TruckCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    capacity: float = Field(gt=0)


class Depot(BaseModel):
    id: int = 0
    name: str
    latitude: float
    longitude: float
    snapped_node: Optional[int] = None


class LocationSearchResult(BaseModel):
    display_name: str
    latitude: float
    longitude: float
    type: str = "location"


class NetworkLoadRequest(BaseModel):
    latitude: float
    longitude: float
    distance_m: float = Field(default=5000, gt=500, le=50000)


class NetworkStatus(BaseModel):
    loaded: bool
    center_latitude: Optional[float] = None
    center_longitude: Optional[float] = None
    distance_m: Optional[float] = None
    nodes: int = 0
    edges: int = 0
    source: str = "OpenStreetMap"


class RoadEdge(BaseModel):
    geometry: List[List[float]]


class OptimizeRequest(BaseModel):
    truck_ids: Optional[List[int]] = None
    bin_ids: Optional[List[int]] = None


class TruckRoute(BaseModel):
    truck_id: int
    truck_name: str
    sequence: List[int]
    stop_names: List[str]
    geometry: List[List[float]]
    distance_m: float
    collected_demand: float
    capacity_utilization: float
    depot_returns: int
    trips: int


class RouteResponse(BaseModel):
    routes: List[TruckRoute]
    total_distance_m: float
    visited_bins: int
    collected_demand: float
    unassigned_bin_ids: List[int]
    execution_time_ms: float
    constraint_violations: List[str]
    is_real_road_network: bool = True
    network_source: str = "OpenStreetMap"


class BenchmarkRequest(BaseModel):
    bin_count: int = Field(default=10, ge=10, le=1000)
    truck_count: int = Field(default=3, ge=1, le=100)
    capacity: float = Field(default=10, gt=0)
    seed: int = 42


class BenchmarkResult(BaseModel):
    bin_count: int
    truck_count: int
    total_distance_m: float
    execution_time_ms: float
    visited_bins: int
    unassigned_bins: int
    capacity_violations: int
    dataset: str = "synthetic"
