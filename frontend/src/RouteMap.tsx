import { useEffect, useMemo, useState } from "react";
import L from "leaflet";
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Popup,
  Tooltip,
  useMap,
  Marker,
} from "react-leaflet";
import { LocateFixed, Layers3, Wind, CloudRain, Snowflake } from "lucide-react";
import type { Checkpoint, Plan, Route } from "./types";
import {
  RISK_COLORS,
  ROUTE_COLORS,
  RISK_LABELS,
  dateTime,
  number,
  duration,
} from "./lib";

function Fit({ routes, revision }: { routes: Route[]; revision: number }) {
  const map = useMap();
  useEffect(() => {
    if (routes.length)
      map.fitBounds(
        L.latLngBounds(
          routes.flatMap((r) =>
            r.geometry.coordinates.map(
              ([lng, lat]) => [lat, lng] as [number, number],
            ),
          ),
        ),
        { padding: [45, 45] },
      );
  }, [map, routes, revision]);
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}
function WeatherLayer({
  plan,
  hour,
  layer,
}: {
  plan: Plan;
  hour: number;
  layer: string;
}) {
  const map = useMap();
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), []);
  useEffect(() => {
    const group = L.layerGroup().addTo(map);
    const values = plan.corridor.frames[hour].values;
    plan.corridor.coordinates.forEach(([lng, lat], i) => {
      const w = values[i];
      const metric =
        layer === "wind"
          ? Math.min(1, w.wind_mph / 55)
          : layer === "rain"
            ? Math.min(1, w.rain_in_hr)
            : layer === "snow"
              ? Math.min(1, w.snow_in_hr / 3)
              : w.level / 4;
      // Nested translucent discs blend into a continuous, canvas-rendered corridor heatmap.
      const color =
        layer === "risk"
          ? RISK_COLORS[w.level]
          : metric > 0.7
            ? "#cc4947"
            : metric > 0.35
              ? "#e9ab48"
              : "#4b9c95";
      for (const [radius, opacity] of [
        [24000, 0.045],
        [16000, 0.075],
        [9000, 0.12],
      ] as const)
        L.circle([lat, lng], {
          renderer,
          radius,
          color,
          fillColor: color,
          stroke: false,
          fillOpacity: opacity,
        }).addTo(group);
      L.circleMarker([lat, lng], {
        renderer,
        radius: 3,
        color,
        weight: 0,
        fillOpacity: 0.8,
      })
        .bindTooltip(
          `${RISK_LABELS[w.level]} · Wind ${w.wind_mph} mph · Rain ${w.rain_in_hr.toFixed(2)} in/hr · Snow ${w.snow_in_hr.toFixed(2)} in/hr`,
        )
        .addTo(group);
    });
    return () => {
      group.remove();
    };
  }, [map, plan, hour, layer, renderer]);
  return null;
}
function PointPopup({ cp }: { cp: Checkpoint }) {
  return (
    <div className="point-popup">
      <strong>
        Mile {number(cp.mile, 1)} · {cp.risk.label}
      </strong>
      <p>ETA {dateTime(cp.eta)}</p>
      <p>
        <Wind size={13} /> {number(cp.weather.wind_mph, 1)} mph{" "}
        <CloudRain size={13} /> {number(cp.weather.rain_in_hr, 2)} in/hr
      </p>
      <p>
        <Snowflake size={13} /> {number(cp.weather.snow_in_hr, 2)} in/hr
      </p>
      <p>{cp.risk.reasons.join(" ")}</p>
      <small className="wind-window">
        Wind: higher hourly value between{" "}
        {dateTime(cp.weather.wind_window_start)} and{" "}
        {dateTime(cp.weather.wind_window_end)}.
      </small>
      <small>
        Precipitation hour ending: {dateTime(cp.weather.forecast_time)}
      </small>
    </div>
  );
}
const endpoint = (letter: string) =>
  L.divIcon({
    className: "endpoint-wrap",
    html: `<span class="endpoint">${letter}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
export default function RouteMap({
  plan,
  selected,
  onSelect,
  hour,
  heatmap,
  layer,
  onHeatmap,
  focusedCheckpoint,
}: {
  plan: Plan | null;
  selected: string | null;
  onSelect: (id: string) => void;
  hour: number;
  heatmap: boolean;
  layer: string;
  onHeatmap: () => void;
  focusedCheckpoint: Checkpoint | null;
}) {
  const [revision, setRevision] = useState(0);
  const [tileError, setTileError] = useState(false);
  const routes = plan?.routes || [];
  return (
    <div className="map-shell" aria-label="Interactive route and weather map">
      <MapContainer
        center={[42.1, -85.5]}
        zoom={7}
        scrollWheelZoom={false}
        preferCanvas
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{
            tileerror: () => setTileError(true),
            load: () => setTileError(false),
          }}
        />
        <Fit routes={routes} revision={revision} />
        <FocusCheckpoint point={focusedCheckpoint} />
        {plan && heatmap && (
          <WeatherLayer plan={plan} hour={hour} layer={layer} />
        )}
        {[...routes]
          .sort((a, b) => Number(a.id === selected) - Number(b.id === selected))
          .map((r) => (
            <Polyline
              key={r.id}
              positions={r.geometry.coordinates.map(([lng, lat]) => [lat, lng])}
              pathOptions={{
                color: ROUTE_COLORS[Number(r.id.slice(-1)) - 1],
                weight: r.id === selected ? 6 : 4,
                opacity: r.id === selected ? 1 : 0.55,
              }}
              eventHandlers={{ click: () => onSelect(r.id) }}
            >
              <Tooltip sticky>
                {r.name} · {number(r.distance_miles)} mi ·{" "}
                {duration(r.duration_seconds)}
                <br />
                ETA {dateTime(r.arrival)} · {RISK_LABELS[r.summary.max_risk]}
              </Tooltip>
            </Polyline>
          ))}
        {routes.flatMap((r) =>
          r.checkpoints.map((cp, i) => (
            <CircleMarker
              key={`${r.id}-${i}`}
              center={[cp.coordinate[1], cp.coordinate[0]]}
              radius={r.id === selected ? (cp.risk.level >= 3 ? 6 : 4) : 2.5}
              eventHandlers={{ click: () => onSelect(r.id) }}
              pathOptions={{
                color: "#fff",
                weight: 1.5,
                fillColor: RISK_COLORS[cp.risk.level],
                fillOpacity: r.id === selected ? 1 : 0.5,
              }}
            >
              <Popup>
                <PointPopup cp={cp} />
              </Popup>
              <Tooltip>
                Mile {number(cp.mile)} · {cp.risk.label}
              </Tooltip>
            </CircleMarker>
          )),
        )}
        {plan && (
          <>
            <Marker
              position={[plan.origin.latitude, plan.origin.longitude]}
              icon={endpoint("A")}
            >
              <Popup>{plan.origin.name}</Popup>
            </Marker>
            <Marker
              position={[plan.destination.latitude, plan.destination.longitude]}
              icon={endpoint("B")}
            >
              <Popup>{plan.destination.name}</Popup>
            </Marker>
          </>
        )}
        <MapZoom />
      </MapContainer>
      <div className="map-controls">
        <button
          onClick={() => setRevision((v) => v + 1)}
          aria-label="Fit all routes"
        >
          <LocateFixed size={17} />
        </button>
        <button
          onClick={onHeatmap}
          aria-label="Toggle weather heatmap"
          aria-pressed={heatmap}
          className={heatmap ? "enabled" : ""}
        >
          <Layers3 size={17} />
        </button>
      </div>
      <div className="map-label">
        <span className="live-dot" />
        {plan?.mode === "demo"
          ? "DEMO WEATHER"
          : plan
            ? "LIVE FORECAST"
            : "ROUTE EXPLORER"}
      </div>
      {tileError && (
        <div className="tile-error" role="status">
          Map tiles are unavailable. Routes and checkpoint details remain
          usable.
        </div>
      )}
      {!plan && (
        <div className="empty-map">
          <div className="empty-icon">
            <Wind size={25} />
          </div>
          <h2>A clearer road ahead.</h2>
          <p>
            Plan a trip to see routes, arrival-time weather
            <br />
            and the conditions between you and your destination.
          </p>
        </div>
      )}
      <div className="map-legend">
        {layer === "risk"
          ? RISK_LABELS.map((r, i) => (
              <span key={r}>
                <i style={{ background: RISK_COLORS[i] }} />
                {r}
              </span>
            ))
          : (layer === "wind"
              ? ["≤19.25 mph", "19.25–38.5", ">38.5 mph"]
              : layer === "rain"
                ? ["≤0.35 in/hr", "0.35–0.70", ">0.70 in/hr"]
                : ["≤1.05 in/hr", "1.05–2.10", ">2.10 in/hr"]
            ).map((label, i) => (
              <span key={label}>
                <i
                  style={{ background: ["#4b9c95", "#e9ab48", "#cc4947"][i] }}
                />
                {label}
              </span>
            ))}
      </div>
    </div>
  );
}
function MapZoom() {
  const map = useMap();
  return (
    <div className="zoom-controls">
      <button aria-label="Zoom in" onClick={() => map.zoomIn()}>
        +
      </button>
      <button aria-label="Zoom out" onClick={() => map.zoomOut()}>
        −
      </button>
    </div>
  );
}

function FocusCheckpoint({ point }: { point: Checkpoint | null }) {
  const map = useMap();
  useEffect(() => {
    if (point)
      map.setView(
        [point.coordinate[1], point.coordinate[0]],
        Math.max(map.getZoom(), 9),
      );
  }, [map, point]);
  if (!point) return null;
  return (
    <Popup position={[point.coordinate[1], point.coordinate[0]]}>
      <PointPopup cp={point} />
    </Popup>
  );
}
