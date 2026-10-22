# Assignment decisions and correctness notes

## Risk table

| Condition | Low (0) | Moderate (1) | High (2) | Severe (3) | No Travel (4) |
| --- | --- | --- | --- | --- | --- |
| Wind, mph | <25 | 25–<35 | 35–<45 | 45–<55 | ≥55 |
| Rain, inches/hour | <0.10 | 0.10–<0.25 | 0.25–<0.50 | 0.50–1.00 | >1.00 |
| Snow, inches/hour | <0.5 | 0.5–<1.0 | 1.0–<2.0 | 2.0–3.0 | >3.0 |

The PDF overlaps rain at 0.25 and 0.50 and snow at 1.0 and 2.0. At those exact boundaries this implementation chooses the higher category, conservatively. Rain exactly 1.00 and snow exactly 3.0 remain Severe because No Travel is strictly `>` in the brief. Wind’s integer ranges are interpreted continuously: 34.9 is Moderate, 44.9 is High and 54.9 is Severe.

Wind/load overrides:

- ≥55 mph → No Travel for all loads.
- ≥45 and <55 mph, load **strictly >30,000 lb** → No Travel.
- ≥35 and <45 mph, load **strictly >40,000 lb** → Severe.

Overall checkpoint risk is the maximum of the three weather components after overrides. Heavy-load logic is implemented exactly as provided; it is not substituted with another vehicle model.

## Exposure and ranking

Checkpoint endpoints bound each road interval, including a short final interval. Each interval is assigned the **worse of its two endpoint risks**. This is conservative and avoids undercounting destination exposure. Every mile belongs to exactly one category, including No Travel; summed exposure equals route length. Average risk is distance-weighted on a 0–4 ordinal scale (a tie-breaker, not a probability).

A No Travel checkpoint makes the whole route ineligible, even if at an endpoint. Remaining routes are sorted lexicographically by Severe miles, High miles, average risk and travel time. Risk therefore outranks speed. Ranking rounds exposure to six decimal miles and average risk to nine decimal places to suppress floating-point noise in otherwise equal totals. If every route is blocked, recommendation is null and the UI instructs the user to delay or change the trip.

## Geometry and ETA

OSRM returns complete GeoJSON road geometry and distance/duration annotations for each segment. Distances accumulate along the road; checkpoint coordinates interpolate only within the containing segment. ETAs interpolate that segment’s travel time. Overall provider totals are authoritative; annotation totals are scaled to them to remove rounding drift. Via-route legs are concatenated without losing the shared endpoint. Origin and destination always appear once.

OSRM’s standard driving profile is **not a truck restriction engine**. Height/width/weight road restrictions, axle limits, closures, live traffic and driver rest breaks are outside this brief’s risk model and are explicitly disclosed. Load affects the supplied weather rules only. The app does not claim legal or operational truck clearance.

OSRM alternative routes are best effort. Native alternatives and generated waypoint detours both pass an approximate geometry-overlap filter: candidates sharing over 95% of the smaller corridor cell set with less than 5% distance difference are rejected. Alternative routes that retrace over 5% of their road distance are rejected; the primary route is preserved when the network itself requires retracing. These are heuristics, not a proof that corridors are disjoint.

When fewer than three remain, the app tries at most eight perpendicular-offset waypoints, starting near one-third and two-thirds of the trip before wider midpoint detours. Two candidates run concurrently; discovery stops at three accepted options. Detours are limited to 1.8× the primary route distance and labelled “via detour”. A road network may still have fewer distinct viable options; any shortfall is visible. No disconnected or fabricated road option is substituted.


## Forecast semantics and units

Open-Meteo requests UTC epoch timestamps, wind in mph, temperature in °F and precipitation in mm. Liquid rain is `rain + showers`, divided by 25.4 to get inches/hour. Native `snowfall` is centimetres of snow (not liquid equivalent), divided by 2.54. Rain and snow are preceding-hour accumulations: ETA selects the bucket ending at or immediately after ETA. An exact hourly timestamp uses that exact bucket.

Wind is instantaneous, not an hourly accumulation. Between timestamps, the app conservatively takes the **maximum of the two bracketing hourly wind values**; at an exact timestamp it uses that exact wind value. Thus a 55 mph value at 00:00 cannot disappear at 00:01 merely because the 01:00 value is calm. This is a documented conservative envelope, not an assertion that wind is constant during the hour. Popup metadata shows both bracketing timestamps. Temperature, which is not used for risk, is linearly interpolated between them.

Forecast requests use absolute `start_hour` and `end_hour` values. Start is departure rounded down; end is the later of the last route arrival or departure +48 hours, rounded **up** to an hour. Absolute timestamps are part of the cache key, so a cached response cannot silently shift its requested date range across UTC midnight. The provider's 16-day horizon is checked before fetching; actual coverage is checked again at every checkpoint/frame. Null, non-finite, negative, missing or out-of-range weather fails planning rather than becoming zero risk. The app never clamps an ETA to the last available hour.


## Corridor heatmap

Corridor samples use all returned routes at roughly 45-mile intervals, with offsets perpendicular to the local road bearing of roughly 12 miles per side. Points are snapped to an approximately 0.08° grid and deduplicated; at most 72 representative points are retained. This is a bounded illustrative corridor visualization, not continuous radar or a meteorological interpolation product. The true routing geometry remains full resolution.

Three nested translucent discs per weather point create a blended heatmap in a Leaflet canvas renderer, with small tooltip markers. All 49 hourly frames are computed on the backend in one response. Changing frame or metric only redraws local canvas layers. Route checkpoint markers and recommendation always remain based on ETA forecasts, not whichever global heatmap hour is selected.

## Resilience and resource limits

Planning shares one 75-second monotonic deadline across route discovery, forecast batches and result preparation. Each async HTTP transfer additionally has a total 18-second deadline including response-body transfer, plus connect/read inactivity limits. This prevents a slow trickling response from running indefinitely. Concurrent results wait only for the remaining planning budget; queued tasks are cancelled and executor shutdown does not delay an expired response. Running downloads cancel at their shared deadline. Expiry returns actionable HTTP 504 `PLAN_TIMEOUT`, before the Vercel 120-second cap. OSRM `NoRoute`/`NoSegment` JSON is preserved even when returned with HTTP 400, and maps to HTTP 422 `NO_ROUTE`. Weather is requested in batches of 24 coordinates with at most three concurrent requests. Overlapping checkpoint/corridor requests are deduplicated. Forecast cache TTL is 15 minutes, routes one hour, geocoding 24 hours. The cache is bounded to 1,500 entries and process-local. Trips requiring more than 270 route checkpoints are rejected with a message to widen spacing or shorten the trip.

The route endpoint accepts at most 16 KB and up to 12 requests per minute per connection identity per process. This is a demonstration guard; serverless instances do not share counters. An internet-scale deployment should use edge controls/shared storage and commercial provider capacity.

Demo road geometry was captured from OSRM on October 22, 2026. Demo weather is a deterministic moving-storm scenario anchored to the requested departure hour. It is always labelled synthetic and never substituted for failed live requests. It exercises actual risk/ETA/ranking code.
