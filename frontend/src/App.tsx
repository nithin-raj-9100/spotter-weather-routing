import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowDownUp,
  Navigation,
  Wind,
  CloudRain,
  Snowflake,
  Truck,
  Clock3,
  ArrowUpRight,
  Check,
  AlertTriangle,
  LoaderCircle,
  MapPin,
  ChevronDown,
  Play,
  Pause,
  Info,
  X,
  Download,
  Route as RouteIcon,
  ShieldCheck,
} from "lucide-react";
import PlaceInput from "./PlaceInput";
import type { Place, Plan, Route } from "./types";
import {
  api,
  dateTime,
  duration,
  localInput,
  number,
  RISK_LABELS,
  RISK_COLORS,
  ROUTE_COLORS,
} from "./lib";
const RouteMap = lazy(() => import("./RouteMap"));
const chicago: Place = {
  name: "Chicago, Illinois, United States",
  latitude: 41.8781,
  longitude: -87.6298,
};
const detroit: Place = {
  name: "Detroit, Michigan, United States",
  latitude: 42.3314,
  longitude: -83.0458,
};

function RiskBadge({ level }: { level: number }) {
  return (
    <span className={`risk-badge risk-${level}`}>
      <i />
      {RISK_LABELS[level]}
    </span>
  );
}
function RouteCard({
  route,
  plan,
  selected,
  onSelect,
}: {
  route: Route;
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
}) {
  const recommended = route.id === plan.recommended_id;
  const miles = route.summary.miles_by_risk;
  return (
    <button
      className={`route-card ${selected ? "selected" : ""}`}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Select ${route.name}`}
    >
      <div className="route-top">
        <span className="route-name">
          <i
            style={{ background: ROUTE_COLORS[Number(route.id.slice(-1)) - 1] }}
          />
          {route.name}
          {route.via_detour && <small>via detour</small>}
        </span>
        {recommended ? (
          <span className="recommend-tag">
            <ShieldCheck size={12} />
            Recommended
          </span>
        ) : route.summary.blocked ? (
          <span className="blocked-tag">No Travel</span>
        ) : (
          <span className="route-rank">#{route.rank} by risk</span>
        )}
      </div>
      <div className="route-metrics">
        <strong>{duration(route.duration_seconds)}</strong>
        <span>{number(route.distance_miles)} mi</span>
        <RiskBadge level={route.summary.max_risk} />
      </div>
      <p className="route-average">
        Avg risk {number(route.summary.average_risk, 2)} / 4 · Arrives{" "}
        {dateTime(route.arrival)}
      </p>
      <div className="risk-bar" aria-label="Distance by risk">
        {RISK_LABELS.map((label, i) => (
          <span
            key={label}
            style={{
              width: `${(miles[label] / route.distance_miles) * 100}%`,
              background: RISK_COLORS[i],
            }}
            title={`${label}: ${number(miles[label], 1)} mi`}
          />
        ))}
      </div>
      <div className="route-bottom">
        <span>
          {number(miles["Severe"], 1)} severe mi · {number(miles["High"], 1)}{" "}
          high mi
        </span>
        <span>
          {selected ? <Check size={14} /> : <ArrowUpRight size={14} />}
        </span>
      </div>
    </button>
  );
}
function Rules({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      className="rules-dialog"
      aria-labelledby="rules-title"
    >
      <div className="dialog-title">
        <h2 id="rules-title">How route risk works</h2>
        <button autoFocus onClick={onClose} aria-label="Close risk rules">
          <X size={20} />
        </button>
      </div>
      <p>
        Weather is checked at each checkpoint’s estimated arrival time. The
        highest of wind, rain and snow determines its risk.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Condition</th>
              {RISK_LABELS.map((r) => (
                <th key={r}>{r}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th>Wind · mph</th>
              <td>&lt;25</td>
              <td>25–&lt;35</td>
              <td>35–&lt;45</td>
              <td>45–&lt;55</td>
              <td>≥55</td>
            </tr>
            <tr>
              <th>Rain · in/hr</th>
              <td>&lt;0.10</td>
              <td>0.10–&lt;0.25</td>
              <td>0.25–&lt;0.50</td>
              <td>0.50–1.00</td>
              <td>&gt;1.00</td>
            </tr>
            <tr>
              <th>Snow · in/hr</th>
              <td>&lt;0.5</td>
              <td>0.5–&lt;1.0</td>
              <td>1.0–&lt;2.0</td>
              <td>2.0–3.0</td>
              <td>&gt;3.0</td>
            </tr>
          </tbody>
        </table>
      </div>
      <h3>Load changes the threshold</h3>
      <ul>
        <li>≥55 mph: No Travel for every load.</li>
        <li>45–54 mph and &gt;30,000 lb: No Travel.</li>
        <li>35–44 mph and &gt;40,000 lb: Severe.</li>
      </ul>
      <h3>Choosing a route</h3>
      <p>
        No Travel routes are excluded. Remaining routes are ranked by fewest
        Severe miles, then fewest High miles, lowest distance-weighted average
        risk, then shortest travel time. Each road interval takes the worse risk
        of its two checkpoint endpoints.
      </p>
      <p className="muted">
        Overlapping rain and snow boundaries in the brief use the higher
        category. Road ETAs exclude traffic and rest breaks. These are standard
        driving routes, without truck clearance or axle restrictions.
      </p>
      <button className="primary" onClick={onClose}>
        Got it <Check size={16} />
      </button>
    </dialog>
  );
}
export default function App() {
  const [origin, setOrigin] = useState<Place | null>(chicago);
  const [destination, setDestination] = useState<Place | null>(detroit);
  const [departure, setDeparture] = useState(() =>
    localInput(new Date(Date.now() + 3600000)),
  );
  const [load, setLoad] = useState("32000");
  const [spacing, setSpacing] = useState(25);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hour, setHour] = useState(0);
  const [heatmap, setHeatmap] = useState(true);
  const [layer, setLayer] = useState("risk");
  const [playing, setPlaying] = useState(false);
  const [rules, setRules] = useState(false);
  const [details, setDetails] = useState(true);
  const [phase, setPhase] = useState(0);
  const request = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!busy) return;
    setPhase(0);
    const t = setInterval(() => setPhase((p) => Math.min(3, p + 1)), 4500);
    return () => clearInterval(t);
  }, [busy]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setHour((h) => (h + 1) % 49), 650);
    return () => clearInterval(t);
  }, [playing]);
  const current = plan?.routes.find((r) => r.id === selected);
  const inputsChanged =
    plan &&
    (Number(load) !== plan.load_lb ||
      spacing !== plan.spacing_miles ||
      departure !== localInput(new Date(plan.departure)) ||
      origin?.latitude !== plan.origin.latitude ||
      origin?.longitude !== plan.origin.longitude ||
      destination?.latitude !== plan.destination.latitude ||
      destination?.longitude !== plan.destination.longitude);
  async function submit(mode: "live" | "demo") {
    if (busy) return;
    setError("");
    if (mode === "live" && (!origin || !destination)) {
      setError("Choose both cities from the search suggestions.");
      return;
    }
    const when = new Date(departure);
    if (!Number.isFinite(when.getTime())) {
      setError("Choose a valid departure date and time.");
      return;
    }
    if (
      load.trim() === "" ||
      !Number.isFinite(Number(load)) ||
      Number(load) < 0 ||
      Number(load) > 100000
    ) {
      setError("Enter a load between 0 and 100,000 lb.");
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setPlaying(false);
    try {
      const data = await api<Plan>("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          origin,
          destination,
          departure: when.toISOString(),
          load_lb: Number(load),
          spacing_miles: spacing,
        }),
        signal: controller.signal,
      });
      setPlan(data);
      setSelected(data.recommended_id || data.routes[0]?.id || null);
      setHour(0);
      if (mode === "demo") {
        setOrigin(chicago);
        setDestination(detroit);
      }
      setTimeout(
        () =>
          resultRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "nearest",
          }),
        80,
      );
    } catch (e) {
      if (e instanceof Error && e.name !== "AbortError") setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  function exportPlan() {
    if (!plan) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `wayfinder-${plan.mode}-trip.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <>
      <header className="app-header">
        <a href="/" className="brand" aria-label="Wayfinder home">
          <span className="brand-icon">
            <Navigation size={22} fill="currentColor" />
          </span>
          wayfinder
          <span className="brand-divider" />
          <small>FOR THE ROAD AHEAD</small>
        </a>
        <div className="header-right">
          <span className="weather-aware">
            <span className="live-dot" />
            Weather-aware routing
          </span>
          <button className="text-button" onClick={() => setRules(true)}>
            <Info size={15} />
            How it works
          </button>
        </div>
      </header>
      <main>
        <section className="page-intro">
          <div>
            <div className="eyebrow">A LITTLE FORESIGHT. A SAFER JOURNEY.</div>
            <h1>Know what’s down the road.</h1>
            <p>Three routes. Real weather. A better-informed way forward.</p>
          </div>
          <span className="intro-icon">
            <RouteIcon size={40} strokeWidth={1} />
          </span>
        </section>
        <div className="workspace">
          <aside className="planner">
            <div className="panel-heading">
              <span className="section-number">01</span>
              <h2>Plan your trip</h2>
              <Truck size={18} />
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit("live");
              }}
            >
              <div className="location-fields">
                <PlaceInput label="From" value={origin} onChange={setOrigin} />
                <button
                  type="button"
                  className="swap-button"
                  aria-label="Swap origin and destination"
                  onClick={() => {
                    setOrigin(destination);
                    setDestination(origin);
                  }}
                >
                  <ArrowDownUp size={14} />
                </button>
                <PlaceInput
                  label="To"
                  value={destination}
                  onChange={setDestination}
                />
              </div>
              <label htmlFor="departure">Departure</label>
              <div className="input-icon">
                <Clock3 size={15} />
                <input
                  id="departure"
                  type="datetime-local"
                  value={departure}
                  onChange={(e) => setDeparture(e.target.value)}
                  required
                  min={localInput(new Date())}
                  max={localInput(new Date(Date.now() + 5 * 86400000))}
                />
              </div>
              <small className="field-note">Your time zone · {timezone}</small>
              <label htmlFor="load">Load weight</label>
              <div className="input-icon">
                <Truck size={15} />
                <input
                  id="load"
                  inputMode="decimal"
                  type="number"
                  min="0"
                  max="100000"
                  step="1"
                  value={load}
                  onChange={(e) => setLoad(e.target.value)}
                  required
                />
                <span className="unit">lb</span>
              </div>
              <div className="spacing-label">
                <label id="spacing-label">Check weather every</label>
                <span>miles</span>
              </div>
              <div
                className="segmented"
                role="group"
                aria-labelledby="spacing-label"
              >
                {[10, 25, 50].map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={spacing === s}
                    className={spacing === s ? "active" : ""}
                    onClick={() => setSpacing(s)}
                  >
                    {s} mi
                  </button>
                ))}
              </div>
              <p className="field-note">
                Forecasts follow your ETA, not just your departure.
              </p>
              <button
                className="primary plan-button"
                disabled={busy}
                type="submit"
              >
                {busy ? (
                  <>
                    <LoaderCircle size={16} className="spin" />
                    Planning your trip…
                  </>
                ) : (
                  <>
                    Find the best route
                    <ArrowRight size={17} />
                  </>
                )}
              </button>
              <button
                className="demo-button"
                disabled={busy}
                type="button"
                onClick={() => void submit("demo")}
              >
                <Play size={13} />
                Explore a sample trip<span>DEMO</span>
              </button>
            </form>
            {error && (
              <div role="alert" className="error">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            )}
            <div className="planner-footer">
              <ShieldCheck size={19} />
              <p>
                <strong>Weather changes. Stay informed.</strong>
                <br />
                Compare conditions before you head out.
              </p>
            </div>
          </aside>
          <section className="map-panel">
            <Suspense
              fallback={
                <div className="map-loading">
                  <LoaderCircle className="spin" />
                  Loading map…
                </div>
              }
            >
              <RouteMap
                plan={plan}
                selected={selected}
                onSelect={setSelected}
                hour={hour}
                heatmap={heatmap}
                layer={layer}
                onHeatmap={() => setHeatmap((v) => !v)}
              />
            </Suspense>
            <div className="forecast-controls">
              <div className="forecast-top">
                <div>
                  <span className="forecast-icon">
                    <Wind size={18} />
                  </span>
                  <strong>Weather along the way</strong>
                  <span className="forecast-chip">
                    {plan?.mode === "demo"
                      ? "SIMULATED"
                      : plan
                        ? "FORECAST"
                        : "0–48 HRS"}
                  </span>
                </div>
                <select
                  aria-label="Heatmap weather layer"
                  value={layer}
                  onChange={(e) => setLayer(e.target.value)}
                >
                  <option value="risk">Combined risk</option>
                  <option value="wind">Wind speed</option>
                  <option value="rain">Rainfall</option>
                  <option value="snow">Snowfall</option>
                </select>
              </div>
              <div className="slider-row">
                <button
                  className="play-button"
                  disabled={!plan}
                  onClick={() => setPlaying((v) => !v)}
                  aria-label={playing ? "Pause forecast" : "Play forecast"}
                >
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <div className="slider-track">
                  <input
                    type="range"
                    min="0"
                    max="48"
                    step="1"
                    value={hour}
                    disabled={!plan}
                    aria-label="Forecast hour"
                    aria-valuetext={`${hour} hours after departure`}
                    onChange={(e) => {
                      setHour(Number(e.target.value));
                      setPlaying(false);
                    }}
                  />
                  <div className="slider-ticks">
                    <span>Departure</span>
                    <span>+12h</span>
                    <span>+24h</span>
                    <span>+36h</span>
                    <span>+48h</span>
                  </div>
                </div>
                <output className="hour-output">
                  +{hour}
                  <small>HRS</small>
                </output>
              </div>
              {plan && (
                <p className="forecast-time">
                  Corridor forecast ·{" "}
                  {dateTime(plan.corridor.frames[hour].time)} · Route checkpoint
                  risks remain tied to their ETAs.
                </p>
              )}
            </div>
          </section>
        </div>
        {busy && (
          <div className="progress-status" role="status" aria-live="polite">
            <LoaderCircle size={17} className="spin" />
            {
              [
                "Finding distinct road routes…",
                "Sampling checkpoints and arrival times…",
                "Fetching weather across your trip corridor…",
                "Evaluating risk and preparing your map…",
              ][phase]
            }
            <button
              onClick={() => {
                request.current?.abort();
                setBusy(false);
              }}
            >
              Cancel
            </button>
          </div>
        )}
        {plan ? (
          <section
            className="results"
            ref={resultRef}
            aria-label="Route comparison"
          >
            {inputsChanged && (
              <p className="stale-inputs" role="status">
                <Info size={14} />
                Trip inputs changed. Run the planner again to update these
                results.
              </p>
            )}
            <div className="results-heading">
              <div className="panel-heading">
                <span className="section-number">02</span>
                <h2>Your route options</h2>
                <span className={`mode-tag ${plan.mode}`}>
                  {plan.mode === "demo"
                    ? "DEMO · SYNTHETIC WEATHER"
                    : "LIVE DATA"}
                </span>
              </div>
              <button className="text-button" onClick={exportPlan}>
                <Download size={14} />
                Export trip
              </button>
            </div>
            <p className="results-description">
              {plan.origin.name.split(",")[0]} <ArrowRight size={13} />{" "}
              {plan.destination.name.split(",")[0]}
              <span>
                Depart {dateTime(plan.departure)} · {number(plan.load_lb)} lb ·
                every {plan.spacing_miles} mi
              </span>
            </p>
            <div className="route-grid">
              {plan.routes.map((r) => (
                <RouteCard
                  key={r.id}
                  route={r}
                  plan={plan}
                  selected={r.id === selected}
                  onSelect={() => setSelected(r.id)}
                />
              ))}
            </div>
            <div
              className={`recommendation ${!plan.recommended_id ? "unsafe" : ""}`}
            >
              <span>
                {plan.recommended_id ? (
                  <ShieldCheck size={20} />
                ) : (
                  <AlertTriangle size={20} />
                )}
              </span>
              <div>
                <strong>
                  {plan.recommended_id
                    ? `${plan.routes.find((r) => r.id === plan.recommended_id)?.name} is the best weather-aware option`
                    : "No route recommended — delay or change this trip"}
                </strong>
                <p>
                  {plan.recommended_id
                    ? "Ranked by fewest severe miles, then high miles, average risk and travel time."
                    : "Every route contains No Travel conditions for this load."}
                </p>
              </div>
              <button className="text-button" onClick={() => setRules(true)}>
                See the rules
                <ArrowUpRight size={14} />
              </button>
            </div>
            {current && (
              <div className="checkpoint-panel">
                <button
                  className="checkpoint-heading"
                  aria-expanded={details}
                  onClick={() => setDetails((v) => !v)}
                >
                  <span>
                    <MapPin size={16} />
                    {current.name} checkpoints
                    <small>
                      {current.checkpoints.length} weather checks · arrives{" "}
                      {dateTime(current.arrival)}
                    </small>
                  </span>
                  <ChevronDown
                    size={18}
                    style={{
                      transform: details ? "rotate(180deg)" : undefined,
                    }}
                  />
                </button>
                {details && (
                  <div className="table-scroll checkpoint-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Checkpoint</th>
                          <th>ETA · local time</th>
                          <th>
                            <Wind size={12} /> Wind
                          </th>
                          <th>
                            <CloudRain size={12} /> Rain
                          </th>
                          <th>
                            <Snowflake size={12} /> Snow
                          </th>
                          <th>Risk</th>
                          <th>Why</th>
                        </tr>
                      </thead>
                      <tbody>
                        {current.checkpoints.map((cp, i) => (
                          <tr key={i}>
                            <td>
                              <span
                                className="checkpoint-dot"
                                style={{
                                  background: RISK_COLORS[cp.risk.level],
                                }}
                              />
                              {i === 0
                                ? "Start"
                                : i === current.checkpoints.length - 1
                                  ? "Destination"
                                  : `Mile ${number(cp.mile, 1)}`}
                            </td>
                            <td>{dateTime(cp.eta)}</td>
                            <td>
                              {number(cp.weather.wind_mph, 1)}{" "}
                              <small>mph</small>
                            </td>
                            <td>
                              {number(cp.weather.rain_in_hr, 3)}{" "}
                              <small>in/hr</small>
                            </td>
                            <td>
                              {number(cp.weather.snow_in_hr, 3)}{" "}
                              <small>in/hr</small>
                            </td>
                            <td>
                              <RiskBadge level={cp.risk.level} />
                            </td>
                            <td className="reason-cell">
                              {cp.risk.reasons.join(" ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            <div className="notes">
              {plan.warnings.map((w, i) => (
                <p key={i}>
                  <Info size={13} />
                  {w}
                </p>
              ))}
            </div>
          </section>
        ) : (
          <section className="feature-row">
            <div>
              <span>01</span>
              <div>
                <strong>Routes with perspective</strong>
                <p>Compare up to three real road options.</p>
              </div>
            </div>
            <div>
              <span>02</span>
              <div>
                <strong>Weather when you arrive</strong>
                <p>Forecasts matched to each checkpoint’s ETA.</p>
              </div>
            </div>
            <div>
              <span>03</span>
              <div>
                <strong>Your load matters</strong>
                <p>Risk rules that account for what you carry.</p>
              </div>
            </div>
          </section>
        )}
        <footer className="page-footer">
          <span>Built for the road. Informed by the weather.</span>
          <span>
            Routing © OpenStreetMap · OSRM · Weather{" "}
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
              Open-Meteo
            </a>
            <button onClick={() => setRules(true)}>
              Assumptions & risk rules
            </button>
          </span>
        </footer>
      </main>
      {rules && <Rules onClose={() => setRules(false)} />}
    </>
  );
}
