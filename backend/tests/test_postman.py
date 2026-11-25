from collections import Counter
from heapq import heappop, heappush
from itertools import count
import unittest

import networkx as nx

from app.algorithms.chinese_postman import chinese_postman
from app.schemas import Bin, Truck
from app.services.fleet_optimizer import optimize_fleet
from app.services.road_network import RoadNetwork, RoadNetworkService


class ChinesePostmanTests(unittest.TestCase):
    def test_six_node_demo_requires_315_m_of_repeated_road(self):
        edges = [
            (0, 1, 120), (0, 2, 200), (1, 2, 260), (1, 3, 150),
            (2, 3, 180), (2, 5, 245), (3, 4, 115), (3, 5, 165), (4, 5, 210),
        ]
        graph = nx.MultiGraph()
        graph.add_weighted_edges_from(edges, weight="length")
        walk = chinese_postman(graph, 0)
        traversals = Counter((min(start, end), max(start, end)) for start, end, _ in walk)
        self.assertEqual(set(traversals), {(start, end) for start, end, _ in edges})
        self.assertEqual(traversals[1, 3], 2)
        self.assertEqual(traversals[3, 5], 2)
        self.assertEqual(sum(graph[start][end][key]["length"] for start, end, key in walk), 1960)
        self.assertEqual(walk[0][0], 0)
        self.assertEqual(walk[-1][1], 0)

    def test_directed_flow_preserves_parallel_arcs_and_repeats_the_cheapest_return(self):
        graph = nx.MultiDiGraph()
        graph.add_edge(0, 1, key="first", length=2.1)
        graph.add_edge(0, 1, key="parallel", length=3)
        graph.add_edge(0, 1, key="third", length=4)
        graph.add_edge(1, 0, key="direct", length=7)
        graph.add_edge(1, 2, key="via", length=1.5)
        graph.add_edge(2, 0, key="return", length=1)
        walk = chinese_postman(graph, 0)
        self.assertEqual(Counter(walk), Counter(list(graph.edges(keys=True))) + Counter({
            (1, 2, "via"): 1, (2, 0, "return"): 1,
        }))
        self.assertEqual([start for start, _, _ in walk[1:]], [end for _, end, _ in walk[:-1]])

    def test_rejects_a_graph_with_no_closed_coverage(self):
        graph = nx.MultiDiGraph()
        graph.add_edge(0, 1, length=10)
        with self.assertRaises(ValueError):
            chinese_postman(graph, 0)

    def test_closed_walk_matches_exhaustive_edge_coverage_search(self):
        fixtures = [
            (nx.MultiGraph(), [(0, 1, 2), (0, 2, 6), (0, 3, 4), (0, 4, 3), (1, 2, 4), (1, 2, 2)]),
            (nx.MultiDiGraph(), [(0, 1, 1), (1, 2, 2), (2, 0, 3), (0, 1, 2), (2, 2, 0), (2, 1, 1)]),
        ]
        for graph, edges in fixtures:
            with self.subTest(directed=graph.is_directed()):
                for key, (start, end, length) in enumerate(edges):
                    graph.add_edge(start, end, key=key, length=length)
                route = chinese_postman(graph, 0)
                self.assertEqual({key for _, _, key in route}, set(range(len(edges))))
                self.assertEqual([start for start, _, _ in route], [0, *(end for _, end, _ in route[:-1])])
                self.assertEqual(route[-1][1], 0)
                self.assertEqual(sum(graph[a][b][key]["length"] for a, b, key in route), self.exhaustive_cost(graph))

    def test_rejects_invalid_lengths(self):
        for length in (-1, float("nan"), float("inf")):
            graph = nx.MultiGraph()
            graph.add_edge(0, 1, length=length)
            with self.assertRaisesRegex(ValueError, "invalid length"):
                chinese_postman(graph, 0)

    @staticmethod
    def exhaustive_cost(graph):
        order = count()
        heap = [(0, next(order), 0, 0)]
        visited = set()
        all_edges = (1 << graph.number_of_edges()) - 1
        while heap:
            cost, _, node, seen = heappop(heap)
            if node == 0 and seen == all_edges:
                return cost
            if (node, seen) in visited:
                continue
            visited.add((node, seen))
            for _, head, key, length in graph.edges(node, keys=True, data="length"):
                heappush(heap, (cost + length, next(order), head, seen | (1 << key)))
        raise AssertionError("Fixture has no closed tour")


class FleetTests(unittest.TestCase):
    def test_capacity_split_matches_an_exhaustive_breakpoint_search(self):
        graph = nx.MultiDiGraph()
        graph.add_weighted_edges_from([
            (0, 1, 1), (1, 2, 2), (2, 3, 5), (3, 4, 7), (4, 0, 3),
            (0, 3, 2), (3, 0, 2), (1, 4, 8), (4, 2, 1),
        ], weight="length")
        for node in graph:
            graph.nodes[node].update(y=0.0, x=float(node))
        service = RoadNetworkService()
        service.network = RoadNetwork(graph, (0, 0), 1000, 0)
        bins = {
            index: Bin(id=index, name=f"Bin {index}", latitude=0, longitude=node, demand=demand)
            for index, (node, demand) in enumerate([(1, 2), (2, 3), (2, 2), (3, 4), (4, 1), (4, 2)], 1)
        }
        capacity = 5
        trucks = {1: Truck(id=1, name="Truck", capacity=capacity)}
        routes, unassigned, _, _, _, postman_distance = optimize_fleet(service, 0, bins, trucks, [1], list(bins))

        nodes = [0, *(end for _, end, _ in chinese_postman(graph, 0))]
        stops = sorted((nodes.index(item.longitude), item.id, item.demand) for item in bins.values())
        options = []
        for mask in range(1 << (len(stops) - 1)):
            breaks = [index for index in range(1, len(stops)) if mask & (1 << (index - 1))]
            cuts = [0, *breaks, len(stops)]
            if any(sum(stop[2] for stop in stops[a:b]) > capacity for a, b in zip(cuts, cuts[1:])):
                continue
            extra = 0
            for index in breaks:
                extra += min(
                    nx.shortest_path_length(graph, 0, node, weight="length")
                    + nx.shortest_path_length(graph, node, 0, weight="length")
                    for node in nodes[stops[index - 1][0]:stops[index][0] + 1]
                )
            options.append((extra, len(cuts) - 1))
        self.assertFalse(unassigned)
        self.assertEqual((routes[0].distance_m - postman_distance, routes[0].trips), min(options))

    def test_capacity_trips_and_unassigned_bins_preserve_directed_road_coverage(self):
        graph = nx.MultiDiGraph()
        for node in range(5):
            graph.add_node(node, y=0.0, x=float(node))
        graph.add_weighted_edges_from([(0, 1, 1), (1, 2, 1), (2, 0, 1), (2, 3, 1)], weight="length")
        service = RoadNetworkService()
        service.network = RoadNetwork(graph, (0, 0), 1000, 0)
        bins = {
            1: Bin(id=1, name="First", latitude=0, longitude=1, demand=0.1),
            2: Bin(id=2, name="Shared node", latitude=0, longitude=1, demand=0.2),
            3: Bin(id=3, name="Second trip", latitude=0, longitude=2, demand=0.3),
            4: Bin(id=4, name="No return road", latitude=0, longitude=3, demand=0.1),
            5: Bin(id=5, name="Too heavy", latitude=0, longitude=2, demand=0.4),
        }
        trucks = {
            1: Truck(id=1, name="Truck 1", capacity=0.3),
            2: Truck(id=2, name="Truck 2", capacity=0.3),
        }

        routes, unassigned, _, covered, excluded, postman_distance = optimize_fleet(
            service, 0, bins, trucks, [1, 2, 1], [1, 2, 3, 4, 5, 1], "Test Depot",
        )
        self.assertEqual((covered, excluded, postman_distance), (3, 1, 3))
        self.assertEqual([route.sequence for route in routes], [[0, 1, 2, 0], [0, 3, 0]])
        self.assertEqual([route.capacity_utilization for route in routes], [1.0, 1.0])
        self.assertEqual(sum(route.distance_m for route in routes), 6)
        for route in routes:
            self.assertEqual(route.geometry, [[0, 0], [0, 1], [0, 2], [0, 0]])
            self.assertEqual(route.stop_names[0], "Test Depot")
        self.assertIn("round trip", unassigned[4])
        self.assertIn("capacity", unassigned[5])

        routes, unassigned, _, _, _, postman_distance = optimize_fleet(
            service, 0, {}, trucks, [1], [],
        )
        self.assertEqual(routes[0].sequence, [0, 0])
        self.assertEqual(routes[0].distance_m, postman_distance)
        self.assertFalse(unassigned)
