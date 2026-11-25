import random
from math import fsum
from typing import Dict

import networkx as nx

from app.schemas import Bin, BenchmarkResult, Truck
from app.services.fleet_optimizer import optimize_fleet
from app.services.road_network import RoadNetwork, RoadNetworkService


def synthetic_benchmark(bin_count: int, truck_count: int, capacity: float, seed: int) -> BenchmarkResult:
    rng = random.Random(seed)
    graph = nx.grid_2d_graph(40, 40, create_using=nx.MultiDiGraph)
    nx.set_edge_attributes(graph, 100, "length")
    service = RoadNetworkService()
    # Benchmark is deterministic and does not claim to be real geographical data.
    depot = (20, 20)
    for node in graph.nodes:
        graph.nodes[node]["y"] = node[0]
        graph.nodes[node]["x"] = node[1]
    service.network = RoadNetwork(graph=graph, center=depot, distance_m=0, depot_node=depot)
    bins: Dict[int, Bin] = {}
    for index in range(1, bin_count + 1):
        node = (rng.randrange(40), rng.randrange(40))
        bins[index] = Bin(id=index, name=f"Synthetic {index}", demand=1, latitude=node[0], longitude=node[1])
    trucks = {index: Truck(id=index, name=f"Truck {index}", capacity=capacity) for index in range(1, truck_count + 1)}
    routes, unassigned, elapsed, covered_edges, _, postman_distance = optimize_fleet(
        service, depot, bins, trucks, list(trucks), list(bins)
    )
    return BenchmarkResult(
        bin_count=bin_count,
        truck_count=truck_count,
        total_distance_m=fsum(route.distance_m for route in routes),
        postman_distance_m=postman_distance,
        covered_edges=covered_edges,
        execution_time_ms=elapsed,
        visited_bins=bin_count - len(unassigned),
        unassigned_bins=len(unassigned),
        capacity_violations=sum(route.capacity_utilization > 1 for route in routes),
    )
