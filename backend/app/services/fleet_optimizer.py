import time
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal
from functools import lru_cache
from heapq import heappop, heappush
from itertools import accumulate
from math import fsum
from typing import List

import networkx as nx

from app.algorithms.chinese_postman import RoadStep, chinese_postman, keyed_walk
from app.schemas import Bin, RouteTrip, TruckRoute
from app.services.road_network import RoadNetworkService, edge_coordinates


@dataclass
class Trip:
    load: Decimal = Decimal(0)
    stops: List[Bin] = field(default_factory=list)
    walk: List[RoadStep] = field(default_factory=list)


def optimize_fleet(network: RoadNetworkService, depot_node, bins: dict, trucks: dict,
                   truck_ids: list, bin_ids: list, depot_name: str = "Central Depot"):
    started = time.perf_counter()
    active_trucks = [trucks[truck_id] for truck_id in dict.fromkeys(truck_ids)]
    if not active_trucks:
        raise ValueError("Select at least one truck")

    graph = network.network.graph
    if graph.is_directed():
        eligible = nx.descendants(graph, depot_node) & nx.ancestors(graph, depot_node)
        eligible.add(depot_node)
    else:
        eligible = nx.node_connected_component(graph, depot_node)
    road_graph = graph.subgraph(eligible)
    if graph.number_of_edges() and not road_graph.number_of_edges():
        raise ValueError("No drivable road circuit connects to the depot")
    if not road_graph.is_multigraph():
        road_graph = nx.MultiDiGraph(road_graph) if graph.is_directed() else nx.MultiGraph(road_graph)

    @lru_cache(maxsize=None)
    def connector(start, end):
        return keyed_walk(road_graph, nx.dijkstra_path(road_graph, start, end, weight="length"))

    def distance(walk):
        return fsum(road_graph[start][end][key]["length"] for start, end, key in walk)

    capacity = {truck.id: Decimal(str(truck.capacity)) for truck in active_trucks}
    largest_capacity = max(capacity.values())
    unassigned = {}
    stops_at = defaultdict(list)
    for bin_id in dict.fromkeys(bin_ids):
        item = bins[bin_id]
        node = network.network.snap_within_bounds(item.latitude, item.longitude)
        if node is None:
            unassigned[bin_id] = f"Bin {bin_id} ({item.name}) is outside the loaded road area"
        elif node not in eligible:
            unassigned[bin_id] = f"Bin {bin_id} has no road round trip to the depot"
        elif Decimal(str(item.demand)) > largest_capacity:
            unassigned[bin_id] = f"Bin {bin_id} exceeds every selected truck's capacity"
        else:
            stops_at[node].append(item)

    walk = chinese_postman(road_graph, depot_node)
    nodes = [depot_node, *(step[1] for step in walk)]
    stops = [(index, item) for index, node in enumerate(nodes) for item in stops_at.pop(node, [])]
    demands = [Decimal(str(item.demand)) for _, item in stops]

    # Work backward to find the lowest-cost depot detours for this fixed
    # circuit and collection order. Break ties in favor of fewer trips.
    next_stop = [0] * len(stops)
    break_positions = [0] * len(stops)
    if sum(demands) > largest_capacity:
        from_depot = nx.single_source_dijkstra_path_length(road_graph, depot_node, weight="length")
        reverse = road_graph.reverse(copy=False) if road_graph.is_directed() else road_graph
        to_depot = nx.single_source_dijkstra_path_length(reverse, depot_node, weight="length")
        round_trip = [from_depot[node] + to_depot[node] for node in nodes]
        # A trip can break anywhere after the last collection and before
        # the next one, including at a depot visit already on the circuit.
        for end in range(1, len(stops)):
            previous, following = stops[end - 1][0], stops[end][0]
            break_positions[end] = min(range(previous, following + 1), key=round_trip.__getitem__)
        # Each endpoint's cost is independent of the trip's start. As the
        # start moves backward, the last endpoint that fits can only decrease.
        prefix_load = [Decimal(0), *accumulate(demands)]
        candidates = [(0.0, 1, len(stops))]
        for start in range(len(stops) - 1, -1, -1):
            limit = bisect_right(prefix_load, prefix_load[start] + largest_capacity) - 1
            while candidates[0][2] > limit:
                heappop(candidates)
            cost, trip_count, next_stop[start] = candidates[0]
            if start:
                heappush(candidates, (cost + round_trip[break_positions[start]], trip_count + 1, start))
    elif stops:
        next_stop[0] = len(stops)

    trips = defaultdict(list)
    next_truck = 0
    start = left = 0
    while True:
        end = next_stop[start] if stops else 0
        load = sum(demands[start:end], Decimal(0))
        for offset in range(len(active_trucks)):
            index = (next_truck + offset) % len(active_trucks)
            truck = active_trucks[index]
            if capacity[truck.id] >= load:
                next_truck = (index + 1) % len(active_trucks)
                break

        right = break_positions[end] if end < len(stops) else len(walk)
        trips[truck.id].append(Trip(
            load=load,
            stops=[item for _, item in stops[start:end]],
            walk=[*connector(depot_node, nodes[left]), *walk[left:right], *connector(nodes[right], depot_node)],
        ))
        if end == len(stops):
            break
        start, left = end, right

    def walk_geometry(steps):
        geometry = []
        for start, end, key in steps:
            segment = edge_coordinates(road_graph, start, end, road_graph[start][end][key])
            geometry.extend(segment[1:] if geometry else segment)
        if not geometry:
            node = road_graph.nodes[depot_node]
            geometry.append([node["y"], node["x"]])
        return geometry

    routes = []
    for truck_id, truck_trips in trips.items():
        truck = trucks[truck_id]
        trip_count = len(truck_trips)
        collected = sum(trip.load for trip in truck_trips)
        sequence = [0]
        stop_names = [depot_name]
        geometry = []
        trip_details = []
        for trip in truck_trips:
            details = RouteTrip(
                sequence=[0, *(item.id for item in trip.stops), 0],
                stop_names=[depot_name, *(item.name for item in trip.stops), depot_name],
                geometry=walk_geometry(trip.walk),
                distance_m=distance(trip.walk),
                collected_demand=float(trip.load),
            )
            trip_details.append(details)
            sequence.extend(details.sequence[1:])
            stop_names.extend(details.stop_names[1:])
            geometry.extend(details.geometry[1:] if geometry else details.geometry)
        routes.append(TruckRoute(
            truck_id=truck_id,
            truck_name=truck.name,
            sequence=sequence,
            stop_names=stop_names,
            geometry=geometry,
            distance_m=fsum(trip.distance_m for trip in trip_details),
            collected_demand=float(collected),
            capacity_utilization=float(collected / (capacity[truck_id] * trip_count)),
            depot_returns=trip_count,
            trips=trip_count,
            trip_details=trip_details,
        ))

    return (
        routes,
        unassigned,
        (time.perf_counter() - started) * 1000,
        road_graph.number_of_edges(),
        graph.number_of_edges() - road_graph.number_of_edges(),
        distance(walk),
    )
