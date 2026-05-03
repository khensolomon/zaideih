"""
Endpoints that the Cloudflare Worker calls into Django.

Currently just one:
  POST /api/internal/track/<id>/play/  — increment plays for a track

All requests are HMAC-verified via services.verify_worker_request.
"""

from __future__ import annotations

import logging

from django.db.models import F
from django.http import HttpResponseForbidden, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from . import services

# Replace with the actual location of your Track model.
from api.models import Track

logger = logging.getLogger(__name__)


@csrf_exempt  # The Worker is not a browser and cannot send a CSRF token.
@require_POST
def track_play(request, track_id: int):
    """
    Atomically increment the play counter for a track.

    Called by the Worker on initial-play requests. The Worker doesn't
    block on the response, so we keep this fast: one UPDATE, return
    the new count.
    """
    if not services.verify_worker_request(request):
        return HttpResponseForbidden("Forbidden")

    # Atomic increment. F-expression avoids race conditions if many
    # plays happen at once for the same track.
    updated = Track.objects.filter(id=track_id).update(plays=F("plays") + 1)

    if not updated:
        return JsonResponse({"error": "not found"}, status=404)

    # Re-read the new count to return it. Tiny extra query, useful if
    # the Worker ever wants to surface the live count somewhere.
    new_plays = (
        Track.objects.filter(id=track_id)
        .values_list("plays", flat=True)
        .first()
    )

    return JsonResponse({
        "id": track_id,
        "plays": new_plays or 0,
    })
