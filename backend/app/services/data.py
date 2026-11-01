from typing import Dict

from app.schemas import Bin, Depot, Truck

BINS: Dict[int, Bin] = {}
TRUCKS: Dict[int, Truck] = {
    1: Truck(id=1, name="Truck 01", capacity=3000, status="Available"),
    2: Truck(id=2, name="Truck 02", capacity=3000, status="Available"),
}
DEPOT = Depot(
    name="Central Depot",
    latitude=19.0759,
    longitude=72.8775,
)
