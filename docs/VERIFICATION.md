# Verification record

The assignment does not require test files. All project test code, test-only dependencies and test commands were removed at the applicant’s explicit request. Verification is performed through static/build checks and direct API/browser interaction.

## Local verification — October 22, 2026

- `uv sync --frozen`: Python dependency installation with uv.
- `uv run ruff check backend api`: Python linting.
- `uv run ruff format --check backend api`: Python formatting.
- `uv run python backend/manage.py check`: Django configuration.
- `npm run build` in `frontend`: TypeScript checking and optimized production build.
- `npm audit --omit=dev` in `frontend`: production dependency audit.
- Live OSRM/Open-Meteo Chicago–Detroit request: three distinct routes (approximately 281.6, 298.8 and 329.2 miles), 56 corridor samples, completed in approximately 4.5 seconds.
- Browser city autocomplete: typed Austin without losing input; actual provider suggestions returned distinct cities.
- Browser offline demo: three route cards, synthetic weather label, ETA checkpoint details, risk-based recommendation and heatmap.

Hosted checks and remaining browser interactions are recorded below as they are completed.

## Hosted application

URL: https://spotter-weather-routing-eta.vercel.app

- Vercel built React and installed Python dependencies from `uv.lock`; production deployment reached `READY`.
- Unauthenticated `/api/health`: HTTP 200 JSON, HTTPS/HSTS, content-type and anti-framing headers.
- Live route planning through the hosted UI: three route cards with `LIVE DATA`, ETA checkpoint details and recommendation.
- Route 2 selection updated its selected state and checkpoint table.
- Forecast slider reached +48 hours; wind layer selection updated successfully.
- Rules dialog opened and closed using Escape.
- City autocomplete returned Austin results; ArrowDown/Enter selected Austin, and Swap exchanged the selected cities.
- Editing inputs displayed the changed-input notice while preserving the previously calculated trip summary.
- At 390-pixel viewport width, document scroll width remained 390 pixels; the wide checkpoint table scrolls inside its own container.
- Export trip downloaded `wayfinder-demo-trip.json` (approximately 1.3 MB).
- A malformed planning request returned HTTP 400 with an actionable `INVALID_REQUEST` error.
- Demo was exercised with 45,000 lb and 10-mile spacing, in addition to the default 32,000 lb / 25-mile run.
- Project source and lockfiles contain no pytest, Vitest or Playwright dependencies, configuration or test files.

Django’s optional deployment audit intentionally leaves HSTS subdomain/preload opt-ins unset: this app does not control arbitrary subdomains or register its evaluation hostname for browser preload. TLS, secure CSRF cookies, HTTPS redirection, anti-framing and MIME protections are enabled for Vercel. The normal Django system check reports no issues.

## Remaining applicant action

Record the 5–10-minute Loom walkthrough using `WALKTHROUGH.md`, then submit the repository, hosted URL and Loom link through the recruiter’s question. No email or application submission has been sent.
