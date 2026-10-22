# Wayfinder — weather-aware truck routing

React + TypeScript, Django, OSRM and Open-Meteo. Built for the Spotter AI Full Stack Developer assessment.

**Hosted application:** https://spotter-weather-routing-eta.vercel.app

**Source repository:** https://github.com/nithin-raj-9100/spotter-weather-routing

Compare road routes using the weather a driver is forecast to encounter **at each checkpoint’s ETA**, apply the supplied load rules, and explore a weather corridor across 48 hours. No API key or database is required for the evaluation deployment.

## Run locally with uv

Prerequisites: Python 3.12+, [uv](https://docs.astral.sh/uv/), Node 22+.

```bash
uv sync --frozen
uv run python backend/manage.py runserver 127.0.0.1:8000
```

In a second terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies `/api` to Django. Choose cities from the autocomplete, departure time, load in pounds, and 10/25/50-mile checkpoint spacing. The browser’s time zone is shown beside departure; requests and provider timestamps use UTC.

**Find the best route** requests real road routes and real forecasts. **Explore Chicago–Detroit demo** uses recorded Chicago–Detroit road routes and explicitly synthetic weather, with a moving storm and meaningful route trade-offs. Demo mode never silently replaces live data or makes provider requests. Map tiles and fonts still need internet; controls, route geometry and checkpoint tables work without tiles.

## What is implemented

- Three distinct OSRM road route options, including real waypoint detours when native alternatives return fewer than three. If the road network still yields fewer distinct viable alternatives, the UI explains that; geographically near-identical routes and substantial road retracing are filtered, and no imaginary roads are returned.
- Checkpoints at 10, 25 or 50 miles along the actual route, including origin and destination. Interpolated OSRM **segment travel times**, rather than constant average speed, determine arrival times.
- Open-Meteo hourly wind, rain, showers and snow forecasts. Rain includes showers; native millimetres are converted to liquid inches, and native snow centimetres to snowfall inches. Wind uses the higher bracketing hourly value between timestamps (the exact value at an exact timestamp); rain/snow use the preceding-hour bucket ending at or after arrival.
- All wind/rain/snow risk thresholds and load overrides; worst component wins. No Travel routes are excluded from recommendations. If all routes are blocked, none is recommended.
- Lexicographic ranking: fewest Severe miles → fewest High miles → lowest distance-weighted average risk → shortest time.
- Selectable map routes, risk-coloured checkpoints and popups, endpoint markers, route cards, distance-risk bars, average risk scores, ETAs and detailed checkpoint tables.
- Off-road corridor weather samples, canvas-rendered blended heatmap, risk/wind/rain/snow layers, toggle, playback, and a 0–48-hour slider. All 49 frames are returned once, so moving the slider makes no network requests. Heatmap time is independent of ETA-specific checkpoint risk.
- Keyboard-accessible city autocomplete and dialog, responsive mobile layout, loading/cancel/retry/error states, changed-input notices by the controls and map, explicit viewer timezones, keyboard checkpoint navigation, visible risk mileage breakdowns, trip JSON export, provider request timeouts, bounded batching and cache, and a best-effort request-rate guard.
- Build/lint verification and direct API/browser checks. GitHub Actions checks code style and the production build.

## Verify

```bash
uv run ruff check backend api
uv run ruff format --check backend api
uv run python backend/manage.py check
cd frontend
npm run build
```

Verify a running deployment with `curl https://your-app.vercel.app/api/health`, then exercise live planning, demo planning, route selection, heatmap controls and input validation in the browser.

To serve the production build locally through Django:

```bash
npm --prefix frontend run build
uv run python backend/manage.py collectstatic --noinput
uv run gunicorn --chdir backend config.wsgi:application --bind 127.0.0.1:8000
```

## Architecture

```text
React form → POST /api/plan → input validation
                           → OSRM road options + segment annotations
                           → distance sampling + checkpoint ETAs
                           → deduplicated checkpoint / corridor coordinates
                           → batched Open-Meteo hourly forecasts
                           → risk classification + distance aggregation
                           → blocked-route exclusion + lexicographic ranking
                           → routes, checkpoints and 49 corridor forecast frames
```

| File | Responsibility |
| --- | --- |
| `backend/routing/risk.py` | Pure risk rules, interval exposure and route ordering |
| `backend/routing/geometry.py` | Road geometry sampling and bounded corridor points |
| `backend/routing/providers.py` | HTTP adapters, caching, alternatives and weather-unit handling |
| `backend/routing/service.py` | Planning orchestration and explicit offline demo |
| `backend/routing/views.py` | Validation, HTTP methods, errors and response boundary |
| `frontend/src/App.tsx` | Planner, results, checkpoint table and forecast controls |
| `frontend/src/RouteMap.tsx` | Leaflet routes, checkpoints and canvas weather layers |
| `api/index.py` | Stateless Django WSGI entrypoint on Vercel |

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Application status, deployment revision and UTC clock |
| GET | `/api/places?q=Chicago` | City autocomplete (2–100 characters) |
| POST | `/api/plan` | Live or demo planning |

Request example (replace departure with an upcoming timezone-aware timestamp):

```json
{
  "mode": "live",
  "origin": {"name": "Chicago", "latitude": 41.8781, "longitude": -87.6298},
  "destination": {"name": "Detroit", "latitude": 42.3314, "longitude": -83.0458},
  "departure": "2026-10-23T10:00:00-05:00",
  "load_lb": 32000,
  "spacing_miles": 25
}
```

For demo mode, origin and destination are fixed to Chicago and Detroit and can be omitted. Departures must be within five days (five-minute past tolerance for request transit). Load: 0–100,000 lb. Locations: latitude ±85°, longitude ±180°. Errors use `{"error":{"code":"...","message":"..."}}` with 400 validation, 422 unavailable route/forecast range, 429 rate limit, 503 provider failure, or 504 planning deadline. Missing forecast data never becomes zero-risk weather.

## Deployment on Vercel

`vercel.json` builds React to `frontend/dist`, serves static files through the CDN and rewrites `/api/*` to the Python function. The WSGI entrypoint adds `backend` to the module path. Python dependencies are managed with **uv** (`pyproject.toml` + `uv.lock`); `requirements.txt` is a generated compatibility export:

```bash
uv export --no-dev --no-hashes --no-emit-project -o requirements.txt
vercel deploy --yes
vercel deploy --prod
```

There is no database, filesystem write dependency or session state. No migrations are needed. Caches and rate counters are in-memory per function instance and may be cold on each invocation. A shared 75-second monotonic planning deadline bounds routing, weather and result preparation, below the 120-second function cap. Async download deadlines bound the entire response transfer; queued work is cancelled when the planning deadline expires. Normal sample-trip live requests are much faster. Free public providers have rate limits and no SLA. For sustained production use, run a provisioned OSRM instance and use an appropriate Open-Meteo plan plus shared cache/rate limiting.

Optional environment variables:

| Variable | Default / purpose |
| --- | --- |
| `DJANGO_ALLOWED_HOSTS` | `localhost,127.0.0.1,.vercel.app`; comma-separated, override for a custom domain |
| `DJANGO_SECRET_KEY` | Ephemeral process key by default; set a stable private key before adding signed data/authentication |
| `APP_REVISION` | Optional commit SHA for CLI deployments; health otherwise uses Vercel Git metadata or `local` |
| `DJANGO_DEBUG` | `0`; opt in locally with `1` |
| `OSRM_BASE_URL` | `https://router.project-osrm.org`; use your own compatible routing host |

The application uses no cookies, accounts or stored state. The JSON-only anonymous planning endpoint is deliberately CSRF-exempt; other views retain Django CSRF middleware. No CORS access is enabled. HTTPS redirects and HSTS apply behind Vercel’s trusted TLS proxy; responses include anti-framing and content-type headers. Do not treat the per-instance rate guard as a distributed abuse-prevention system.

## Assumptions, limits and submission

See [docs/DECISIONS.md](docs/DECISIONS.md) for exact thresholds, edge cases, safety exclusions and provider semantics. See [docs/WALKTHROUGH.md](docs/WALKTHROUGH.md) for a 7-minute Loom recording script and [docs/VERIFICATION.md](docs/VERIFICATION.md) for the verification record. Test files are intentionally omitted: the brief does not require them, and the applicant requested their removal.

Deliverables are source repository, hosted application and a **5–10-minute Loom walkthrough**. A script is provided; the applicant must record and supply their Loom link. This repository does not submit the job application or claim a recording has been made.

Sources: [OSRM API](https://project-osrm.org/docs/v5.24.0/api/), [Open-Meteo forecast API](https://open-meteo.com/en/docs), [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api), [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [Vercel Python runtime](https://vercel.com/docs/functions/runtimes/python).
