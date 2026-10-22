import asyncio
import bisect
import hashlib
import json
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from datetime import UTC, datetime, timedelta

import httpx
from django.core.cache import cache

from .geometry import haversine

PLAN_BUDGET_SECONDS = 75


class ProviderError(Exception):
    def __init__(self, message, code="PROVIDER_UNAVAILABLE", status=503):
        self.code, self.status = code, status
        super().__init__(message)


class Deadline:
    """One monotonic budget shared by routing, weather batches and result preparation."""

    def __init__(self, seconds=PLAN_BUDGET_SECONDS):
        self.end = time.monotonic() + seconds

    def remaining(self):
        remaining = self.end - time.monotonic()
        if remaining <= 0:
            raise ProviderError(
                "Planning exceeded its time limit. Please retry or choose a shorter trip.",
                "PLAN_TIMEOUT",
                504,
            )
        return remaining


def parallel_map(function, items, workers, deadline):
    # Do not let executor shutdown wait for queued/slow work after the request deadline.
    pool = ThreadPoolExecutor(max_workers=workers)
    futures = [pool.submit(function, item) for item in items]
    try:
        for future in futures:
            try:
                yield future.result(timeout=deadline.remaining())
            except FutureTimeout as exc:
                deadline.end = 0
                try:
                    deadline.remaining()
                except ProviderError as error:
                    raise error from exc
    finally:
        for future in futures:
            future.cancel()
        pool.shutdown(wait=False, cancel_futures=True)


def fetch_json(url, params, ttl=600, deadline=None):
    deadline = deadline or Deadline(18)
    deadline.remaining()
    key = hashlib.sha256((url + json.dumps(params, sort_keys=True)).encode()).hexdigest()
    cached = cache.get(key)
    if cached is not None:
        return cached

    async def download():
        # asyncio's timeout bounds the entire transfer, including a slow trickling body.
        async with asyncio.timeout(min(18, deadline.remaining())):
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(12, connect=4), follow_redirects=False
            ) as client:
                async with client.stream(
                    "GET",
                    url,
                    params=params,
                    headers={"User-Agent": "SpotterWeatherRouting/1.1 (coding-assessment)"},
                ) as response:
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        deadline.remaining()
                        body.extend(chunk)
                        if len(body) > 8 * 1024 * 1024:
                            raise ProviderError("The data provider returned an oversized response.")
                    data = json.loads(body)
                    # OSRM uses HTTP 400 for some normal route-unavailable outcomes.
                    if isinstance(data, dict) and data.get("code") in ("NoRoute", "NoSegment"):
                        raise ProviderError(
                            "No connected road route was found. Choose cities connected by road; changing the departure time will not fix this connection.",
                            "NO_ROUTE",
                            422,
                        )
                    response.raise_for_status()
                    return data

    try:
        data = asyncio.run(download())
    except (httpx.HTTPError, ValueError, TimeoutError) as exc:
        deadline.remaining()
        raise ProviderError(
            "A data provider is unavailable or rate limited. Please retry shortly, or explore the labelled demo."
        ) from exc
    deadline.remaining()
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


def _routes(coordinates, alternatives=2, deadline=None):
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
        deadline,
    )
    if data.get("code") != "Ok":
        raise ProviderError(
            "No connected road route was found for these locations.", "NO_ROUTE", 422
        )
    return data.get("routes", [])


def route_shape(route, cosine):
    """Approximate shared corridor cells and exact repeated-edge road distance."""
    coords = route["geometry"]["coordinates"]
    cells = {(round(lon * cosine / 0.01), round(lat / 0.01)) for lon, lat in coords}
    distances = [d for leg in route["legs"] for d in leg["annotation"]["distance"]]
    seen, repeated = set(), 0.0
    for (a, b), distance in zip(zip(coords, coords[1:], strict=False), distances, strict=True):
        edge = tuple(sorted((tuple(round(v, 6) for v in a), tuple(round(v, 6) for v in b))))
        if edge in seen:
            repeated += distance
        seen.add(edge)
    return cells, repeated / max(route["distance"], 1)


def get_routes(origin, destination, deadline=None):
    deadline = deadline or Deadline()
    start = [origin["longitude"], origin["latitude"]]
    end = [destination["longitude"], destination["latitude"]]
    if haversine(start, end) < 1000:
        raise ProviderError("Choose locations at least one kilometre apart.", "TRIP_TOO_SHORT", 422)
    native = _routes([start, end], deadline=deadline)
    if not native:
        raise ProviderError("No connected road route was found.", "NO_ROUTE", 422)
    routes, signatures = [], []
    cosine = max(0.2, math.cos(math.radians((start[1] + end[1]) / 2)))

    def accept(candidate, detour=False):
        deadline.remaining()
        cells, repeated = route_shape(candidate, cosine)
        # Preserve the primary route even on a road network that requires retracing.
        if routes and repeated > 0.05:
            return
        for previous, other in zip(routes, signatures, strict=True):
            overlap = len(cells & other) / max(1, min(len(cells), len(other)))
            distance_delta = (
                abs(candidate["distance"] - previous["distance"]) / previous["distance"]
            )
            if overlap > 0.95 and distance_delta < 0.05:
                return
        if detour and candidate["distance"] > native[0]["distance"] * 1.8:
            return
        routes.append(dict(candidate, via_detour=detour))
        signatures.append(cells)

    for candidate in native:
        accept(candidate)
        if len(routes) == 3:
            break
    if len(routes) < 3:
        dx, dy = (end[0] - start[0]) * cosine, end[1] - start[1]
        length = math.hypot(dx, dy)

        def via_route(via):
            try:
                return _routes([start, via, end], 0, deadline)
            except ProviderError as exc:
                if exc.code == "PLAN_TIMEOUT":
                    raise
                return []

        # Try smaller offsets near each third before wider midpoint detours.
        # At most eight candidates; stop once three distinct options are available.
        for fraction, ratio in ((0.33, 0.08), (0.66, 0.08), (0.5, 0.16), (0.5, 0.28)):
            offset = min(1.2, length * ratio)
            vias = [
                [
                    (
                        start[0]
                        + (end[0] - start[0]) * fraction
                        + sign * (-dy / length) * offset / cosine
                        + 180
                    )
                    % 360
                    - 180,
                    max(
                        -85,
                        min(
                            85,
                            start[1]
                            + (end[1] - start[1]) * fraction
                            + sign * (dx / length) * offset,
                        ),
                    ),
                ]
                for sign in (-1, 1)
            ]
            for candidates in parallel_map(via_route, vias, 2, deadline):
                for candidate in candidates:
                    if len(routes) < 3:
                        accept(candidate, detour=True)
            if len(routes) == 3:
                break
    return routes


def forecast_window(departure, latest):
    start = departure.replace(minute=0, second=0, microsecond=0)
    end = latest.replace(minute=0, second=0, microsecond=0)
    if end < latest:
        end += timedelta(hours=1)
    if end >= datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(
        days=16
    ):
        raise ProviderError(
            "The trip and 48-hour corridor extend beyond the provider's forecast horizon. Choose an earlier departure or shorter trip.",
            "FORECAST_RANGE",
            422,
        )
    return start.strftime("%Y-%m-%dT%H:%M"), end.strftime("%Y-%m-%dT%H:%M")


def get_weather(points, departure, latest, deadline=None):
    deadline = deadline or Deadline()
    start, end = forecast_window(departure, latest)

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
                "start_hour": start,
                "end_hour": end,
            },
            900,
            deadline,
        )

    chunks = [points[i : i + 24] for i in range(0, len(points), 24)]
    output = []
    for chunk, data in zip(chunks, parallel_map(batch, chunks, 3, deadline), strict=True):
        entries = data if isinstance(data, list) else [data]
        if len(entries) != len(chunk):
            raise ProviderError(
                "Weather provider returned incomplete locations.", "INCOMPLETE_FORECAST"
            )
        for entry in entries:
            hourly = entry.get("hourly", {})
            times = hourly.get("time", [])
            fields = ("wind_speed_10m", "rain", "showers", "snowfall", "temperature_2m")
            if (
                not times
                or any(len(hourly.get(field, [])) != len(times) for field in fields)
                or any(b <= a for a, b in zip(times, times[1:], strict=False))
            ):
                raise ProviderError(
                    "Weather provider returned incomplete hourly data.", "INCOMPLETE_FORECAST"
                )
            output.append(hourly)
    return output


def weather_at(hourly, when):
    """Conservative bracketing wind; precipitation uses its preceding-hour bucket."""
    timestamp = when.timestamp()
    times = hourly["time"]
    right = bisect.bisect_left(times, timestamp)
    if timestamp < times[0] or right >= len(times):
        raise ProviderError(
            "Forecast data does not cover the requested trip and 48-hour corridor. Choose an earlier departure or shorter trip.",
            "FORECAST_RANGE",
            422,
        )
    left = right if times[right] == timestamp else right - 1

    def value(field, index):
        result = hourly[field][index]
        if (
            isinstance(result, bool)
            or not isinstance(result, (int, float))
            or not math.isfinite(result)
            or (field != "temperature_2m" and result < 0)
        ):
            raise ProviderError(
                "Missing or invalid weather values; risk cannot be safely calculated.",
                "INCOMPLETE_FORECAST",
            )
        return result

    wind = max(value("wind_speed_10m", left), value("wind_speed_10m", right))
    rain, showers, snow_cm = (value(field, right) for field in ("rain", "showers", "snowfall"))
    fraction = (timestamp - times[left]) / (times[right] - times[left]) if left != right else 0
    temp = (
        value("temperature_2m", left) * (1 - fraction) + value("temperature_2m", right) * fraction
    )
    return {
        "wind_mph": wind,
        "rain_in_hr": (rain + showers) / 25.4,
        "snow_in_hr": snow_cm / 2.54,
        "temperature_f": temp,
        "forecast_time": datetime.fromtimestamp(times[right], UTC).isoformat(),
        "wind_window_start": datetime.fromtimestamp(times[left], UTC).isoformat(),
        "wind_window_end": datetime.fromtimestamp(times[right], UTC).isoformat(),
    }
