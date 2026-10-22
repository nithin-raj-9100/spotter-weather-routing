"""Pure assignment rules. All inputs are mph, liquid inches/hour, snow inches/hour."""

import math
from enum import IntEnum


class Risk(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4


LABELS = ["Low", "Moderate", "High", "Severe", "No Travel"]


def classify(wind: float, rain: float, snow: float, load: float) -> dict:
    if any(not math.isfinite(v) or v < 0 for v in (wind, rain, snow, load)):
        raise ValueError("Weather and load must be finite, nonnegative values.")
    # Wind table's integer ranges are interpreted as continuous half-open intervals.
    wind_risk = next((i for i, upper in enumerate((25, 35, 45, 55)) if wind < upper), 4)
    # Overlapping boundaries in the PDF use the higher category (conservative).
    rain_risk = (
        4 if rain > 1 else next((i for i, upper in enumerate((0.1, 0.25, 0.5)) if rain < upper), 3)
    )
    snow_risk = (
        4 if snow > 3 else next((i for i, upper in enumerate((0.5, 1, 2)) if snow < upper), 3)
    )
    reasons = []
    if wind >= 55:
        wind_risk = 4
        reasons.append("Wind ≥55 mph: no travel at any load.")
    elif wind >= 45 and load > 30000:
        wind_risk = 4
        reasons.append("Wind ≥45 mph with load >30,000 lb: no travel.")
    elif 35 <= wind < 45 and load > 40000:
        wind_risk = max(wind_risk, 3)
        reasons.append("Wind ≥35 mph with load >40,000 lb: severe.")
    components = {"wind": wind_risk, "rain": rain_risk, "snow": snow_risk}
    level = max(components.values())
    drivers = [name.capitalize() for name, value in components.items() if value == level]
    verb = "determines" if len(drivers) == 1 else "determine"
    names = drivers[0] if len(drivers) == 1 else f"{', '.join(drivers[:-1])} and {drivers[-1]}"
    explanation = (
        "All weather conditions are Low risk."
        if level == 0
        else f"{names} {verb} {LABELS[level]} risk."
    )
    reasons.insert(0, explanation)
    return {"level": level, "label": LABELS[level], "components": components, "reasons": reasons}


def summarize(checkpoints: list[dict], distance_miles: float) -> dict:
    """Each interval inherits the worse endpoint. Distances sum to the route length."""
    miles = [0.0] * 5
    segments = []
    for a, b in zip(checkpoints, checkpoints[1:], strict=False):
        length = b["mile"] - a["mile"]
        risk = max(a["risk"]["level"], b["risk"]["level"])
        miles[risk] += length
        segments.append({"from_mile": a["mile"], "to_mile": b["mile"], "level": risk})
    blocked = any(c["risk"]["level"] == Risk.NO_TRAVEL for c in checkpoints)
    return {
        "miles_by_risk": {LABELS[i]: value for i, value in enumerate(miles)},
        "average_risk": sum(i * m for i, m in enumerate(miles)) / distance_miles,
        "max_risk": max(c["risk"]["level"] for c in checkpoints),
        "blocked": blocked,
        "segments": segments,
    }


def rank_routes(routes: list[dict]) -> tuple[list[dict], str | None]:
    def key(route):
        s = route["summary"]
        # Suppress floating-point noise so equal exposure reaches the next tie-breaker.
        return (
            s["blocked"],
            round(s["miles_by_risk"]["Severe"], 6),
            round(s["miles_by_risk"]["High"], 6),
            round(s["average_risk"], 9),
            route["duration_seconds"],
        )

    ranked = sorted(routes, key=key)
    recommended = next((r["id"] for r in ranked if not r["summary"]["blocked"]), None)
    for i, route in enumerate(ranked):
        route["rank"] = i + 1
    return ranked, recommended
