import { Bin, Depot, NetworkStatus, RoadEdge, Route, SearchResult, Truck } from "../types";

function apiOrigin() {
  if (typeof window !== "undefined" && window.location.pathname === "/demo") return "";
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiOrigin()}/api${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.detail === "string"
      ? body.detail
      : Array.isArray(body.detail) ? body.detail.map((issue: { msg: string }) => issue.msg).join(". ") : null;
    throw new Error(detail ?? `API request failed (HTTP ${response.status})`);
  }
  return response.json();
}

function write<T>(path: string, body: object, method = "POST") {
  return request<T>(path, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

export const api = {
  bins: () => request<Bin[]>("/bins"),
  trucks: () => request<Truck[]>("/trucks"),
  search: (query: string) => request<SearchResult[]>(`/locations/search?query=${encodeURIComponent(query)}`),
  network: () => request<NetworkStatus>("/network"),
  networkEdges: () => request<RoadEdge[]>("/network/edges"),
  depot: () => request<Depot>("/depot"),
  loadNetwork: (latitude: number, longitude: number, distance_m: number) =>
    write<NetworkStatus>("/network/load", { latitude, longitude, distance_m }),
  optimize: (truckIds: number[], binIds: number[]) =>
    write<Route>("/routes/optimize", { truck_ids: truckIds, bin_ids: binIds }),
  saveBin: (bin: Pick<Bin, "name" | "latitude" | "longitude" | "demand">, id?: number) =>
    id === undefined ? write<Bin>("/bins", bin) : write<Bin>(`/bins/${id}`, bin, "PUT"),
  saveTruck: (truck: Pick<Truck, "name" | "capacity">, id?: number) =>
    id === undefined ? write<Truck>("/trucks", truck) : write<Truck>(`/trucks/${id}`, truck, "PUT"),
  deleteBin: (id: number) => request(`/bins/${id}`, { method: "DELETE" }),
  deleteTruck: (id: number) => request(`/trucks/${id}`, { method: "DELETE" }),
  setDepot: (depot: Pick<Depot, "name" | "latitude" | "longitude">) => write<Depot>("/depot", depot, "PUT"),
};
