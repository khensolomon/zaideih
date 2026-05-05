"""
Public endpoint hit by the SPA when the user plays a track.

  POST /api/track/<id>/played/

No HMAC, no auth (yet). When user accounts come in, this becomes
authenticated and can also record per-user play history.

The Worker no longer calls Django for plays. The SPA tells Django
directly because the Worker can't observe most plays (browser caches
the audio response after the first request).
"""

from __future__ import annotations

import logging

from django.db.models import F
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

# Replace `music` with the actual app where your Track model lives.
from api.models import Track

logger = logging.getLogger(__name__)


@csrf_exempt
@require_POST
def track_played(request, track_id: int):
    """
    Atomically increment the play counter for a track.

    No authentication for now — anyone can POST. This is fine for
    development and personal use; tighten when accounts come in.
    """
    updated = Track.objects.filter(id=track_id).update(plays=F("plays") + 1)

    if not updated:
        return JsonResponse({"error": "not found"}, status=404)

    return JsonResponse({"id": track_id, "ok": True})