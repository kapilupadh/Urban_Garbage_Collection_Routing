from typing import Dict, List, Tuple

import networkx as nx


def dijkstra_shortest_paths(
    graph: nx.Graph, source: int
) -> Tuple[Dict[int, float], Dict[int, List[int]]]:
    """Return shortest distances and concrete paths from one graph node."""
    distances, paths = nx.single_source_dijkstra(graph, source, weight="distance")
    return {node: float(distance) for node, distance in distances.items()}, paths
