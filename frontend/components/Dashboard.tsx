"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Bin, Depot, NetworkStatus, RoadEdge, Route, SearchResult, SessionSnapshot, Truck } from "../types";

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

const iconPaths = {
  route: "M6 5h10a3 3 0 0 1 0 6H8a4 4 0 1 0 0 8h9 M3 5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0 M17 19a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0",
  search: "M15.5 15.5 21 21 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0Z",
  map: "m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15",
  fleet: "M2 5h12v12H2V5Zm12 5h4l4 4v3h-8M7.5 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm12.5 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z",
  bin: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  pin: "M20 10c0 6-8 11-8 11s-8-5-8-11a8 8 0 0 1 16 0Zm-5.5 0a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z",
  plus: "M12 5v14m-7-7h14",
  chevron: "m9 6 6 6-6 6",
  check: "m5 12 4 4L19 6",
};

function Icon({ name }: { name: keyof typeof iconPaths }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]} /></svg>;
}

function TripDistanceChart({ trips, truckId }: { trips: Route["routes"][number]["trip_details"]; truckId: number }) {
  if (trips.length < 2) return null;

  const width = 320;
  const baseline = 72;
  const longestTrip = trips.reduce((longest, trip) => Math.max(longest, trip.distance_m), 1);
  const points = trips.map((trip, index) => ({
    x: 6 + index * (width - 12) / (trips.length - 1),
    y: baseline - 62 * trip.distance_m / longestTrip,
  }));
  const [first, ...rest] = points;
  const last = points[points.length - 1];
  const curve = rest.reduce((path, point, index) => {
    const previous = points[index];
    const midpoint = (previous.x + point.x) / 2;
    return `${path} C${midpoint},${previous.y} ${midpoint},${point.y} ${point.x},${point.y}`;
  }, `M${first.x},${first.y}`);
  const gradient = `trip-distance-fill-${truckId}`;

  return (
    <svg className="trip-chart" viewBox={`0 0 ${width} 80`} aria-hidden="true">
      <defs>
        <linearGradient id={gradient} x2="0" y2="100%">
          <stop offset="0" stopColor="currentColor" stopOpacity=".24" />
          <stop offset="1" stopColor="currentColor" stopOpacity=".02" />
        </linearGradient>
      </defs>
      <path className="trip-chart-fill" d={`${curve} V${baseline} H${first.x} Z`} fill={`url(#${gradient})`} />
      <path className="trip-chart-line" d={curve} pathLength="1" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle className="trip-chart-dot" cx={last.x} cy={last.y} r="3.5" fill="currentColor" />
    </svg>
  );
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
  const [connected, setConnected] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [binForm, setBinForm] = useState<BinForm | null>(null);
  const [truckForm, setTruckForm] = useState<TruckForm | null>(null);
  const [pick, setPick] = useState<PickMode>(null);
  const [replay, setReplay] = useState<{ truck: number; trip: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const mapPanel = useRef<HTMLElement>(null);
  const initialRequest = useRef<Promise<SessionSnapshot> | null>(null);

  const applySnapshot = useCallback((snapshot: SessionSnapshot) => {
    setBins(snapshot.bins);
    setTrucks(snapshot.trucks);
    setNetwork(snapshot.network);
    setDepot(snapshot.depot);
    setEdges(snapshot.road_edges);
    setRoute(snapshot.route);
  }, []);

  useEffect(() => {
    let active = true;
    const request = initialRequest.current ??= api.session();
    async function initialize() {
      try {
        const snapshot = await request;
        if (!active) return;
        applySnapshot(snapshot);
        setSelected(new Set(snapshot.trucks.map(({ id }) => id)));
        if (snapshot.network.distance_m) setRadius(snapshot.network.distance_m / 1000);
        setConnected(true);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Could not connect to the simulator");
      } finally {
        if (active) {
          initialRequest.current = null;
          setStatus("");
        }
      }
    }
    void initialize();
    return () => { active = false; };
  }, [applySnapshot, connectionAttempt]);

  function retryConnection() {
    setError("");
    setStatus("Connecting to the simulator…");
    setConnectionAttempt((attempt) => attempt + 1);
  }

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
    if (busy) return;
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
      await api.loadNetwork(point.latitude, point.longitude, radius * 1000);
      clearRoute();
      applySnapshot(await api.session());
      setRegion(name);
      setResults(null);
      setBinForm(null);
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

  const busy = Boolean(status) || !connected;
  const activeTruck = replay ? route?.routes.find((item) => item.truck_id === replay.truck) : undefined;
  const activeTrip = activeTruck && replay ? activeTruck.trip_details[replay.trip] : undefined;

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-rail">
        <div className="dashboard-brand "><span>Urban Garbage Collection Routing</span></div>
        <nav className="dashboard-nav" aria-label="Dashboard">
          <a href="#search-area"><Icon name="search" /><span>Search</span></a>
          <a href="#road-network"><Icon name="map" /><span>Road network</span></a>
          <a href="#fleet"><Icon name="fleet" /><span>Fleet</span></a>
          <a href="#bins"><Icon name="bin" /><span>Bins</span></a>
        </nav>
      </aside>

    <main className="dashboard">
      <header className="dashboard-heading enter">
        <h1>Garbage Collection Simulation</h1>
        <p>Plan and replay depot trips on OpenStreetMap with the directed Chinese Postman method.</p>
      </header>

      <div className="overview" aria-busy={!connected && Boolean(status)}>
        {([
          ["map", "Road network", network.edges],
          ["fleet", "Fleet", trucks.length],
          ["bin", "Bins", bins.length],
        ] as const).map(([icon, label, value]) => (
          <div className="overview-card enter" key={icon}>
            <span className="overview-icon"><Icon name={icon} /></span>
            <dl>
              <dt>{label}</dt>
              <dd>{!connected && status ? <span className="skeleton" aria-hidden="true" /> : (
                <span className={value < 1000 ? "metric-count" : "number-in"} key={value} style={{ "--count-target": value } as CSSProperties}>
                  <span className="metric-count-value">{value.toLocaleString()}</span>
                  {value < 1000 && <span className="metric-count-animation" aria-hidden="true" />}
                </span>
              )}</dd>
            </dl>
          </div>
        ))}
      </div>

      <section className="panel search-panel enter" id="search-area">
        <form onSubmit={search} className="search-form">
          <label>City, town or address
            <span className="search-field">
              <Icon name="search" />
              <input required minLength={2} maxLength={200} value={query} disabled={busy} onChange={(event) => { setQuery(event.target.value); setResults(null); }} placeholder="e.g. Panaji, Goa" />
            </span>
          </label>
          <label>Area half-width (km)
            <input required type="number" min="0.5" max="50" step="any" value={Number.isNaN(radius) ? "" : radius} disabled={busy} onChange={(event) => setRadius(event.target.valueAsNumber)} />
          </label>
          <button className="primary" disabled={busy}><Icon name="search" />Search</button>
          <button type="button" className="secondary" aria-pressed={pick === "area"} disabled={busy} onClick={() => setPick(pick === "area" ? null : "area")}><Icon name="pin" />Pick area on map</button>
        </form>
        {results && (results.length ? <ul className="search-results">
          {results.map((item, index) => <li key={index}><button className="search-result" disabled={busy} onClick={() => loadLocation(item, item.display_name)}><Icon name="pin" /><span>{item.display_name}</span><Icon name="chevron" /></button></li>)}
        </ul> : <p className="search-empty">No places found.</p>)}
        {network.loaded && <p className="network-meta"><span className="success-pill">{region && `${region} · `}{network.nodes.toLocaleString()} nodes</span> · {network.edges.toLocaleString()} directed road edges · {(network.distance_m ?? 0) / 1000} km half-width</p>}
      </section>

      {status && <p role="status" className="notice notice-status"><span className="status-spinner" aria-hidden="true" />{status}</p>}
      {error && <div className="notice notice-error">
        <p role="alert">{error}</p>
        {!connected && <button type="button" className="secondary" onClick={retryConnection}>Retry connection</button>}
      </div>}

      <div className="workbench">
        <div className="map-column">
          <section className="panel map-panel enter" id="road-network" ref={mapPanel}>
            <div className="section-header">
              <h2><Icon name="map" />Road network</h2>
              <button className="secondary" aria-pressed={pick === "depot"} disabled={busy || !network.loaded} onClick={() => setPick(pick === "depot" ? null : "depot")}><Icon name="pin" />Move depot</button>
            </div>
            <p className="map-help">
              {pick === "area" ? "Click the map to load roads around that point."
                : pick === "depot" ? "Click inside the loaded area to place the depot."
                : pick === "bin" ? "Click the map to set the bin coordinates."
                : "Gray lines show loaded roads. Colored lines show planned truck routes."}
            </p>
            {activeTruck && activeTrip && replay && <div className="replay-toolbar enter">
              <label>{activeTruck.truck_name} · trip {replay.trip + 1} · {Math.floor(progress)}%
                <input type="range" min="0" max="100" step="0.5" value={progress} style={{ "--replay-progress": `${progress}%` } as CSSProperties} onChange={(event) => { setPlaying(false); setProgress(event.target.valueAsNumber); }} />
              </label>
              <button className="secondary" onClick={() => { if (progress === 100) setProgress(0); setPlaying(!playing); }}>{playing ? "Pause" : "Play"}</button>
              <button className="secondary" onClick={() => { setPlaying(false); setReplay(null); }}>Close replay</button>
            </div>}
            <div className="map-frame"><RouteMap bins={bins} route={route} network={network} depot={depot} edges={edges} picking={Boolean(pick)} onPick={mapClick} activeTrip={activeTrip} progress={progress} /></div>
          </section>

          {route && <section className="panel results-panel enter">
            <div className="section-header"><h2><Icon name="route" />Route results</h2></div>
            <dl className="route-stats">
              <div><dt>Postman circuit</dt><dd><span className="number-in">{meters(route.postman_distance_m)}</span><span className="chart-track" aria-hidden="true"><span style={{ width: route.total_distance_m > 0 ? `${Math.min(100, 100 * route.postman_distance_m / route.total_distance_m)}%` : "0%" }} /></span></dd></div>
              <div><dt>Fleet distance</dt><dd><span className="number-in">{meters(route.total_distance_m)}</span><span className="chart-track" aria-hidden="true"><span style={{ width: route.total_distance_m > 0 ? "100%" : "0%" }} /></span></dd></div>
              <div><dt>Bins collected</dt><dd className="number-in">{route.visited_bins}/{bins.length} · {route.collected_demand.toLocaleString()} kg</dd></div>
              <div><dt>Road edges covered</dt><dd className="number-in">{route.covered_edges.toLocaleString()}</dd></div>
            </dl>
            {route.excluded_edges > 0 && <p className="result-note">{route.excluded_edges.toLocaleString()} directed edges are outside the depot’s round-trip network.</p>}
            {route.constraint_violations.length > 0 && <ul className="result-note result-issues">
              {route.constraint_violations.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>}
            <div className="trip-list">
              {route.routes.map((item) => <details className="trip-group" key={item.truck_id}>
                <summary className="trip-summary">{item.truck_name} · {item.trips} {item.trips === 1 ? "trip" : "trips"} · {meters(item.distance_m)}</summary>
                {item.trip_details.length > 1 && <TripDistanceChart trips={item.trip_details} truckId={item.truck_id} />}
                <ol className="trip-rows">
                  {item.trip_details.map((trip, index) => <li key={index} className="trip-row">
                    <div className="section-header">
                      <strong>Trip {index + 1} · {trip.collected_demand.toLocaleString()} kg · {meters(trip.distance_m)}</strong>
                      <button className="secondary" onClick={() => { setReplay({ truck: item.truck_id, trip: index }); setProgress(0); setPlaying(true); mapPanel.current?.scrollIntoView({ block: "start" }); }}>Replay trip {index + 1}</button>
                    </div>
                    <p className="trip-stops">{trip.stop_names.join(" → ")}</p>
                  </li>)}
                </ol>
              </details>)}
            </div>

          </section>}
        </div>

        <div className="operations-column">
          <section className="panel operations-panel enter" id="fleet">
            <div className="section-header"><h2><Icon name="fleet" />Fleet ({trucks.length})</h2>
              <button className="secondary" disabled={busy} onClick={() => setTruckForm({ name: "", capacity: 3000 })}><Icon name="plus" />New truck</button>
            </div>
            <ul className="record-list fleet-list">
              {trucks.map((truck) => <li key={truck.id} className="record-row">
                <label className="check-row">
                  <span className="fleet-check">
                  <input type="checkbox" checked={selected.has(truck.id)} disabled={busy} onChange={(event) => {
                    const updated = new Set(selected);
                    if (event.target.checked) updated.add(truck.id);
                    else updated.delete(truck.id);
                    setSelected(updated);
                    clearRoute();
                  }} />
                    <span className="fleet-check-mark"><Icon name="check" /></span>
                  </span>
                  <span className="record-name">{truck.name} · {truck.capacity.toLocaleString()} kg</span>
                </label>
                <button className="secondary" disabled={busy} aria-label={`Edit ${truck.name}`} onClick={() => setTruckForm(truck)}>Edit</button>
              </li>)}
            </ul>
            {truckForm && <form onSubmit={saveTruck} className="editor enter">
              <label>Truck name<input required maxLength={80} value={truckForm.name} onChange={(event) => setTruckForm({ ...truckForm, name: event.target.value })} /></label>
              <label>Capacity (kg)<input required type="number" min="0" step="any" value={Number.isNaN(truckForm.capacity) ? "" : truckForm.capacity} onChange={(event) => setTruckForm({ ...truckForm, capacity: event.target.valueAsNumber })} /></label>
              <div className="action-group">
                <button className="primary" disabled={busy || !(truckForm.capacity > 0)}>{truckForm.id === undefined ? "Add truck" : "Save truck"}</button>
                <button type="button" className="secondary" disabled={busy} onClick={() => setTruckForm(null)}>Cancel</button>
                {truckForm.id !== undefined && <button type="button" className="secondary" disabled={busy} onClick={() => {
                  const id = truckForm.id!;
                  void run("Removing truck…", async () => {
                    await api.deleteTruck(id);
                    setTrucks((items) => items.filter((item) => item.id !== id));
                    setSelected((items) => {
                      const updated = new Set(items);
                      updated.delete(id);
                      return updated;
                    });
                    setTruckForm(null);
                    clearRoute();
                  });
                }}>Remove truck</button>}
              </div>
            </form>}
            <button className="primary optimize-button" disabled={busy || !network.loaded || !selected.size} onClick={() => {
              void run("Computing the Chinese Postman circuit…", async () => {
                const result = await api.optimize(Array.from(selected), bins.map(({ id }) => id));
                clearRoute();
                setRoute(result);
              });
            }}><Icon name="route" />Optimize routes</button>
          </section>

          <section className="panel operations-panel enter" id="bins">
            <div className="section-header"><h2><Icon name="bin" />Bins ({bins.length})</h2></div>
            <div className="bin-actions">
              <button className="secondary" disabled={busy} onClick={() => newBin()}><Icon name="plus" />New bin</button>
              <button className="secondary" aria-pressed={pick === "bin"} disabled={busy} onClick={() => setPick(pick === "bin" ? null : "bin")}><Icon name="pin" />Pick bin on map</button>
            </div>
            {binForm && <form onSubmit={saveBin} className="editor enter">
              <label>Bin name<input required maxLength={80} value={binForm.name} onChange={(event) => setBinForm({ ...binForm, name: event.target.value })} /></label>
              <label>Demand (kg)<input required type="number" min="0" step="any" value={Number.isNaN(binForm.demand) ? "" : binForm.demand} onChange={(event) => setBinForm({ ...binForm, demand: event.target.valueAsNumber })} /></label>
              <div className="field-pair">
                <label>Latitude<input required type="number" min="-90" max="90" step="any" value={Number.isNaN(binForm.latitude) ? "" : binForm.latitude} onChange={(event) => setBinForm({ ...binForm, latitude: event.target.valueAsNumber })} /></label>
                <label>Longitude<input required type="number" min="-180" max="180" step="any" value={Number.isNaN(binForm.longitude) ? "" : binForm.longitude} onChange={(event) => setBinForm({ ...binForm, longitude: event.target.valueAsNumber })} /></label>
              </div>
              <div className="action-group">
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
            {connected && bins.length === 0 && !binForm && <div className="bin-empty" aria-hidden="true"><Icon name="bin" /></div>}
            <ul className="record-list bin-list">
              {bins.map((bin) => <li key={bin.id} className="record-row">
                <span className="record-name">{bin.name} · {bin.demand.toLocaleString()} kg</span>
                <button className="secondary" disabled={busy} aria-label={`Edit ${bin.name}`} onClick={() => setBinForm(bin)}>Edit</button>
              </li>)}
            </ul>
          </section>
        </div>
      </div>
    </main>
    </div>
  );
}
