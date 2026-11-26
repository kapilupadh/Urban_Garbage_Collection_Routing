import { Bin, Depot, NetworkStatus, Route, SearchResult, SessionSnapshot, Truck } from "../types";

const connectionError = "The simulator API is unavailable. Start the app with npm run dev, then retry.";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...init, cache: "no-store" });
  } catch {
    throw new Error(connectionError);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.detail === "string"
      ? body.detail
      : Array.isArray(body.detail) ? body.detail.map((issue: { msg: string }) => issue.msg).join(". ") : null;
    throw new Error(detail ?? (response.status >= 500 ? connectionError : `API request failed (HTTP ${response.status})`));
  }
  return response.json();
}

function write<T>(path: string, body: object, method = "POST") {
  return request<T>(path, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
}

function save<T>(path: string, body: object, id?: number) {
  return id === undefined ? write<T>(path, body) : write<T>(`${path}/${id}`, body, "PUT");
}

export const api = {
  session: () => request<SessionSnapshot>("/session"),
  search: (query: string) => request<SearchResult[]>(`/locations/search?query=${encodeURIComponent(query)}`),
  loadNetwork: (latitude: number, longitude: number, distance_m: number) =>
    write<NetworkStatus>("/network/load", { latitude, longitude, distance_m }),
  optimize: (truckIds: number[], binIds: number[]) =>
    write<Route>("/routes/optimize", { truck_ids: truckIds, bin_ids: binIds }),
  saveBin: (bin: Pick<Bin, "name" | "latitude" | "longitude" | "demand">, id?: number) =>
    save<Bin>("/bins", bin, id),
  saveTruck: (truck: Pick<Truck, "name" | "capacity">, id?: number) =>
    save<Truck>("/trucks", truck, id),
  deleteBin: (id: number) => request(`/bins/${id}`, { method: "DELETE" }),
  deleteTruck: (id: number) => request(`/trucks/${id}`, { method: "DELETE" }),
  setDepot: (depot: Pick<Depot, "name" | "latitude" | "longitude">) => write<Depot>("/depot", depot, "PUT"),
};
