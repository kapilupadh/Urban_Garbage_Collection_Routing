"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, Marker, Popup, Polyline, TileLayer } from "react-leaflet";
import { Bin, Depot, NetworkStatus, RoadEdge, Route } from "../types";

const colors = ["#2563eb", "#e11d48", "#059669", "#d97706", "#7c3aed", "#0891b2"];

export default function RouteMap({ bins, route, network, depot, edges }: { bins: Bin[]; route: Route | null; network: NetworkStatus; depot: Depot; edges: RoadEdge[] }) {
  const center: [number, number] = [network.center_latitude ?? 19.0759, network.center_longitude ?? 72.8775];
  return (
    <MapContainer center={center} zoom={14} scrollWheelZoom className="h-full min-h-[520px] rounded-2xl">
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {edges.map((edge, index) => <Polyline key={index} positions={edge.geometry as [number, number][]} pathOptions={{ color: "#cbd5e1", weight: 2, opacity: 0.7 }} />)}
      <Marker position={[depot.latitude, depot.longitude]}><Popup><strong>{depot.name}</strong><br />Central collection depot</Popup></Marker>
      {bins.map((bin) => <Marker key={bin.id} position={[bin.latitude, bin.longitude]}><Popup><strong>{bin.name}</strong><br />Demand: {bin.demand}</Popup></Marker>)}
      {route?.routes.map((item, index) => <Polyline key={item.truck_id} positions={item.geometry as [number, number][]} pathOptions={{ color: colors[index % colors.length], weight: 5 }} />)}
    </MapContainer>
  );
}
