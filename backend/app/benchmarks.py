import random
import time
from typing import Dict

import networkx as nx

from app.schemas import Bin, BenchmarkResult, Truck
from app.services.fleet_optimizer import optimize_fleet
from app.services.road_network import RoadNetworkService


def synthetic_benchmark(bin_count: int, truck_count: int, capacity: float, seed: int) -> BenchmarkResult:
    random.seed(seed)
    graph = nx.grid_2d_graph(40, 40)
    for source, target in list(graph.edges):
        graph.edges[source, target]["length"] = 100
    service = RoadNetworkService()
    # Benchmark is deterministic and does not claim to be real geographical data.
    service.network = type("SyntheticNetwork", (), {"graph": graph, "center": (0, 0), "distance_m": 0})()
    depot = (20, 20)
    for node in graph.nodes:
        graph.nodes[node]["y"] = node[0]
        graph.nodes[node]["x"] = node[1]
    bins: Dict[int, Bin] = {}
    for index in range(1, bin_count + 1):
        node = (random.randrange(40), random.randrange(40))
        bins[index] = Bin(id=index, name=f"Synthetic {index}", demand=1, latitude=node[0], longitude=node[1])
    trucks = {index: Truck(id=index, name=f"Truck {index}", capacity=capacity) for index in range(1, truck_count + 1)}
    service.snap = lambda latitude, longitude: (int(latitude), int(longitude))
    started = time.perf_counter()
    routes, unassigned, _ = optimize_fleet(service, depot, bins, trucks, list(trucks), list(bins))
    elapsed = (time.perf_counter() - started) * 1000
    return BenchmarkResult(
        bin_count=bin_count,
        truck_count=truck_count,
        total_distance_m=sum(route.distance_m for route in routes),
        execution_time_ms=elapsed,
        visited_bins=bin_count - len(unassigned),
        unassigned_bins=len(unassigned),
        capacity_violations=0,
    )
