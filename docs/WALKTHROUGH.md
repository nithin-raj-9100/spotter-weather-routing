# Loom walkthrough — approximately 7 minutes

Record the browser and optionally camera at a readable desktop resolution. Use the deployed app; keep the editor and a terminal ready. This is a script for the applicant, not an already-created Loom recording.

## 0:00–0:45 — Problem and stack

“I built Wayfinder with React and TypeScript on the frontend and Django on the backend. It compares real road routes using forecast weather at the time the driver reaches each checkpoint, and applies the exact load rules from the assignment. OSRM supplies routes; Open-Meteo supplies geocoding and weather.”

Show departure time zone, weight in lb and the 10/25/50-mile choices. Explain that no API keys are needed for this evaluation app.

## 0:45–1:45 — Live trip

Use default Chicago–Detroit or another nearby-city pair, departure an hour ahead, 32,000 lb, 25-mile spacing. Click Find the best route. Show three road routes and the provider label. Explain that native alternatives can be augmented by labelled real waypoint detours; the app does not fabricate routes.

Select different route cards. Show drive time, distance, risk breakdown, average score and arrival. Open a checkpoint popup and the table. Note the forecast bucket and ETA.

## 1:45–2:45 — Weather corridor

Move the slider from departure to +12h, +24h and +48h. Change wind, rain and snow layers, toggle the heatmap and press Play/Pause. Explain that these are precomputed frames, and the checkpoint forecast still follows ETA rather than the slider’s global hour. Pan/zoom the map and use Fit all routes.

## 2:45–3:45 — Demo and trade-offs

Click Explore a sample trip. Clearly identify “DEMO · SYNTHETIC WEATHER”. Select each route and compare severe/high miles. Explain that the deterministic moving storm helps reviewers inspect meaningful risk differences even when live conditions are calm.

Change load to 45,000 lb and spacing to 10 miles, then re-run the demo. Point out that the changed-input notice protects against mistaking old results for new inputs. Results may change with checkpoint spacing because this is a sampling model.

## 3:45–4:40 — Exact rules

Open How it works. Explain the threshold table and strict load comparisons. Describe the conservative interpretation of overlapping rain/snow boundaries. Explain that No Travel routes are excluded before ranking and no recommendation is returned if all routes are blocked.

Describe ranking: Severe miles first, then High miles, distance-weighted average risk, then time. It is intentionally lexicographic, so speed cannot compensate for more severe exposure.

## 4:40–5:45 — Code and correctness

Open `risk.py`, `geometry.py`, `providers.py`, and `service.py`.

- Pure risk logic separated from provider code.
- Road-distance sampling and segment-duration ETA interpolation.
- Liquid rain vs snow depth unit conversions.
- UTC handling and explicit coverage checks.
- Worst-endpoint interval aggregation, including the last interval.
- Batches, caching and deduplication.

Show the missing-weather error handling and the No Travel exclusion in the implementation.

## 5:45–6:30 — Verification

Show the successful production build and Django checks. Demonstrate route selection, forecast controls, mobile responsive layout and city keyboard navigation. Explain that test files are not required by the brief and were omitted at the applicant’s request.

## 6:30–7:00 — Limits and deliverables

Explain standard driving routes do not validate truck clearances, traffic or breaks. The corridor heatmap is sampled forecast visualization, not radar. Free external providers have rate limits; production capacity would use provisioned services and a shared cache. Show README, hosted URL and GitHub repository. Close with the core result: correct rules, transparent data and usable route comparison.

Upload to Loom and verify the sharing setting allows the recruiter to view without requesting access. Submit GitHub, hosted app and Loom links through the Teamtailor question indicated in the email. Do not claim an unpublished or local video is a Loom deliverable.
