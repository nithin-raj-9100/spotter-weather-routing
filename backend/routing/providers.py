import hashlib
import json
import math
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime

import httpx
from django.core.cache import cache

from .geometry import haversine


class ProviderError(Exception):
    def __init__(self, message, code="PROVIDER_UNAVAILABLE", status=503):
        self.code, self.status = code, status
        super().__init__(message)


def fetch_json(url, params, ttl=600):
    key = hashlib.sha256((url + json.dumps(params, sort_keys=True)).encode()).hexdigest()
    cached = cache.get(key)
    if cached is not None:
        return cached
    try:
        with httpx.Client(timeout=httpx.Timeout(18, connect=5), follow_redirects=False) as client:
            response = client.get(
                url,
                params=params,
                headers={"User-Agent": "SpotterWeatherRouting/1.0 (coding-assessment)"},
            )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise ProviderError(
            "A data provider is unavailable or rate limited. Please retry shortly, or explore the labelled demo."
        ) from exc
    cache.set(key, data, ttl)
    return data


def geocode(query):
    data = fetch_json(
        "https://geocoding-api.open-meteo.com/v1/search",
        {"name": query, "count": 6, "language": "en", "format": "json"},
        86400,
    )
    return [
        {
            "name": ", ".join(
                dict.fromkeys(filter(None, [p["name"], p.get("admin1"), p.get("country")]))
            ),
            "latitude": p["latitude"],
            "longitude": p["longitude"],
        }
        for p in data.get("results", [])
    ]


def _routes(coordinates, alternatives=2):
    url = os.getenv("OSRM_BASE_URL", "https://router.project-osrm.org").rstrip("/")
    coords = ";".join(f"{p[0]:.6f},{p[1]:.6f}" for p in coordinates)
    data = fetch_json(
        f"{url}/route/v1/driving/{coords}",
        {
            "alternatives": alternatives,
            "overview": "full",
            "geometries": "geojson",
            "annotations": "distance,duration",
            "steps": "false",
        },
        3600,
    )
    if data.get("code") != "Ok":
        raise ProviderError(
            "No connected road route was found for these locations.", "NO_ROUTE", 422
        )
    return data.get("routes", [])


def get_routes(origin, destination):
    start = [origin["longitude"], origin["latitude"]]
    end = [destination["longitude"], destination["latitude"]]
    if haversine(start, end) < 1000:
        raise ProviderError("Choose locations at least one kilometre apart.", "TRIP_TOO_SHORT", 422)
    routes = _routes([start, end])
    if not routes:
        raise ProviderError("No connected road route was found.", "NO_ROUTE", 422)

    # OSRM alternatives are best effort. Ask the same engine for real waypoint detours.
    # Never duplicate a route or draw a fabricated alternative to satisfy a count.
    def distinct(candidate):
        for r in routes:
            if (
                abs(candidate["distance"] - r["distance"]) / r["distance"] < 0.01
                and abs(candidate["duration"] - r["duration"]) / r["duration"] < 0.015
            ):
                return False
        return True

    if len(routes) < 3:
        dx, dy = end[0] - start[0], end[1] - start[1]
        length = math.hypot(dx, dy)
        offset = min(1.2, length * 0.16)
        vias = [
            [
                (start[0] + end[0]) / 2 + sign * (-dy / length) * offset,
                (start[1] + end[1]) / 2 + sign * (dx / length) * offset,
            ]
            for sign in (-1, 1)
        ]

        def via_route(via):
            try:
                return _routes([start, via, end], 0)
            except ProviderError:
                return []

        with ThreadPoolExecutor(max_workers=2) as executor:
            for candidates in executor.map(via_route, vias):
                for candidate in candidates:
                    if distinct(candidate) and candidate["distance"] <= routes[0]["distance"] * 1.8:
                        candidate["via_detour"] = True
                        routes.append(candidate)
    return routes[:3]


def get_weather(points, departure):
    """Batch multiple coordinates; units stay native until explicit conversion below."""

    def batch(chunk):
        return fetch_json(
            "https://api.open-meteo.com/v1/forecast",
            {
                "latitude": ",".join(f"{p[1]:.5f}" for p in chunk),
                "longitude": ",".join(f"{p[0]:.5f}" for p in chunk),
                "hourly": "wind_speed_10m,rain,showers,snowfall,temperature_2m",
                "wind_speed_unit": "mph",
                "temperature_unit": "fahrenheit",
                "precipitation_unit": "mm",
                "timezone": "GMT",
                "timeformat": "unixtime",
                "forecast_days": 8,
            },
            900,
        )

    chunks = [points[i : i + 24] for i in range(0, len(points), 24)]
    output = []
    with ThreadPoolExecutor(max_workers=3) as executor:
        for chunk, data in zip(chunks, executor.map(batch, chunks), strict=True):
            entries = data if isinstance(data, list) else [data]
            if len(entries) != len(chunk):
                raise ProviderError(
                    "Weather provider returned incomplete locations.", "INCOMPLETE_FORECAST"
                )
            for entry in entries:
                hourly = entry.get("hourly", {})
                times = hourly.get("time", [])
                fields = ("wind_speed_10m", "rain", "showers", "snowfall", "temperature_2m")
                if not times or any(len(hourly.get(field, [])) != len(times) for field in fields):
                    raise ProviderError(
                        "Weather provider returned incomplete hourly data.", "INCOMPLETE_FORECAST"
                    )
                output.append(hourly)
    return output


def weather_at(hourly, when):
    # Use the forecast bucket ending at or after ETA. Precipitation is preceding-hour total.
    import bisect

    timestamp = when.timestamp()
    times = hourly["time"]
    i = bisect.bisect_left(times, timestamp)
    if timestamp < times[0] or i >= len(times):
        raise ProviderError(
            "The trip extends outside the available forecast. Choose an earlier departure or shorter route.",
            "FORECAST_RANGE",
            422,
        )
    values = [
        hourly[field][i]
        for field in ("wind_speed_10m", "rain", "showers", "snowfall", "temperature_2m")
    ]
    if any(v is None or not isinstance(v, (int, float)) or not math.isfinite(v) for v in values):
        raise ProviderError(
            "Missing weather values at a checkpoint; risk cannot be safely calculated.",
            "INCOMPLETE_FORECAST",
        )
    wind, rain, showers, snow_cm, temp = values
    if min(wind, rain, showers, snow_cm) < 0:
        raise ProviderError(
            "Weather provider returned invalid negative values.", "INCOMPLETE_FORECAST"
        )
    return {
        "wind_mph": wind,
        "rain_in_hr": (rain + showers) / 25.4,
        "snow_in_hr": snow_cm / 2.54,
        "temperature_f": temp,
        "forecast_time": datetime.fromtimestamp(times[i], UTC).isoformat(),
    }
