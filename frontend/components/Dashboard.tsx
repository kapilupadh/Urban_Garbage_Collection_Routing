"use client";

import dynamic from "next/dynamic";
import { FormEvent, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Bin, Depot, NetworkStatus, RoadEdge, Route, SearchResult, Truck } from "../types";

const RouteMap = dynamic(() => import("./RouteMap"), { ssr: false });
const emptyNetwork = { loaded: false, nodes: 0, edges: 0, source: "OpenStreetMap" };
const initialDepot = { id: 0, name: "Central Depot", latitude: 19.0759, longitude: 72.8775 };

type Point = { latitude: number; longitude: number };
type BinForm = Point & { id?: number; name: string; demand: number };
type TruckForm = { id?: number; name: string; capacity: number };
type PickMode = "area" | "bin" | "depot" | null;

function upsert<T extends { id: number }>(items: T[], item: T) {
  return items.some(({ id }) => id === item.id)
    ? items.map((previous) => previous.id === item.id ? item : previous)
    : [...items, item];
}

function meters(distance: number) {
  return `${Math.round(distance).toLocaleString()} m`;
}

export default function Dashboard() {
  const [bins, setBins] = useState<Bin[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [network, setNetwork] = useState<NetworkStatus>(emptyNetwork);
  const [edges, setEdges] = useState<RoadEdge[]>([]);
  const [depot, setDepot] = useState<Depot>(initialDepot);
  const [route, setRoute] = useState<Route | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [radius, setRadius] = useState(1);
  const [region, setRegion] = useState("");
  const [status, setStatus] = useState("Connecting to the simulator…");
  const [error, setError] = useState("");
  const [binForm, setBinForm] = useState<BinForm | null>(null);
  const [truckForm, setTruckForm] = useState<TruckForm | null>(null);
  const [pick, setPick] = useState<PickMode>(null);
  const [replay, setReplay] = useState<{ truck: number; trip: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const mapPanel = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const [loadedBins, loadedTrucks, loadedNetwork, loadedDepot] = await Promise.all([
          api.bins(), api.trucks(), api.network(), api.depot(),
        ]);
        const loadedEdges = loadedNetwork.loaded ? await api.networkEdges() : [];
        if (!active) return;
        setBins(loadedBins);
        setTrucks(loadedTrucks);
        setSelected(new Set(loadedTrucks.map(({ id }) => id)));
        setNetwork(loadedNetwork);
        setDepot(loadedDepot);
        setEdges(loadedEdges);
        if (loadedNetwork.distance_m) setRadius(loadedNetwork.distance_m / 1000);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Could not connect to the simulator");
      } finally {
        if (active) setStatus("");
      }
    }
    void initialize();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!playing) return;
    const clock = window.setInterval(() => setProgress((value) => Math.min(100, value + 0.5)), 80);
    return () => window.clearInterval(clock);
  }, [playing]);

  useEffect(() => {
    if (progress === 100) setPlaying(false);
  }, [progress]);

  function clearRoute() {
    setRoute(null);
    setReplay(null);
    setPlaying(false);
    setProgress(0);
  }

  async function run(message: string, action: () => Promise<void>) {
    setStatus(message);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The request failed");
    } finally {
      setStatus("");
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setResults(null);
    await run("Searching for places…", async () => setResults(await api.search(query.trim())));
  }

  async function loadLocation(point: Point, name: string) {
    if (!Number.isFinite(radius) || radius < 0.5 || radius > 50) {
      setError("Enter a road area size between 0.5 and 50 km.");
      return;
    }
    setPick(null);
    await run("Downloading OpenStreetMap roads…", async () => {
      const loaded = await api.loadNetwork(point.latitude, point.longitude, radius * 1000);
      clearRoute();
      setNetwork(loaded);
      setRegion(name);
      setEdges([]);
      setResults(null);
      setBinForm(null);
      setDepot({ ...depot, latitude: point.latitude, longitude: point.longitude, snapped_latitude: null, snapped_longitude: null });
      const [loadedDepot, loadedBins, loadedEdges] = await Promise.all([api.depot(), api.bins(), api.networkEdges()]);
      setDepot(loadedDepot);
      setBins(loadedBins);
      setEdges(loadedEdges);
    });
  }

  function newBin(point: Point = depot) {
    setBinForm({ name: "", demand: 1, latitude: point.latitude, longitude: point.longitude });
  }

  function mapClick(point: Point) {
    if (status || !pick) return;
    if (pick === "area") {
      void loadLocation(point, "Map selection");
    } else if (pick === "depot") {
      setPick(null);
      void run("Moving depot…", async () => {
        setDepot(await api.setDepot({ name: depot.name, ...point }));
        clearRoute();
      });
    } else {
      setPick(null);
      if (binForm) setBinForm({ ...binForm, ...point });
      else newBin(point);
    }
  }

  async function saveBin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!binForm) return;
    const { id, name, demand, latitude, longitude } = binForm;
    await run("Saving bin…", async () => {
      const bin = await api.saveBin({ name: name.trim(), demand, latitude, longitude }, id);
      setBins((items) => upsert(items, bin));
      setBinForm(null);
      setPick(null);
      clearRoute();
    });
  }

  async function saveTruck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!truckForm) return;
    const { id, name, capacity } = truckForm;
    await run("Saving truck…", async () => {
      const truck = await api.saveTruck({ name: name.trim(), capacity }, id);
      setTrucks((items) => upsert(items, truck));
      if (id === undefined) setSelected((items) => new Set(items).add(truck.id));
      setTruckForm(null);
      clearRoute();
    });
  }

  const busy = Boolean(status);
  const activeTruck = replay ? route?.routes.find((item) => item.truck_id === replay.truck) : undefined;
  const activeTrip = activeTruck && replay ? activeTruck.trip_details[replay.trip] : undefined;

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 md:px-8">
      <header className="border-b border-slate-200 pb-4">
        <h1 className="text-3xl font-bold tracking-tight">Waste collection simulator</h1>
        <p className="mt-1 text-sm text-slate-600">Plan and replay depot trips on OpenStreetMap with the directed Chinese Postman method.</p>
      </header>

      <section className="panel">
        <form onSubmit={search} className="flex flex-wrap items-end gap-3">
          <label className="min-w-[13rem] flex-1">City, town or address
            <input required minLength={2} maxLength={200} value={query} disabled={busy} onChange={(event) => { setQuery(event.target.value); setResults(null); }} placeholder="e.g. Panaji, Goa" />
          </label>
          <label className="w-40">Area half-width (km)
            <input required type="number" min="0.5" max="50" step="any" value={Number.isNaN(radius) ? "" : radius} disabled={busy} onChange={(event) => setRadius(event.target.valueAsNumber)} />
          </label>
          <button className="primary" disabled={busy}>Search</button>
          <button type="button" className="secondary" aria-pressed={pick === "area"} disabled={busy} onClick={() => setPick(pick === "area" ? null : "area")}>Pick area on map</button>
        </form>
        {results && (results.length ? <ul className="mt-3 divide-y rounded-lg border">
          {results.map((item, index) => <li key={index}><button className="w-full px-3 py-2 text-left hover:bg-slate-100" disabled={busy} onClick={() => loadLocation(item, item.display_name)}>{item.display_name}</button></li>)}
        </ul> : <p className="mt-3">No places found.</p>)}
        {network.loaded && <p className="mt-3 text-slate-600">{region && `${region} · `}{network.nodes.toLocaleString()} nodes · {network.edges.toLocaleString()} directed road edges · {(network.distance_m ?? 0) / 1000} km half-width</p>}
      </section>

      {status && <p role="status" className="rounded-lg bg-blue-50 px-4 py-3 text-blue-800">{status}</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-red-800">{error}</p>}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-5">
          <section className="panel" ref={mapPanel}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2>Road network</h2>
              <button className="secondary" aria-pressed={pick === "depot"} disabled={busy || !network.loaded} onClick={() => setPick(pick === "depot" ? null : "depot")}>Move depot</button>
            </div>
            <p className="mb-3 text-slate-600">
              {pick === "area" ? "Click the map to load roads around that point."
                : pick === "depot" ? "Click inside the loaded area to place the depot."
                : pick === "bin" ? "Click the map to set the bin coordinates."
                : "Gray lines show loaded roads. Colored lines show planned truck routes."}
            </p>
            {activeTruck && activeTrip && replay && <div className="mb-3 flex flex-wrap items-end gap-3 rounded-lg bg-blue-50 p-3">
              <label className="min-w-40 flex-1">{activeTruck.truck_name} · trip {replay.trip + 1} · {Math.floor(progress)}%
                <input type="range" min="0" max="100" step="0.5" value={progress} onChange={(event) => { setPlaying(false); setProgress(event.target.valueAsNumber); }} />
              </label>
              <button className="secondary" onClick={() => { if (progress === 100) setProgress(0); setPlaying(!playing); }}>{playing ? "Pause" : "Play"}</button>
              <button className="secondary" onClick={() => { setPlaying(false); setReplay(null); }}>Close replay</button>
            </div>}
            <RouteMap bins={bins} route={route} network={network} depot={depot} edges={edges} picking={Boolean(pick)} onPick={mapClick} activeTrip={activeTrip} progress={progress} />
          </section>

          {route && <section className="panel">
            <h2>Route results</h2>
            <dl className="my-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div><dt>Postman circuit</dt><dd>{meters(route.postman_distance_m)}</dd></div>
              <div><dt>Fleet distance</dt><dd>{meters(route.total_distance_m)}</dd></div>
              <div><dt>Bins collected</dt><dd>{route.visited_bins}/{bins.length} · {route.collected_demand.toLocaleString()} kg</dd></div>
              <div><dt>Road edges covered</dt><dd>{route.covered_edges.toLocaleString()}</dd></div>
            </dl>
            {route.excluded_edges > 0 && <p className="mb-2 text-amber-800">{route.excluded_edges.toLocaleString()} directed edges are outside the depot’s round-trip network.</p>}
            {route.constraint_violations.length > 0 && <ul className="mb-3 list-disc pl-4 text-amber-800">
              {route.constraint_violations.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>}
            <div className="space-y-2">
              {route.routes.map((item) => <details className="rounded-lg border p-3" key={item.truck_id}>
                <summary className="cursor-pointer font-semibold">{item.truck_name} · {item.trips} {item.trips === 1 ? "trip" : "trips"} · {meters(item.distance_m)}</summary>
                <ol className="mt-2 divide-y">
                  {item.trip_details.map((trip, index) => <li key={index} className="py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>Trip {index + 1} · {trip.collected_demand.toLocaleString()} kg · {meters(trip.distance_m)}</strong>
                      <button className="secondary" onClick={() => { setReplay({ truck: item.truck_id, trip: index }); setProgress(0); setPlaying(true); mapPanel.current?.scrollIntoView({ block: "start" }); }}>Replay trip {index + 1}</button>
                    </div>
                    <p className="mt-1 break-words text-slate-600">{trip.stop_names.join(" → ")}</p>
                  </li>)}
                </ol>
              </details>)}
            </div>

          </section>}
        </div>

        <div className="space-y-5">
          <section className="panel">
            <div className="flex items-center justify-between gap-2"><h2>Fleet ({trucks.length})</h2>
              <button className="secondary" disabled={busy} onClick={() => setTruckForm({ name: "", capacity: 3000 })}>New truck</button>
            </div>
            <ul className="my-3 max-h-72 divide-y overflow-y-auto">
              {trucks.map((truck) => <li key={truck.id} className="flex items-center justify-between gap-2 py-2">
                <label className="flex min-w-0 items-center gap-2">
                  <input type="checkbox" checked={selected.has(truck.id)} disabled={busy} onChange={(event) => {
                    const updated = new Set(selected);
                    if (event.target.checked) updated.add(truck.id);
                    else updated.delete(truck.id);
                    setSelected(updated);
                    clearRoute();
                  }} />
                  <span className="break-all">{truck.name} · {truck.capacity.toLocaleString()} kg</span>
                </label>
                <button className="secondary" disabled={busy} aria-label={`Edit ${truck.name}`} onClick={() => setTruckForm(truck)}>Edit</button>
              </li>)}
            </ul>
            {truckForm && <form onSubmit={saveTruck} className="mb-3 space-y-2 rounded-lg border p-3">
              <label>Truck name<input required maxLength={80} value={truckForm.name} onChange={(event) => setTruckForm({ ...truckForm, name: event.target.value })} /></label>
              <label>Capacity (kg)<input required type="number" min="0" step="any" value={Number.isNaN(truckForm.capacity) ? "" : truckForm.capacity} onChange={(event) => setTruckForm({ ...truckForm, capacity: event.target.valueAsNumber })} /></label>
              <div className="flex flex-wrap gap-2">
                <button className="primary" disabled={busy || !(truckForm.capacity > 0)}>{truckForm.id === undefined ? "Add truck" : "Save truck"}</button>
                <button type="button" className="secondary" disabled={busy} onClick={() => setTruckForm(null)}>Cancel</button>
                {truckForm.id !== undefined && <button type="button" className="secondary" disabled={busy} onClick={() => {
                  const id = truckForm.id!;
                  void run("Removing truck…", async () => {
                    await api.deleteTruck(id);
                    setTrucks((items) => items.filter((item) => item.id !== id));
                    setSelected((items) => new Set(Array.from(items).filter((item) => item !== id)));
                    setTruckForm(null);
                    clearRoute();
                  });
                }}>Remove truck</button>}
              </div>
            </form>}
            <button className="primary w-full" disabled={busy || !network.loaded || !selected.size} onClick={() => {
              void run("Computing the Chinese Postman circuit…", async () => {
                const result = await api.optimize(Array.from(selected), bins.map(({ id }) => id));
                clearRoute();
                setRoute(result);
              });
            }}>Optimize routes</button>
          </section>

          <section className="panel">
            <div className="flex flex-wrap items-center justify-between gap-2"><h2>Bins ({bins.length})</h2>
              <div className="flex gap-2">
                <button className="secondary" disabled={busy} onClick={() => newBin()}>New bin</button>
                <button className="secondary" aria-pressed={pick === "bin"} disabled={busy} onClick={() => setPick(pick === "bin" ? null : "bin")}>Pick bin on map</button>
              </div>
            </div>
            {binForm && <form onSubmit={saveBin} className="mt-3 space-y-2 rounded-lg border p-3">
              <label>Bin name<input required maxLength={80} value={binForm.name} onChange={(event) => setBinForm({ ...binForm, name: event.target.value })} /></label>
              <label>Demand (kg)<input required type="number" min="0" step="any" value={Number.isNaN(binForm.demand) ? "" : binForm.demand} onChange={(event) => setBinForm({ ...binForm, demand: event.target.valueAsNumber })} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label>Latitude<input required type="number" min="-90" max="90" step="any" value={Number.isNaN(binForm.latitude) ? "" : binForm.latitude} onChange={(event) => setBinForm({ ...binForm, latitude: event.target.valueAsNumber })} /></label>
                <label>Longitude<input required type="number" min="-180" max="180" step="any" value={Number.isNaN(binForm.longitude) ? "" : binForm.longitude} onChange={(event) => setBinForm({ ...binForm, longitude: event.target.valueAsNumber })} /></label>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="primary" disabled={busy || !(binForm.demand > 0)}>{binForm.id === undefined ? "Add bin" : "Save bin"}</button>
                <button type="button" className="secondary" disabled={busy} onClick={() => { setBinForm(null); setPick(null); }}>Cancel</button>
                {binForm.id !== undefined && <button type="button" className="secondary" disabled={busy} onClick={() => {
                  const id = binForm.id!;
                  void run("Removing bin…", async () => {
                    await api.deleteBin(id);
                    setBins((items) => items.filter((item) => item.id !== id));
                    setBinForm(null);
                    setPick(null);
                    clearRoute();
                  });
                }}>Remove bin</button>}
              </div>
            </form>}
            <ul className="mt-3 max-h-72 divide-y overflow-y-auto">
              {bins.map((bin) => <li key={bin.id} className="flex items-center justify-between gap-2 py-2">
                <span className="break-all">{bin.name} · {bin.demand.toLocaleString()} kg</span>
                <button className="secondary" disabled={busy} aria-label={`Edit ${bin.name}`} onClick={() => setBinForm(bin)}>Edit</button>
              </li>)}
            </ul>
          </section>
        </div>
      </div>
    </main>
  );
}
