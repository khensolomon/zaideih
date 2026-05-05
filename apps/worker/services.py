"""
HTTP client for talking to the Cloudflare audio Worker.

What this module does now:
  - HMAC signing of outbound requests (Django → Worker, /sync/*)
  - Sync calls: upsert_track, delete_track, ping

What it does NOT do anymore:
  - The Worker no longer calls Django for plays. There's no inbound
    HMAC verification needed in this module — the play endpoint is
    public (SPA → Django).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

WORKER_REQUEST_TIMEOUT = 5.0  # seconds


def _sign(path: str, timestamp: str) -> str:
    """HMAC-SHA256 hex signature over `{path}.{timestamp}`."""
    secret = settings.APP_SECRET_SHARED.encode()
    payload = f"{path}.{timestamp}".encode()
    return hmac.new(secret, payload, hashlib.sha256).hexdigest()


def _signed_headers(path: str) -> dict[str, str]:
    """Build X-Worker-Signature / X-Worker-Timestamp headers."""
    ts = str(int(time.time()))
    return {
        "X-Worker-Signature": _sign(path, ts),
        "X-Worker-Timestamp": ts,
    }


# ---------------------------------------------------------------------------
# Outbound: Django → Worker (sync only)
# ---------------------------------------------------------------------------


def upsert_track(track_id: int, folder_path: str, mp3: str) -> bool:
    """Push a track's path data to the Worker. Returns True on success."""
    path = f"/sync/track/{track_id}"
    url = f"{settings.WORKER_URL}{path}"
    headers = _signed_headers(path)

    try:
        res = requests.post(
            url,
            json={"folder_path": folder_path, "mp3": mp3},
            headers=headers,
            timeout=WORKER_REQUEST_TIMEOUT,
        )
        if res.ok:
            return True
        logger.warning(
            "Worker upsert failed: track_id=%s status=%s body=%s",
            track_id, res.status_code, res.text[:200],
        )
        return False
    except requests.RequestException as exc:
        logger.warning("Worker upsert error: track_id=%s err=%s", track_id, exc)
        return False


def delete_track(track_id: int) -> bool:
    """Tell the Worker a track was deleted."""
    path = f"/sync/track/{track_id}"
    url = f"{settings.WORKER_URL}{path}"
    headers = _signed_headers(path)

    try:
        res = requests.delete(url, headers=headers, timeout=WORKER_REQUEST_TIMEOUT)
        if res.ok:
            return True
        logger.warning(
            "Worker delete failed: track_id=%s status=%s",
            track_id, res.status_code,
        )
        return False
    except requests.RequestException as exc:
        logger.warning("Worker delete error: track_id=%s err=%s", track_id, exc)
        return False


def ping() -> tuple[bool, str]:
    """Sanity-check connectivity and HMAC alignment with the Worker."""
    path = "/sync/ping"
    url = f"{settings.WORKER_URL}{path}"
    headers = _signed_headers(path)

    try:
        res = requests.get(url, headers=headers, timeout=WORKER_REQUEST_TIMEOUT)
        if res.ok:
            return True, f"OK (status {res.status_code})"
        return False, f"Worker returned {res.status_code}: {res.text[:200]}"
    except requests.RequestException as exc:
        return False, f"Connection error: {exc}"