import hashlib
import json
import logging
import math
import time
from datetime import UTC, datetime, timedelta
from functools import wraps

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import RequestDataTooBig
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST

from .providers import ProviderError, geocode
from .service import build_plan

logger = logging.getLogger(__name__)


def api_errors(view):
    @wraps(view)
    def wrapped(request):
        try:
            return view(request)
        except ProviderError as exc:
            return JsonResponse(
                {"error": {"code": exc.code, "message": str(exc)}}, status=exc.status
            )
        except RequestDataTooBig:
            return JsonResponse(
                {"error": {"code": "REQUEST_TOO_LARGE", "message": "Request body is too large."}},
                status=413,
            )
        except (ValueError, TypeError, KeyError, OverflowError) as exc:
            logger.info("Request or provider validation failed: %s", exc)
            return JsonResponse(
                {"error": {"code": "INVALID_REQUEST", "message": str(exc)}}, status=400
            )
        except Exception:
            logger.exception("Route planning failed")
            return JsonResponse(
                {
                    "error": {
                        "code": "INTERNAL_ERROR",
                        "message": "Planning failed unexpectedly. Please retry.",
                    }
                },
                status=500,
            )

    return wrapped


@require_GET
def health(request):
    return JsonResponse({"status": "ok", "version": "1.0.0", "time": datetime.now(UTC).isoformat()})


@require_GET
@api_errors
def places(request):
    q = request.GET.get("q", "").strip()
    if not 2 <= len(q) <= 100:
        raise ValueError("Enter a city name between 2 and 100 characters.")
    return JsonResponse({"places": geocode(q)})


def number(value, name, low, high):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not low <= value <= high
    ):
        raise ValueError(f"{name} must be a number between {low:,} and {high:,}.")
    return value


def validate(data, now):
    if not isinstance(data, dict):
        raise ValueError("Expected a JSON object.")
    if data.get("mode") not in ("live", "demo"):
        raise ValueError("Mode must be live or demo.")
    data["load_lb"] = number(data.get("load_lb"), "Load weight", 0, 100000)
    if isinstance(data.get("spacing_miles"), bool) or data.get("spacing_miles") not in (10, 25, 50):
        raise ValueError("Checkpoint spacing must be 10, 25 or 50 miles.")
    value = data.get("departure", "")
    if not isinstance(value, str):
        raise ValueError("Departure must be an ISO date/time with timezone.")
    try:
        departure = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Enter a valid departure date/time.") from exc
    if departure.tzinfo is None:
        raise ValueError("Departure must include a timezone offset.")
    departure = departure.astimezone(UTC)
    if departure < now - timedelta(minutes=5) or departure > now + timedelta(days=5):
        raise ValueError("Departure must be between now and five days from now.")
    if data["mode"] == "live":
        for name in ("origin", "destination"):
            place = data.get(name)
            if (
                not isinstance(place, dict)
                or not isinstance(place.get("name"), str)
                or not 1 <= len(place["name"]) <= 200
            ):
                raise ValueError(f"Select a valid {name} from the city suggestions.")
            number(place.get("latitude"), f"{name} latitude", -85, 85)
            number(place.get("longitude"), f"{name} longitude", -180, 180)
    return data, departure


# Anonymous, read-only computation: no cookies, sessions, credentials or stored mutations.
# JSON-only content plus no CORS prevents browser cross-origin form submissions.
@csrf_exempt
@require_POST
@api_errors
def plan(request):
    if request.content_type != "application/json":
        raise ValueError("Content-Type must be application/json.")
    data, departure = validate(json.loads(request.body), datetime.now(UTC))
    # Best-effort per-instance guard, bounded cache. No IP addresses are retained.
    identity = hashlib.sha256(request.META.get("REMOTE_ADDR", "anonymous").encode()).hexdigest()[
        :16
    ]
    key = f"plan-rate:{identity}:{int(time.time() // 60)}"
    if not cache.add(key, 1, 65):
        if cache.incr(key) > 12:
            return JsonResponse(
                {
                    "error": {
                        "code": "RATE_LIMITED",
                        "message": "Too many route requests. Please wait one minute.",
                    }
                },
                status=429,
            )
    return JsonResponse(build_plan(data, departure))


@require_GET
def frontend(request):
    path = settings.BASE_DIR / "frontend/dist/index.html"
    if path.exists():
        return HttpResponse(path.read_text(), content_type="text/html")
    return HttpResponse(
        "Frontend not built. Run npm ci && npm run build in frontend, or use the Vite development server.",
        status=503,
    )
