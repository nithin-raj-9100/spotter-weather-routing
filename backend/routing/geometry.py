"""Sampling along the actual road geometry, with OSRM segment travel times."""

import bisect
import math

MILE_METERS = 1609.344


def haversine(a, b):
    lng1, lat1, lng2, lat2 = map(math.radians, (*a, *b))
    q = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lng2 - lng1) / 2) ** 2
    )
    return 6371008.8 * 2 * math.asin(min(1, math.sqrt(q)))


def sample_route(route: dict, spacing: int) -> list[dict]:
    coords = route["geometry"]["coordinates"]
    distances = [v for leg in route["legs"] for v in leg["annotation"]["distance"]]
    durations = [v for leg in route["legs"] for v in leg["annotation"]["duration"]]
    if len(distances) != len(coords) - 1 or len(durations) != len(coords) - 1:
        raise ValueError("Routing provider returned mismatched segment annotations.")
    if any(not math.isfinite(v) or v < 0 for v in distances + durations):
        raise ValueError("Invalid road segment metrics.")
    cumulative_d, cumulative_t = [0.0], [0.0]
    for d, t in zip(distances, durations, strict=True):
        cumulative_d.append(cumulative_d[-1] + d)
        cumulative_t.append(cumulative_t[-1] + t)
    total = cumulative_d[-1]
    if total <= 0 or cumulative_t[-1] <= 0:
        raise ValueError("Route must have positive distance and duration.")
    # Route and annotation totals can differ by rounding. Scale to authoritative totals.
    scale_d = route["distance"] / total
    scale_t = route["duration"] / cumulative_t[-1]
    cumulative_d = [d * scale_d for d in cumulative_d]
    cumulative_t = [t * scale_t for t in cumulative_t]
    total = route["distance"]
    targets = [
        i * spacing * MILE_METERS for i in range(math.ceil(total / (spacing * MILE_METERS)))
    ] + [total]
    result = []
    for target in targets:
        # Keep endpoints exact even with zero-distance or zero-duration road segments.
        if target == 0 or target == total:
            result.append(
                {
                    "coordinate": list(coords[0] if target == 0 else coords[-1]),
                    "mile": target / MILE_METERS,
                    "elapsed_seconds": 0.0 if target == 0 else route["duration"],
                }
            )
            continue
        i = min(max(bisect.bisect_right(cumulative_d, target) - 1, 0), len(coords) - 2)
        width = cumulative_d[i + 1] - cumulative_d[i]
        fraction = (target - cumulative_d[i]) / width if width else 0
        result.append(
            {
                "coordinate": [
                    coords[i][j] + (coords[i + 1][j] - coords[i][j]) * fraction for j in (0, 1)
                ],
                "mile": target / MILE_METERS,
                "elapsed_seconds": cumulative_t[i]
                + (cumulative_t[i + 1] - cumulative_t[i]) * fraction,
            }
        )
    return result


def corridor_points(routes: list[dict]) -> list[list[float]]:
    """Bounded off-route grid: 3 lateral samples at ~45-mi road intervals, deduped."""
    points = {}
    for route in routes:
        samples = sample_route(route, 45)
        for i, cp in enumerate(samples):
            lon, lat = cp["coordinate"]
            before = samples[max(0, i - 1)]["coordinate"]
            after = samples[min(len(samples) - 1, i + 1)]["coordinate"]
            cosine = max(0.2, math.cos(math.radians(lat)))
            dx, dy = (after[0] - before[0]) * cosine, after[1] - before[1]
            length = math.hypot(dx, dy) or 1
            # Offset across the local road bearing, rather than along the road.
            for offset in (-0.18, 0, 0.18):
                x = lon + (-dy / length) * offset / cosine
                y = max(-85, min(85, lat + (dx / length) * offset))
                x = (x + 180) % 360 - 180
                key = (round(x / 0.08), round(y / 0.08))
                points.setdefault(key, [key[0] * 0.08, key[1] * 0.08])
    values = list(points.values())
    if len(values) > 72:
        values = [values[round(i * (len(values) - 1) / 71)] for i in range(72)]
    return values
