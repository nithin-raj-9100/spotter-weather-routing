import json
import math
from datetime import timedelta
from pathlib import Path

from . import providers
from .geometry import MILE_METERS, corridor_points, sample_route
from .risk import classify, rank_routes, summarize


def synthetic_weather(points, departure):
    """Explicit offline scenario only. Moving storm exercises risk/load/forecast UI."""
    start = int(departure.timestamp() // 3600) * 3600
    result = []
    for lon, lat in points:
        times = [start + i * 3600 for i in range(193)]
        values = {
            "time": times,
            "wind_speed_10m": [],
            "rain": [],
            "showers": [],
            "snowfall": [],
            "temperature_2m": [],
        }
        for i in range(len(times)):
            storm = math.exp(
                -(((lon - (-85.4 + i * 0.045)) / 0.65) ** 2) - ((lat - 41.95) / 0.48) ** 2
            )
            values["wind_speed_10m"].append(12 + 39 * storm)
            values["rain"].append(16 * storm)
            values["showers"].append(0)
            values["snowfall"].append(0)
            values["temperature_2m"].append(62 - 12 * storm)
        result.append(values)
    return result


def build_plan(payload, departure):
    demo = payload.get("mode") == "demo"
    load = payload["load_lb"]
    spacing = payload["spacing_miles"]
    if demo:
        raw = json.loads((Path(__file__).parent / "data/demo_routes.json").read_text())
        origin = {
            "name": "Chicago, Illinois, United States",
            "latitude": 41.8781,
            "longitude": -87.6298,
        }
        destination = {
            "name": "Detroit, Michigan, United States",
            "latitude": 42.3314,
            "longitude": -83.0458,
        }
    else:
        origin, destination = payload["origin"], payload["destination"]
        raw = providers.get_routes(origin, destination)
    checkpoints = [sample_route(r, spacing) for r in raw]
    if sum(map(len, checkpoints)) > 270:
        raise providers.ProviderError(
            "This trip needs too many checkpoints. Choose 25 or 50-mile spacing, or a shorter trip.",
            "TRIP_TOO_LONG",
            422,
        )
    corridor = corridor_points(raw)
    # Deduplicate overlapping route checkpoints, preserving exact lookup indices.
    unique, index = [], {}

    def point_index(point):
        key = tuple(round(x, 5) for x in point)
        if key not in index:
            index[key] = len(unique)
            unique.append(point)
        return index[key]

    checkpoint_indices = [[point_index(cp["coordinate"]) for cp in route] for route in checkpoints]
    corridor_indices = [point_index(p) for p in corridor]
    weather = (
        synthetic_weather(unique, departure) if demo else providers.get_weather(unique, departure)
    )
    routes = []
    for r_index, (raw_route, samples) in enumerate(zip(raw, checkpoints, strict=True)):
        for cp, w_index in zip(samples, checkpoint_indices[r_index], strict=True):
            eta = departure + timedelta(seconds=cp["elapsed_seconds"])
            cp["eta"] = eta.isoformat()
            cp["weather"] = providers.weather_at(weather[w_index], eta)
            w = cp["weather"]
            cp["risk"] = classify(w["wind_mph"], w["rain_in_hr"], w["snow_in_hr"], load)
        distance = raw_route["distance"] / MILE_METERS
        route = {
            "id": f"route-{r_index + 1}",
            "name": f"Route {r_index + 1}",
            "via_detour": raw_route.get("via_detour", False),
            "geometry": raw_route["geometry"],
            "distance_miles": distance,
            "duration_seconds": raw_route["duration"],
            "arrival": (departure + timedelta(seconds=raw_route["duration"])).isoformat(),
            "checkpoints": samples,
            "summary": summarize(samples, distance),
        }
        routes.append(route)
    routes, recommended = rank_routes(routes)
    # All 49 frames are computed once. Slider changes never trigger provider requests.
    frames = []
    for hour in range(49):
        when = departure + timedelta(hours=hour)
        frame = []
        for w_index in corridor_indices:
            w = providers.weather_at(weather[w_index], when)
            frame.append(
                {
                    "level": classify(w["wind_mph"], w["rain_in_hr"], w["snow_in_hr"], load)[
                        "level"
                    ],
                    "wind_mph": round(w["wind_mph"], 1),
                    "rain_in_hr": round(w["rain_in_hr"], 3),
                    "snow_in_hr": round(w["snow_in_hr"], 3),
                }
            )
        frames.append({"hour": hour, "time": when.isoformat(), "values": frame})
    warnings = [
        "Road routes and ETAs use a standard driving profile; vehicle height, axle limits, closures, traffic and driver rest breaks are not modelled."
    ]
    if demo:
        warnings.insert(
            0, "DEMO: recorded OSRM road routes with synthetic weather. Not a live forecast."
        )
    if len(routes) < 3:
        warnings.append(
            f"The routing provider found only {len(routes)} distinct road routes, including attempted waypoint detours. No alternatives were fabricated."
        )
    if not recommended:
        warnings.append(
            "All routes contain No Travel conditions. No route is recommended; delay departure or change your trip."
        )
    return {
        "mode": "demo" if demo else "live",
        "origin": origin,
        "destination": destination,
        "departure": departure.isoformat(),
        "load_lb": load,
        "spacing_miles": spacing,
        "routes": routes,
        "recommended_id": recommended,
        "warnings": warnings,
        "corridor": {"coordinates": corridor, "frames": frames},
        "sources": {
            "routing": "OSRM / OpenStreetMap",
            "weather": "Synthetic demo scenario" if demo else "Open-Meteo",
            "weather_sampling": "Hourly bucket ending at or after ETA; rain + showers converted mm → in; snow cm → in.",
        },
    }
