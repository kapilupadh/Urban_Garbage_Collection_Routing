import os
import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple

import networkx as nx


@dataclass
class RoadNetwork:
    graph: nx.MultiDiGraph
    center: Tuple[float, float]
    distance_m: float
    depot_node: Optional[int] = None
    bin_nodes: Dict[int, int] = None


class RoadNetworkService:
    def __init__(self) -> None:
        self.network: Optional[RoadNetwork] = None

    def search(self, query: str, limit: int = 5) -> List[dict]:
        request = Request(
            "https://nominatim.openstreetmap.org/search?"
            + urlencode({"q": query, "format": "jsonv2", "limit": limit}),
            headers={"User-Agent": os.getenv("NOMINATIM_USER_AGENT", "urban-route-planner/1.0")},
        )
        with urlopen(request, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
        return [
            {
                "display_name": item["display_name"],
                "latitude": float(item["lat"]),
                "longitude": float(item["lon"]),
                "type": item.get("type", "location"),
            }
            for item in data
        ]

    def load(self, latitude: float, longitude: float, distance_m: float) -> RoadNetwork:
        try:
            import osmnx as ox
        except ImportError as error:
            raise RuntimeError(
                "OSMnx is not installed. Run 'pip install -r backend/requirements.txt' "
                "inside the backend virtual environment."
            ) from error
        graph = ox.graph_from_point(
            (latitude, longitude),
            dist=distance_m,
            network_type="drive",
            simplify=True,
        )
        if graph.number_of_nodes() == 0:
            raise RuntimeError("OpenStreetMap returned no drivable roads for this region")
        self.network = RoadNetwork(
            graph=graph,
            center=(latitude, longitude),
            distance_m=distance_m,
            bin_nodes={},
        )
        self.network.depot_node = self.snap(latitude, longitude)
        return self.network

    def snap(self, latitude: float, longitude: float) -> int:
        if not self.network:
            raise RuntimeError("Load an OpenStreetMap road network before snapping locations")
        try:
            import osmnx as ox
        except ImportError as error:
            raise RuntimeError("OSMnx is required for road snapping") from error
        return int(ox.distance.nearest_nodes(self.network.graph, longitude, latitude))

    def shortest(
        self, source: int, target: int
    ) -> Tuple[float, List[int], List[List[float]]]:
        if not self.network:
            raise RuntimeError("Road network is not loaded")
        try:
            nodes = nx.shortest_path(
                self.network.graph, source, target, weight="length", method="dijkstra"
            )
        except nx.NetworkXNoPath as error:
            raise ValueError(f"No drivable path exists between road nodes {source} and {target}") from error
        distance = 0.0
        geometry: List[List[float]] = []
        graph = self.network.graph
        for start, end in zip(nodes, nodes[1:]):
            edge_data = graph.get_edge_data(start, end)
            if not edge_data:
                raise ValueError(f"Missing road geometry for path segment {start} to {end}")
            edge_options = list(edge_data.values()) if graph.is_multigraph() else [edge_data]
            edge = min(edge_options, key=lambda item: item.get("length", float("inf")))
            distance += float(edge.get("length", 0))
            segment = edge.get("geometry")
            if segment is None:
                segment_coords = [
                    (graph.nodes[start]["y"], graph.nodes[start]["x"]),
                    (graph.nodes[end]["y"], graph.nodes[end]["x"]),
                ]
            else:
                segment_coords = [(lat, lon) for lon, lat in segment.coords]
            if geometry and segment_coords[0] != geometry[-1]:
                segment_coords.reverse()
            geometry.extend(segment_coords if not geometry else segment_coords[1:])
        if not nodes:
            geometry = [(graph.nodes[source]["y"], graph.nodes[source]["x"])]
        return distance, nodes, [[float(lat), float(lon)] for lat, lon in geometry]

    def status(self) -> dict:
        if not self.network:
            return {"loaded": False, "source": "OpenStreetMap", "nodes": 0, "edges": 0}
        return {
            "loaded": True,
            "center_latitude": self.network.center[0],
            "center_longitude": self.network.center[1],
            "distance_m": self.network.distance_m,
            "nodes": self.network.graph.number_of_nodes(),
            "edges": self.network.graph.number_of_edges(),
            "source": "OpenStreetMap",
        }

    def edges_geometry(self) -> List[List[List[float]]]:
        if not self.network:
            return []
        graph = self.network.graph
        result = []
        for source, target, data in graph.edges(data=True):
            geometry = data.get("geometry")
            if geometry is None:
                coordinates = [
                    [float(graph.nodes[source]["y"]), float(graph.nodes[source]["x"])],
                    [float(graph.nodes[target]["y"]), float(graph.nodes[target]["x"])],
                ]
            else:
                coordinates = [[float(lat), float(lon)] for lon, lat in geometry.coords]
            result.append(coordinates)
        return result
