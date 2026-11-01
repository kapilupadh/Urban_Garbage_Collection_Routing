"use client";

import dynamic from "next/dynamic";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { BarChart3, Boxes, MapPinned, Plus, Search, Truck as TruckIcon } from "lucide-react";
import { api } from "../lib/api";
import { Bin, Depot, NetworkStatus, RoadEdge, Route, SearchResult, Truck } from "../types";

const RouteMap = dynamic(() => import("./RouteMap"), { ssr: false });

export default function Dashboard() {
  const [bins, setBins] = useState<Bin[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [selectedTrucks, setSelectedTrucks] = useState<number[]>([]);
  const [network, setNetwork] = useState<NetworkStatus>({ loaded: false, nodes: 0, edges: 0, source: "OpenStreetMap" });
  const [edges, setEdges] = useState<RoadEdge[]>([]);
  const [depot, setDepot] = useState<Depot>({ id: 0, name: "Central Depot", latitude: 19.0759, longitude: 72.8775 });
  const [route, setRoute] = useState<Route | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showBinForm, setShowBinForm] = useState(false);
  const [showTruckForm, setShowTruckForm] = useState(false);
  const [newBin, setNewBin] = useState({ name: "", demand: 1, latitude: 19.075, longitude: 72.878 });
  const [newTruck, setNewTruck] = useState({ name: "", capacity: 3000 });

  async function refresh() {
    try {
      const [loadedBins, loadedTrucks, loadedNetwork, loadedDepot] = await Promise.all([api.bins(), api.trucks(), api.network(), api.depot()]);
      setBins(loadedBins); setTrucks(loadedTrucks); setNetwork(loadedNetwork);
      setDepot(loadedDepot); setSelectedTrucks((current) => current.length ? current : loadedTrucks.map((truck) => truck.id));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load application data"); }
  }
  useEffect(() => { refresh(); }, []);

  async function search() {
    if (query.trim().length < 2) return;
    setError("");
    try { setResults(await api.search(query)); } catch (reason) { setError(reason instanceof Error ? reason.message : "Location search failed"); }
  }
  async function loadLocation(item: SearchResult) {
    setLoading(true); setError("");
    try { setNetwork(await api.loadNetwork(item.latitude, item.longitude, 5000)); setEdges(await api.networkEdges()); setResults([]); } catch (reason) { setError(reason instanceof Error ? reason.message : "Road network loading failed"); } finally { setLoading(false); }
  }
  async function optimize() {
    setLoading(true); setError("");
    try { setRoute(await api.optimize(selectedTrucks, bins.map((bin) => bin.id))); } catch (reason) { setError(reason instanceof Error ? reason.message : "Optimization failed"); } finally { setLoading(false); }
  }
  async function addBin(event: FormEvent) {
    event.preventDefault();
    try { const created = await api.createBin(newBin); setBins((current) => [...current, created]); setShowBinForm(false); setNewBin({ name: "", demand: 1, latitude: 19.075, longitude: 72.878 }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add bin"); }
  }
  async function addTruck(event: FormEvent) {
    event.preventDefault();
    try { const created = await api.createTruck(newTruck); setTrucks((current) => [...current, created]); setSelectedTrucks((current) => [...current, created.id]); setShowTruckForm(false); setNewTruck({ name: "", capacity: 3000 }); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add truck"); }
  }

  const metrics = useMemo(() => [
    { label: "Bins", value: bins.length, icon: Boxes },
    { label: "Fleet", value: trucks.length, icon: TruckIcon },
    { label: "Fleet distance", value: route ? `${Math.round(route.total_distance_m).toLocaleString()} m` : "—", icon: BarChart3 },
    { label: "Road graph", value: network.loaded ? `${network.nodes.toLocaleString()} nodes` : "Not loaded", icon: MapPinned },
  ], [bins.length, trucks.length, route, network]);

  return <main className="flex min-h-screen bg-slate-50">
    <aside className="hidden w-64 shrink-0 bg-slate-950 p-6 text-white md:block"><div className="mb-12 text-xl font-bold">Urban<span className="text-blue-400">Route</span></div><nav className="space-y-2 text-sm"><div className="rounded-lg bg-blue-600 px-4 py-3">Operations</div><div className="px-4 py-3 text-slate-400">Bins & fleet</div><div className="px-4 py-3 text-slate-400">Benchmarks</div></nav></aside>
    <section className="flex-1 p-5 md:p-10">
      <header className="mb-8"><p className="text-sm font-semibold text-blue-600">FLEET OPERATIONS</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Route control center</h1><p className="mt-2 text-sm text-slate-500">Build routes on actual OpenStreetMap drivable roads.</p></header>
      {error && <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{metrics.map(({ label, value, icon: Icon }) => <div key={label} className="rounded-2xl border border-slate-200 bg-white p-5"><Icon className="mb-5 text-blue-600" size={20} /><p className="text-sm text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>)}</div>
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex gap-3"><div className="relative flex-1"><Search className="absolute left-3 top-3 text-slate-400" size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && search()} placeholder="Search any city, address or operating region" className="w-full rounded-lg border border-slate-300 py-2.5 pl-10 pr-3" /></div><button onClick={search} className="rounded-lg bg-slate-900 px-5 font-semibold text-white">Search</button></div>{results.length > 0 && <div className="mt-3 divide-y rounded-lg border">{results.map((item) => <button key={`${item.latitude}-${item.longitude}`} onClick={() => loadLocation(item)} className="block w-full p-3 text-left text-sm hover:bg-slate-50">{item.display_name}</button>)}</div>}{network.loaded && <p className="mt-3 text-xs text-emerald-700">Live road network loaded from OpenStreetMap: {network.edges.toLocaleString()} directed edges.</p>}</div>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]"><div className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-5"><h2 className="font-bold">Road network and fleet routes</h2><p className="text-sm text-slate-500">{network.loaded ? "Gray lines are OSM roads; colors are actual routed geometry." : "Search and select a region to load drivable roads."}</p></div><RouteMap bins={bins} route={route} network={network} depot={depot} edges={edges} /></div>
        <div className="space-y-6"><div className="rounded-2xl border border-slate-200 bg-white p-6"><h2 className="font-bold">Optimize fleet</h2><p className="mt-1 text-sm text-slate-500">Heuristic assignment with capacity constraints.</p><div className="mt-5 space-y-2">{trucks.map((truck) => <label key={truck.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-3 text-sm"><span><input type="checkbox" checked={selectedTrucks.includes(truck.id)} onChange={(event) => setSelectedTrucks((current) => event.target.checked ? [...current, truck.id] : current.filter((id) => id !== truck.id))} className="mr-3" />{truck.name}</span><span className="text-slate-500">{truck.capacity} kg</span></label>)}</div><button onClick={optimize} disabled={loading || !network.loaded || !bins.length || !selectedTrucks.length} className="mt-5 w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{loading ? "Working..." : "Optimize routes"}</button>{route && <div className="mt-5 border-t pt-4 text-sm"><div className="flex justify-between"><span>Collected</span><strong>{route.visited_bins}/{bins.length} bins</strong></div><div className="mt-2 flex justify-between"><span>Execution</span><strong>{Math.round(route.execution_time_ms)} ms</strong></div>{route.unassigned_bin_ids.length > 0 && <p className="mt-3 text-red-600">Unassigned bins: {route.unassigned_bin_ids.join(", ")}</p>}</div>}</div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6"><div className="flex items-center justify-between"><h2 className="font-bold">Manage data</h2><div className="flex gap-2"><button onClick={() => setShowBinForm((value) => !value)} className="rounded-lg border p-2" title="Add bin"><Plus size={16} /></button><button onClick={() => setShowTruckForm((value) => !value)} className="rounded-lg border px-2 text-xs">Truck +</button></div></div>{showBinForm && <form onSubmit={addBin} className="mt-4 space-y-2"><input required placeholder="Bin name" value={newBin.name} onChange={(event) => setNewBin({ ...newBin, name: event.target.value })} className="w-full rounded border p-2" /><input required type="number" min="0.1" step="0.1" placeholder="Demand kg" value={newBin.demand} onChange={(event) => setNewBin({ ...newBin, demand: Number(event.target.value) })} className="w-full rounded border p-2" /><div className="grid grid-cols-2 gap-2"><input required type="number" step="any" placeholder="Latitude" value={newBin.latitude} onChange={(event) => setNewBin({ ...newBin, latitude: Number(event.target.value) })} className="rounded border p-2" /><input required type="number" step="any" placeholder="Longitude" value={newBin.longitude} onChange={(event) => setNewBin({ ...newBin, longitude: Number(event.target.value) })} className="rounded border p-2" /></div><button className="w-full rounded bg-slate-900 p-2 text-white">Add bin</button></form>}{showTruckForm && <form onSubmit={addTruck} className="mt-4 space-y-2"><input required placeholder="Truck name" value={newTruck.name} onChange={(event) => setNewTruck({ ...newTruck, name: event.target.value })} className="w-full rounded border p-2" /><input required type="number" min="1" placeholder="Capacity kg" value={newTruck.capacity} onChange={(event) => setNewTruck({ ...newTruck, capacity: Number(event.target.value) })} className="w-full rounded border p-2" /><button className="w-full rounded bg-slate-900 p-2 text-white">Add truck</button></form>}<p className="mt-4 text-sm text-slate-500">{bins.length} bins and {trucks.length} trucks configured.</p></div></div>
      </div>
      <p className="mt-6 text-xs text-slate-500">OpenStreetMap data is retrieved on demand. No illustrative road geometry is substituted when loading or routing fails.</p>
    </section>
  </main>;
}
