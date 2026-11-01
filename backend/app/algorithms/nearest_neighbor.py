from typing import Dict, List, Tuple


def choose_nearest(
    current: int,
    unvisited: List[int],
    distances: Dict[Tuple[int, int], float],
) -> int:
    """Choose the closest candidate, using node id as a deterministic tie-breaker."""
    return min(unvisited, key=lambda node: (distances[(current, node)], node))
