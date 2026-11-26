import os
import json
import ssl
from functools import lru_cache
from threading import Lock
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from dataclasses import dataclass, field
from typing import FrozenSet, Hashable, List, Optional, Tuple

import networkx as nx
import numpy as np
import certifi


@dataclass
class RoadNetwork:
    graph: nx.Graph
    center: Tuple[float, float]
    distance_m: float
    depot_node: Optional[Hashable] = None
    bounds: Optional[Tuple[float, float, float, float]] = None
    depot_candidates: Optional[FrozenSet[Hashable]] = None
    node_ids: tuple = field(init=False, repr=False)
    coordinates_rad: np.ndarray = field(init=False, repr=False)

    def __post_init__(self):
        self.node_ids = tuple(self.graph)
        self.coordinates_rad = np.radians([
            (self.graph.nodes[node]["y"], self.graph.nodes[node]["x"])
            for node in self.node_ids
        ]).reshape(-1, 2)

    def contains(self, latitude: float, longitude: float) -> bool:
        if self.bounds is None:
            return True
        north, south, east, west = self.bounds
        longitude = west + (longitude - west) % 360
        return south <= latitude <= north and longitude <= east

    def snap(self, latitude: float, longitude: float, candidates=None) -> Hashable:
        lat, lon = np.radians([latitude, longitude])
        node_ids = self.node_ids
        coordinates = self.coordinates_rad
        if candidates is not None:
            indices = [index for index, node in enumerate(node_ids) if node in candidates]
            node_ids = tuple(node_ids[index] for index in indices)
            coordinates = coordinates[indices]
        node_lat, node_lon = coordinates.T
        # The haversine term increases with great-circle distance. The
        # nearest node needs neither the inverse sine nor the earth radius.
        distance = np.sin((node_lat - lat) / 2) ** 2
        distance += np.cos(lat) * np.cos(node_lat) * np.sin((node_lon - lon) / 2) ** 2
        return node_ids[int(distance.argmin())]

    def snap_within_bounds(self, latitude: float, longitude: float) -> Optional[Hashable]:
        return self.snap(latitude, longitude) if self.contains(latitude, longitude) else None

    def snap_depot(self, latitude: float, longitude: float) -> Optional[Hashable]:
        return self.snap(latitude, longitude, self.depot_candidates) if self.contains(latitude, longitude) else None


def edge_coordinates(graph, source, target, data) -> List[List[float]]:
    start = [float(graph.nodes[source]["y"]), float(graph.nodes[source]["x"])]
    end = [float(graph.nodes[target]["y"]), float(graph.nodes[target]["x"])]
    geometry = data.get("geometry")
    if geometry is None:
        return [start, end]

    coordinates = [[float(lat), float(lon)] for lon, lat in geometry.coords]
    if not coordinates:
        return [start, end]
    # An undirected edge or a reversed OSM geometry may start at the far end.
    first, last = coordinates[0], coordinates[-1]
    if (last[0] - start[0]) ** 2 + (last[1] - start[1]) ** 2 < (
        first[0] - start[0]
    ) ** 2 + (first[1] - start[1]) ** 2:
        coordinates.reverse()
    if coordinates[0] != start:
        coordinates.insert(0, start)
    if coordinates[-1] != end:
        coordinates.append(end)
    return coordinates


@lru_cache(maxsize=128)
def search_places(endpoint: str, query: str, limit: int) -> List[dict]:
    request = Request(
        f"{endpoint.rstrip('/')}/api/?" + urlencode({"q": query, "limit": limit}),
        headers={"User-Agent": "UrbanRouteSimulator/1.0", "Accept": "application/json"},
    )
    with urlopen(request, timeout=15, context=ssl.create_default_context(cafile=certifi.where())) as response:
        data = json.load(response)
    results = []
    for feature in data["features"]:
        properties = feature["properties"]
        lon, lat = feature["geometry"]["coordinates"]
        parts = (properties.get(key) for key in ("name", "city", "county", "state", "country"))
        results.append({
            "display_name": ", ".join(dict.fromkeys(part for part in parts if part)) or f"{lat}, {lon}",
            "latitude": lat,
            "longitude": lon,
            "type": properties.get("type", "location"),
        })
    return results


class RoadNetworkService:
    def __init__(self) -> None:
        self.network: Optional[RoadNetwork] = None
        self.load_lock = Lock()

    def search(self, query: str, limit: int = 5) -> List[dict]:
        return search_places(os.getenv("PHOTON_ENDPOINT", "https://photon.komoot.io"), query.strip(), limit)

    def fetch(self, latitude: float, longitude: float, distance_m: float) -> RoadNetwork:
        try:
            import osmnx as ox
        except ImportError as error:
            raise RuntimeError(
                "OSMnx is not installed. Run 'pip install -r backend/requirements.txt' "
                "inside the backend virtual environment."
            ) from error
        try:
            with self.load_lock:
                endpoint = os.getenv("OVERPASS_ENDPOINT")
                if endpoint:
                    ox.settings.overpass_url = endpoint.rstrip("/").removesuffix("/interpreter")
                graph = ox.graph_from_point(
                    (latitude, longitude), dist=distance_m, network_type="drive_service",
                    simplify=False, retain_all=True,
                )
                graph.remove_nodes_from(list(nx.isolates(graph)))
                graph = ox.simplify_graph(graph, remove_rings=False)
        except Exception as error:
            raise RuntimeError(
                "Overpass could not supply drivable roads. Try a smaller area or check "
                f"your Overpass connection. Details: {error}"
            ) from error
        if graph.number_of_edges() == 0:
            raise RuntimeError("OpenStreetMap returned no drivable roads for this region")
        depot_candidates = set()
        for component in nx.strongly_connected_components(graph):
            node = next(iter(component))
            if len(component) > 1 or graph.has_edge(node, node):
                depot_candidates.update(component)
        if not depot_candidates:
            raise RuntimeError("The selected area has no closed driving circuit. Load a larger area.")
        network = RoadNetwork(
            graph=graph,
            center=(latitude, longitude),
            distance_m=distance_m,
            bounds=ox.utils_geo.bbox_from_point((latitude, longitude), dist=distance_m),
            depot_candidates=frozenset(depot_candidates),
        )
        network.depot_node = network.snap_depot(latitude, longitude)
        return network

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
        return [
            edge_coordinates(graph, source, target, data)
            for source, target, data in graph.edges(data=True)
        ]
