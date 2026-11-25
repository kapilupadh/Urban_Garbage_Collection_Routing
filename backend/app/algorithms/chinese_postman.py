"""Minimum-length closed walks that cover every edge of a road graph."""

from math import isfinite
from typing import Hashable, List, Tuple

import networkx as nx

RoadStep = Tuple[Hashable, Hashable, Hashable]


def keyed_walk(graph: nx.MultiGraph, nodes: list) -> List[RoadStep]:
    """Identify the cheapest parallel edge for each shortest-path step."""
    return [
        (start, end, min(graph[start][end], key=lambda key: graph[start][end][key]["length"]))
        for start, end in zip(nodes, nodes[1:])
    ]


def chinese_postman(graph: nx.MultiGraph, depot: Hashable) -> List[RoadStep]:
    """Return an Euler circuit after duplicating a minimum-cost set of edges."""
    if depot not in graph:
        raise ValueError("The depot must be a node in the road graph")
    if graph.number_of_edges() == 0:
        return []
    connected = nx.is_strongly_connected if graph.is_directed() else nx.is_connected
    if not connected(graph):
        raise ValueError("A closed postman route requires a connected road graph with return paths to the depot")

    # Convert the stored lengths to exact integer weights for NetworkX's flow
    # and matching solvers. Binary float denominators are all powers of two.
    ratios = {}
    for start, end, key, data in graph.edges(keys=True, data=True):
        length = float(data.get("length", float("nan")))
        if not isfinite(length) or length < 0:
            raise ValueError(f"Road {start} to {end} has an invalid length")
        ratios[start, end, key] = length.as_integer_ratio()

    scale = max(denominator for _, denominator in ratios.values())
    augmented = graph.__class__()
    augmented.add_nodes_from(graph)
    costs = graph.__class__()
    costs.add_nodes_from(graph)
    for (start, end, key), (numerator, denominator) in ratios.items():
        costs.add_edge(start, end, key=key, length=numerator * (scale // denominator))
        augmented.add_edge(start, end, road_key=key)

    if graph.is_directed():
        # Each additional arc contributes +1 to out-degree at its tail
        # and +1 to in-degree at its head. Flow balances these differences.
        demands = {node: graph.out_degree(node) - graph.in_degree(node) for node in graph}
        if any(demands.values()):
            flow_graph = nx.DiGraph()
            flow_graph.add_nodes_from((node, {"demand": demand}) for node, demand in demands.items())
            for start, end, key, cost in costs.edges(keys=True, data="length"):
                previous = flow_graph.get_edge_data(start, end)
                if start != end and (previous is None or cost < previous["weight"]):
                    flow_graph.add_edge(start, end, weight=cost, road_key=key)
            _, flow = nx.network_simplex(flow_graph)
            for start, outgoing in flow.items():
                for end, count in outgoing.items():
                    for _ in range(count):
                        augmented.add_edge(start, end, road_key=flow_graph[start][end]["road_key"])
    else:
        odd_nodes = [node for node, degree in graph.degree if degree % 2]
        matching_graph = nx.Graph()
        paths = {}
        for index, start in enumerate(odd_nodes[:-1]):
            distances, shortest_paths = nx.single_source_dijkstra(costs, start, weight="length")
            for end in odd_nodes[index + 1:]:
                matching_graph.add_edge(start, end, weight=distances[end])
                paths[start, end] = shortest_paths[end]

        for start, end in nx.min_weight_matching(matching_graph):
            path = paths.get((start, end))
            if path is None:
                path = paths[end, start]
            for tail, head, key in keyed_walk(costs, path):
                augmented.add_edge(tail, head, road_key=key)

    return [
        (start, end, augmented[start][end][key]["road_key"])
        for start, end, key in nx.eulerian_circuit(augmented, source=depot, keys=True)
    ]
