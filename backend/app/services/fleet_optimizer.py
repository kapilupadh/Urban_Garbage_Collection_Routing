import time
from typing import Dict, List, Tuple

from app.schemas import Bin, Truck, TruckRoute
from app.services.road_network import RoadNetworkService


def optimize_fleet(
    network: RoadNetworkService,
    depot_node: int,
    bins: Dict[int, Bin],
    trucks: Dict[int, Truck],
    selected_truck_ids: List[int],
    selected_bin_ids: List[int],
) -> Tuple[List[TruckRoute], List[int], float]:
    started = time.perf_counter()
    active_trucks = [trucks[item] for item in selected_truck_ids if item in trucks]
    if not active_trucks:
        raise ValueError("Select at least one valid truck")

    state = {
        truck.id: {
            "current": depot_node,
            "load": 0.0,
            "distance": 0.0,
            "sequence": [0],
            "names": ["Central Depot"],
            "geometry": [],
            "returns": 0,
            "trips": 1,
            "collected": 0.0,
        }
        for truck in active_trucks
    }
    remaining = set(selected_bin_ids)
    bin_nodes = {}
    for bin_id in selected_bin_ids:
        if bin_id not in bins:
            continue
        bin_nodes[bin_id] = network.snap(bins[bin_id].latitude, bins[bin_id].longitude)

    while remaining:
        candidates = []
        for truck in active_trucks:
            truck_state = state[truck.id]
            for bin_id in remaining:
                item = bins[bin_id]
                if item.demand <= truck.capacity - truck_state["load"]:
                    distance, _, _ = network.shortest(truck_state["current"], bin_nodes[bin_id])
                    candidates.append((distance, truck.id, bin_id))
        if not candidates:
            break
        _, truck_id, bin_id = min(candidates, key=lambda value: (value[0], value[1], value[2]))
        truck = trucks[truck_id]
        truck_state = state[truck_id]
        distance, _, geometry = network.shortest(truck_state["current"], bin_nodes[bin_id])
        truck_state["distance"] += distance
        truck_state["geometry"].extend(geometry if not truck_state["geometry"] else geometry[1:])
        truck_state["sequence"].append(bin_id)
        truck_state["names"].append(bins[bin_id].name)
        truck_state["current"] = bin_nodes[bin_id]
        truck_state["load"] += bins[bin_id].demand
        truck_state["collected"] += bins[bin_id].demand
        remaining.remove(bin_id)

        if not any(
            item in remaining and bins[item].demand <= truck.capacity - truck_state["load"]
            for item in remaining
        ):
            distance, _, geometry = network.shortest(truck_state["current"], depot_node)
            truck_state["distance"] += distance
            truck_state["geometry"].extend(geometry if not truck_state["geometry"] else geometry[1:])
            truck_state["sequence"].append(0)
            truck_state["names"].append("Central Depot")
            truck_state["current"] = depot_node
            truck_state["load"] = 0.0
            truck_state["returns"] += 1
            truck_state["trips"] += 1

    routes = []
    for truck in active_trucks:
        truck_state = state[truck.id]
        if truck_state["current"] != depot_node:
            distance, _, geometry = network.shortest(truck_state["current"], depot_node)
            truck_state["distance"] += distance
            truck_state["geometry"].extend(geometry if not truck_state["geometry"] else geometry[1:])
            truck_state["sequence"].append(0)
            truck_state["names"].append("Central Depot")
        routes.append(
            TruckRoute(
                truck_id=truck.id,
                truck_name=truck.name,
                sequence=truck_state["sequence"],
                stop_names=truck_state["names"],
                geometry=truck_state["geometry"],
                distance_m=truck_state["distance"],
                collected_demand=truck_state["collected"],
                capacity_utilization=truck_state["collected"] / (truck.capacity * truck_state["trips"]),
                depot_returns=truck_state["returns"],
                trips=truck_state["trips"],
            )
        )
    return routes, sorted(remaining), (time.perf_counter() - started) * 1000
