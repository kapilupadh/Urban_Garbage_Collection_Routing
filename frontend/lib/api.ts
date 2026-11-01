import { Bin, Depot, NetworkStatus, RoadEdge, Route, SearchResult, Truck } from "../types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? "The API request failed");
  }
  return response.json();
}

export const api = {
  bins: () => request<Bin[]>("/api/bins"),
  trucks: () => request<Truck[]>("/api/trucks"),
  search: (query: string) => request<SearchResult[]>(`/api/locations/search?query=${encodeURIComponent(query)}`),
  network: () => request<NetworkStatus>("/api/network"),
  networkEdges: () => request<RoadEdge[]>("/api/network/edges"),
  depot: () => request<Depot>("/api/depot"),
  loadNetwork: (latitude: number, longitude: number, distance_m: number) =>
    request<NetworkStatus>("/api/network/load", { method: "POST", body: JSON.stringify({ latitude, longitude, distance_m }) }),
  optimize: (truckIds: number[], binIds: number[]) =>
    request<Route>("/api/routes/optimize", { method: "POST", body: JSON.stringify({ truck_ids: truckIds, bin_ids: binIds }) }),
  createBin: (bin: Omit<Bin, "id" | "status">) =>
    request<Bin>("/api/bins", { method: "POST", body: JSON.stringify(bin) }),
  createTruck: (truck: Omit<Truck, "id" | "status">) =>
    request<Truck>("/api/trucks", { method: "POST", body: JSON.stringify(truck) }),
};
