"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import { CircleMarker, MapContainer, Marker, Popup, Polyline, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { Bin, Depot, NetworkStatus, RoadEdge, Route, RouteTrip } from "../types";

const colors = ["#1d4ed8", "#be123c", "#047857", "#b45309", "#6d28d9", "#0e7490"];
const depotIcon = L.divIcon({
  className: "route-marker route-marker-depot",
  html: "<span>◆</span>",
  iconSize: [30, 30],
  iconAnchor: [15, 15],
});
const truckIcon = L.divIcon({
  className: "route-marker route-marker-truck",
  html: "<span>▶</span>",
  iconSize: [25, 25],
  iconAnchor: [12, 12],
});
const roadStyle = { color: "#475569", weight: 2, opacity: 0.62, interactive: false };

type Point = [number, number];

function MapViewport({ edges, picking, onPick }: {
  edges: Point[][];
  picking: boolean;
  onPick: (point: { latitude: number; longitude: number }) => void;
}) {
  const map = useMap();
  useMapEvents({
    click(event) {
      if (!picking) return;
      const location = event.latlng.wrap();
      onPick({ latitude: location.lat, longitude: location.lng });
    },
  });
  useEffect(() => {
    if (edges.length) map.fitBounds(L.latLngBounds(edges.flat()), { padding: [22, 22], maxZoom: 17 });
  }, [edges, map]);
  useEffect(() => {
    map.getContainer().classList.toggle("map-picking", picking);
    if (picking) map.closePopup();
  }, [map, picking]);
  return null;
}

function ReplayMarker({ trip, progress }: { trip: RouteTrip; progress: number }) {
  const track = useMemo(() => {
    const points = (trip.geometry as Point[]).map(([lat, lon]) => L.latLng(lat, lon));
    const distance = [0];
    for (let i = 1; i < points.length; i++) {
      distance.push(distance[i - 1] + points[i - 1].distanceTo(points[i]));
    }
    return { points, distance };
  }, [trip]);
  const last = track.points.length - 1;
  if (last < 0) return null;
  const target = track.distance[last] * progress / 100;
  let left = 0;
  let right = last;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    if (track.distance[middle] < target) left = middle + 1;
    else right = middle;
  }
  let position = track.points[left];
  if (left > 0 && track.distance[left] > track.distance[left - 1]) {
    const start = track.points[left - 1];
    const fraction = (target - track.distance[left - 1]) / (track.distance[left] - track.distance[left - 1]);
    position = L.latLng(start.lat + fraction * (position.lat - start.lat), start.lng + fraction * (position.lng - start.lng));
  }
  return <Marker position={position} zIndexOffset={1000} interactive={false} icon={truckIcon} />;
}

export default function RouteMap({ bins, route, network, depot, edges, picking, onPick, activeTrip, progress }: {
  bins: Bin[];
  route: Route | null;
  network: NetworkStatus;
  depot: Depot;
  edges: RoadEdge[];
  picking: boolean;
  onPick: (point: { latitude: number; longitude: number }) => void;
  activeTrip: RouteTrip | undefined;
  progress: number;
}) {
  const center: Point = [network.center_latitude ?? depot.latitude, network.center_longitude ?? depot.longitude];
  const roads = useMemo(() => edges.map((edge) => edge.geometry as Point[]), [edges]);
  const depotPoint: Point = [depot.snapped_latitude ?? depot.latitude, depot.snapped_longitude ?? depot.longitude];
  return (
    <MapContainer center={center} zoom={13} preferCanvas className="route-map rounded-lg" aria-label="OpenStreetMap collection map">
      <TileLayer
        url={process.env.NEXT_PUBLIC_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png"}
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxNativeZoom={19}
      />
      <MapViewport edges={roads} picking={picking} onPick={onPick} />
      <Polyline positions={roads} pathOptions={roadStyle} />
      {route?.routes.map((item, index) => <Polyline key={item.truck_id} positions={item.geometry as Point[]} pathOptions={{ color: colors[index % colors.length], weight: 4, opacity: 0.8 }}>
        <Popup>{item.truck_name} · {item.trips} {item.trips === 1 ? "trip" : "trips"}</Popup>
      </Polyline>)}
      {activeTrip && <Polyline positions={activeTrip.geometry as Point[]} pathOptions={{ color: "#111827", weight: 6 }} />}
      <Marker icon={depotIcon} position={depotPoint}><Popup>{depot.name}</Popup></Marker>
      {bins.map((bin) => <CircleMarker key={bin.id} center={[bin.latitude, bin.longitude]} radius={6} pathOptions={{ color: "#fff", weight: 2, fillColor: "#1d4ed8", fillOpacity: 1 }}>
        <Popup><strong>{bin.name}</strong><br />{bin.demand.toLocaleString()} kg</Popup>
      </CircleMarker>)}
      {activeTrip && <ReplayMarker trip={activeTrip} progress={progress} />}
    </MapContainer>
  );
}
