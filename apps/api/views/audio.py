import os
import re
from wsgiref.util import FileWrapper
from urllib.parse import urlparse

from django.conf import settings
from django.db.models import F
from django.http import HttpResponse, HttpResponseForbidden, StreamingHttpResponse, Http404

from api.models import Track
from api import catalog_config
from api.storage_backend import get_backend


"""
Streaming endpoint with multiple layers of protection to ensure only real 
browsers can access the audio, and that scrapers/bots are blocked at the door.
Also supports HTTP Range requests for proper audio scrubbing in the player.
"""
def streaming(request, track_id):
    """
    Validates requests for audio media to prevent unauthorized 
    scraping and hotlinking.
    """

    # Only active if DEBUG is True and the correct key is provided in the URL.
    if settings.DEBUG:
        bypass_value = request.GET.get('dev_bypass')
        if bypass_value and bypass_value == settings.DEV_BYPASS_KEY:
            return _streamer(request, track_id)

    meta = request.META
    host = request.get_host()
    user_agent = meta.get('HTTP_USER_AGENT', '').lower()
    referer = meta.get('HTTP_REFERER')
    fetch_dest = meta.get('HTTP_SEC_FETCH_DEST')

    # 1. Scraper Client Filter
    scrapers = ['curl', 'wget', 'python', 'go-http-client', 'libwww-perl', 'postman']
    if any(s in user_agent for s in scrapers):
        return Http404("Resource unavailable")

    # 2. Origin Validation
    if not referer or urlparse(referer).netloc != host:
        return HttpResponseForbidden("Direct access restricted")

    # 3. Request Destination Validation
    if fetch_dest and fetch_dest not in ['audio', 'empty']:
        return Http404("Invalid request context")

    # 4. RANGE HEADER CHECK
    # Real browsers almost always request a byte range to start playback.
    # Standard scrapers usually just ask for the whole file at once.
    if 'HTTP_RANGE' not in meta:
        # Optional: be extra strict here, but some mobile browsers
        # might skip the range on the very first request.
        pass

    return _streamer(request, track_id)


"""
A simple test endpoint to verify that track retrieval and play counting works
correctly, without involving the complexity of streaming. Reports whether the
track exists in the active cloud backend or only locally.
"""
def test(request, track_id):
    try:
        Track.objects.filter(id=track_id).update(plays=F('plays') + 1)
        track = Track.objects.select_related('album').get(id=track_id)
    except Track.DoesNotExist:
        raise Http404("Track not found")

    full_track_path = f"{track.album.folder_path}/{track.mp3}".strip('/')
    cloud_key = f"{catalog_config.DIR_MUSIC}/{full_track_path}"

    location = 'local'
    try:
        backend = get_backend()
        if backend.get_object_metadata(cloud_key) is not None:
            location = settings.STORAGE_BACKEND
    except Exception as e:
        location = f'local (cloud check failed: {e})'

    return HttpResponse(
        f"ID: *, Plays: {track.plays} Path: {full_track_path} "
        f"Location: {location}, bucket: {get_backend().bucket_name}, "
        f"backend: {settings.STORAGE_BACKEND}"
    )


"""
Streams audio to the client. Tries the active cloud backend (GCS or R2) first, 
falls back to local disk on failure. Supports HTTP Range requests for scrubbing.
"""
def _streamer(request, track_id):
    try:
        Track.objects.filter(id=track_id).update(plays=F('plays') + 1)
        track = Track.objects.select_related('album').get(id=track_id)
    except Track.DoesNotExist:
        raise Http404("Track not found")

    # Reconstruct the full path (e.g., "zola/Lengtong/Ka.Zua.Ngaih/Track.mp3")
    full_track_path = f"{track.album.folder_path}/{track.mp3}".strip('/')
    cloud_key = f"{catalog_config.DIR_MUSIC}/{full_track_path}"

    # print(f"Requesting track ID {track_id} - Cloud key: {cloud_key}")
    # return _streamer_from_local_disk(request, track, full_track_path)

    try:
        backend = get_backend()
        metadata = backend.get_object_metadata(cloud_key)

        if metadata is not None:
            return _streamer_from_cloud(request, backend, cloud_key, metadata.size, track)
        else:
            return _streamer_from_local_disk(request, track, full_track_path)

    except Exception as e:
        print(f"Cloud backend error ({settings.STORAGE_BACKEND}): {e}")
        return _streamer_from_local_disk(request, track, full_track_path)


# --- INTERNAL HELPERS ---
def _streamer_from_cloud(request, backend, key, size, track):
    """
    Unified cloud streamer. Works against any StorageBackend (GCS or R2)
    so the Range/header logic lives in exactly one place.
    """
    print(f"using {settings.STORAGE_BACKEND.upper()} stream")
    range_header = request.META.get('HTTP_RANGE', '').strip()

    if range_header:
        range_match = re.match(r'bytes=(\d+)-(.*)', range_header)
        if range_match:
            first_byte, last_byte = range_match.groups()
            first_byte = int(first_byte) if first_byte else 0
            last_byte = int(last_byte) if last_byte else size - 1
            length = last_byte - first_byte + 1

            data = backend.download_range(key, first_byte, last_byte)
            response = HttpResponse(data, status=206, content_type='audio/mpeg')
            response['Content-Length'] = str(length)
            response['Content-Range'] = f'bytes {first_byte}-{last_byte}/{size}'
            response['Content-Plays'] = str(track.plays)
            return response

    # No Range header: stream the whole file in chunks
    response = StreamingHttpResponse(
        backend.open_stream(key, chunk_size=8192),
        content_type='audio/mpeg',
    )
    response['Content-Length'] = str(size)
    response['Content-Plays'] = str(track.plays)
    response['Accept-Ranges'] = 'bytes'
    return response


def _streamer_from_local_disk(request, track, full_track_path):
    local_path = os.path.join(settings.STORAGE_ROOT, catalog_config.DIR_MUSIC, full_track_path)

    if not os.path.exists(local_path):
        raise Http404("Audio file not found in local disk fallback")

    size = os.path.getsize(local_path)
    range_header = request.META.get('HTTP_RANGE', '').strip()

    if range_header:
        range_match = re.match(r'bytes=(\d+)-(.*)', range_header)
        if range_match:
            first_byte, last_byte = range_match.groups()
            first_byte = int(first_byte) if first_byte else 0
            last_byte = int(last_byte) if last_byte else size - 1
            length = last_byte - first_byte + 1

            f = open(local_path, 'rb')
            f.seek(first_byte)
            data = f.read(length)
            f.close()

            response = HttpResponse(data, status=206, content_type='audio/mpeg')
            response['Content-Length'] = str(length)
            response['Content-Range'] = f'bytes {first_byte}-{last_byte}/{size}'
            response['Content-Plays'] = str(track.plays)
            return response

    f = open(local_path, 'rb')
    response = StreamingHttpResponse(FileWrapper(f, 8192), content_type='audio/mpeg')
    response['Content-Length'] = str(size)
    response['Content-Plays'] = str(track.plays)
    response['Accept-Ranges'] = 'bytes'
    return response