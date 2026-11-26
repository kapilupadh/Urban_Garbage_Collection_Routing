import io
import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from fastapi.testclient import TestClient

from app import api
from app.main import app
from app.services.road_network import search_places


def overpass_fixture(*args, **kwargs):
    nodes = [
        (1, 15.4909, 73.8278), (2, 15.4915, 73.8280),
        (3, 15.4916, 73.8290), (4, 15.4908, 73.8292),
        (5, 15.4890, 73.8280), (6, 15.4891, 73.8285), (7, 15.4892, 73.8282),
    ]
    ways = [(11, [1, 2, 3], "yes"), (12, [3, 4, 1], "no"), (13, [2, 4], "no"), (14, [5, 6, 7, 5], "yes")]
    yield {"elements": [
        *({"type": "node", "id": node, "lat": lat, "lon": lon} for node, lat, lon in nodes),
        *({"type": "way", "id": way, "nodes": stops, "tags": {
            "highway": "residential", "oneway": oneway,
        }} for way, stops, oneway in ways),
    ]}


def photon_fixture():
    return {
        "features": [{
            "geometry": {"coordinates": [73.8278, 15.4909]},
            "properties": {"name": "Panaji", "state": "Goa", "country": "India", "type": "city"},
        }],
    }


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.initial_trucks = api.TRUCKS.copy()
        self.initial_depot = api.DEPOT.model_copy()
        self.addCleanup(self.reset_state)

    def reset_state(self):
        self.client.close()
        api.BINS.clear()
        api.TRUCKS.clear()
        api.TRUCKS.update(self.initial_trucks)
        api.DEPOT = self.initial_depot
        api.network_service.network = None
        api.last_route = None
        search_places.cache_clear()

    def load_fixture(self, latitude=15.4909, longitude=73.8278):
        with patch("osmnx._overpass._download_overpass_network", overpass_fixture):
            result = self.client.post("/api/network/load", json={
                "latitude": latitude, "longitude": longitude, "distance_m": 500,
            })
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def test_geocoder_integration_and_cached_query(self):
        with patch("app.services.road_network.urlopen", return_value=io.BytesIO(
            json.dumps(photon_fixture()).encode()
        )) as request:
            for _ in range(2):
                response = self.client.get("/api/locations/search", params={"query": "Panaji, Goa"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()[0]["display_name"], "Panaji, Goa, India")
                self.assertEqual(response.json()[0]["longitude"], 73.8278)
            request.assert_called_once()
            self.assertIn("q=Panaji%2C+Goa", request.call_args.args[0].full_url)
        self.assertEqual(self.client.get("/api/locations/search", params={"query": "  "}).status_code, 422)

    def test_load_optimize_edit_delete_and_failed_reload(self):
        self.assertEqual(self.client.get("/api/health").json()["road_network_loaded"], False)
        initial = self.client.get("/api/session").json()
        self.assertFalse(initial["network"]["loaded"])
        self.assertEqual(initial["road_edges"], [])
        self.assertEqual(initial["bins"], [])
        self.assertIsNone(initial["route"])
        self.assertEqual(initial["trucks"], self.client.get("/api/trucks").json())
        favicon = self.client.get("/favicon.ico")
        self.assertEqual(favicon.status_code, 200)
        self.assertEqual(favicon.headers["content-type"], "image/x-icon")
        self.assertEqual(self.client.get("/api/network/edges").status_code, 409)
        self.assertEqual(self.client.post("/api/routes/optimize", json={}).status_code, 409)
        network = self.load_fixture()
        edges = self.client.get("/api/network/edges").json()
        self.assertGreater(network["edges"], 0)
        self.assertEqual(network["edges"], len(edges))
        graph = api.network_service.network.graph
        self.assertTrue(graph.has_edge(1, 2))
        self.assertFalse(graph.has_edge(2, 1))
        depot = self.client.get("/api/depot").json()
        self.assertEqual(depot["snapped_latitude"], 15.4909)

        truck = self.client.post("/api/trucks", json={"name": "Test truck", "capacity": 1}).json()
        bin_payload = {"name": "Market", "demand": 1, "latitude": 15.4915, "longitude": 73.8280}
        first = self.client.post("/api/bins", json=bin_payload).json()
        second = self.client.post("/api/bins", json={**bin_payload, "name": "Depot stop", "latitude": 15.4909, "longitude": 73.8278}).json()
        distant = self.client.post("/api/bins", json={**bin_payload, "name": "Out of area", "latitude": 21}).json()
        self.assertIsNone(distant["snapped_node"])

        result = self.client.post("/api/routes/optimize", json={"truck_ids": [truck["id"]]})
        self.assertEqual(result.status_code, 200, result.text)
        plan = result.json()
        self.assertEqual(plan["visited_bins"], 2)
        self.assertEqual(plan["unassigned_bin_ids"], [distant["id"]])
        self.assertEqual(plan["covered_edges"] + plan["excluded_edges"], network["edges"])
        self.assertEqual(plan["excluded_edges"], 3)
        details = plan["routes"][0]["trip_details"]
        self.assertEqual(len(details), 2)
        self.assertEqual(sorted(item["sequence"][1] for item in details), [first["id"], second["id"]])
        for trip in details:
            self.assertEqual(trip["geometry"][0], trip["geometry"][-1])
            self.assertEqual(trip["collected_demand"], 1)
        self.assertAlmostEqual(sum(trip["distance_m"] for trip in details), plan["total_distance_m"])
        self.assertEqual(self.client.get("/api/routes").json(), [plan])
        snapshot = self.client.get("/api/session").json()
        self.assertEqual(snapshot["network"], network)
        self.assertEqual(snapshot["road_edges"], edges)
        self.assertEqual(snapshot["depot"], depot)
        self.assertEqual(snapshot["bins"], [first, second, distant])
        self.assertEqual(snapshot["route"], plan)
        with patch.object(api.network_service, "fetch", side_effect=RuntimeError("Provider unavailable")):
            failed = self.client.post("/api/network/load", json={"latitude": 0, "longitude": 0})
        self.assertEqual(failed.status_code, 502)
        self.assertEqual(self.client.get("/api/network").json(), network)
        self.assertEqual(self.client.get("/api/routes").json(), [plan])

        self.assertEqual(self.client.put(f"/api/bins/{first['id']}", json={**bin_payload, "demand": 2}).json()["demand"], 2)
        self.assertEqual(self.client.get("/api/routes").json(), [])
        self.assertEqual(self.client.put(f"/api/trucks/{truck['id']}", json={"name": "Larger truck", "capacity": 4}).json()["capacity"], 4)
        moved = self.client.put("/api/depot", json={**depot, "latitude": 15.4908, "longitude": 73.8292})
        self.assertEqual(moved.json()["snapped_longitude"], 73.8292)
        self.assertEqual(self.client.put("/api/depot", json={**depot, "latitude": 21}).status_code, 422)
        self.assertEqual(self.client.delete(f"/api/bins/{first['id']}").status_code, 200)
        self.assertEqual(self.client.delete(f"/api/trucks/{truck['id']}").status_code, 200)
        self.assertEqual(self.client.post("/api/routes/optimize", json={"truck_ids": [truck["id"]]}).status_code, 404)
        self.assertEqual(self.client.post("/api/routes/optimize", json={"truck_ids": []}).status_code, 422)
        self.assertEqual(self.client.post("/api/bins", json={**bin_payload, "demand": 0}).status_code, 422)
        self.assertEqual(self.client.post("/api/trucks", json={"name": " ", "capacity": 1}).status_code, 422)
        self.assertEqual(self.client.post("/api/routes/optimize", json={"bin_ids": []}).json()["visited_bins"], 0)

    def test_concurrent_truck_creation_keeps_every_record(self):
        def add_truck(index):
            response = self.client.post("/api/trucks", json={"name": f"Truck {index}", "capacity": 1})
            self.assertEqual(response.status_code, 201, response.text)
            return response.json()["id"]

        with ThreadPoolExecutor(max_workers=8) as pool:
            ids = list(pool.map(add_truck, range(150)))
        self.assertEqual(len(set(ids)), 150)
        self.assertEqual(len(self.client.get("/api/trucks").json()), 150 + len(self.initial_trucks))
        last = max(ids)
        self.client.delete(f"/api/trucks/{last}")
        self.assertGreater(add_truck(151), last)

    def test_synthetic_benchmark_limits(self):
        for count in (10, 1000):
            response = self.client.post("/api/benchmarks/synthetic", json={"bin_count": count})
            self.assertEqual(response.status_code, 200, response.text)
            result = response.json()
            self.assertEqual(result["dataset"], "synthetic")
            self.assertEqual(result["visited_bins"], count)
            self.assertEqual(result["capacity_violations"], 0)
            self.assertGreaterEqual(result["total_distance_m"], result["postman_distance_m"])
