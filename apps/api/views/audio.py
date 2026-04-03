import os
import re
import hmac
import hashlib
import time
from wsgiref.util import FileWrapper
from django.conf import settings
from django.http import HttpResponse, HttpResponseForbidden, StreamingHttpResponse, Http404, FileResponse
from urllib.parse import urlparse

from django.db.models import F
from django.conf import settings
from google.cloud import storage

from ..models import Track
from .. import catalog_config

def _generate_signed_audio_url(track_id: int, expiration_window_seconds: int = 300) -> str:
    expires = int(time.time()) + expiration_window_seconds
    message = f"{track_id}:{expires}".encode('utf-8')
    secret = settings.SECRET_KEY.encode('utf-8')
    signature = hmac.new(secret, message, hashlib.sha256).hexdigest()
    return f"/api/audio/{track_id}?expires={expires}&sig={signature}"

def _verify_signature(track_id: int, expires: int, provided_signature: str) -> bool:
    if int(time.time()) > expires:
        return False
    message = f"{track_id}:{expires}".encode('utf-8')
    secret = settings.SECRET_KEY.encode('utf-8')
    expected_signature = hmac.new(secret, message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected_signature, provided_signature)

def requests(request, track_id):
    # TEMPORARILY COMMENTED OUT FOR TESTING
    # if not request.user.is_authenticated:
    #     return HttpResponseForbidden("Not authorized")
        
    signed_url = _generate_signed_audio_url(track_id, 300)
    return HttpResponse(f'{{"url": "{signed_url}"}}', content_type="application/json")

def streams(request, track_id):
    expires = request.GET.get('expires', 0)
    signature = request.GET.get('sig', '')
    
    try:
        expires = int(expires)
    except ValueError:
        return HttpResponseForbidden("Invalid expiration format")

    if not _verify_signature(track_id, expires, signature):
        return HttpResponseForbidden("Invalid or expired signature")
        
    # # --- THE FIX IS HERE ---
    
    # # 1. Find a REAL mp3 file on your computer. 
    # # For this test, place a file named "test.mp3" in the exact 
    # # same folder as your Django manage.py file.
    # file_path = "cache/test.mp3" 
    
    # if not os.path.exists(file_path):
    #     return HttpResponse("Error: You need to put a real test.mp3 file in your Django folder!", status=404)

    # # 2. Use FileResponse instead of HttpResponse. 
    # # FileResponse automatically handles streaming, range-requests, 
    # # and tells the browser exactly how long the audio file is.
    # try:
    #     audio_file = open(file_path, 'rb')
    #     return FileResponse(audio_file, content_type="audio/mpeg")
    # except Exception as e:
    #     return HttpResponse(f"Server error loading file: {e}", status=500)

    return streamer(request, track_id)

"""
Streaming endpoint with multiple layers of protection to ensure only real browsers can access the audio, and that scrapers/bots are blocked at the door.
Also supports HTTP Range requests for proper audio scrubbing in the player.
"""
def streams_v2(request, track_id):
    """
    Validates requests for audio media to prevent unauthorized 
    scraping and hotlinking.
    """

    # Only active if DEBUG is True and the correct key is provided in the URL.
    if settings.DEBUG:
        bypass_value = request.GET.get('dev_bypass')
        if bypass_value and bypass_value == settings.DEV_BYPASS_KEY:
            return streamer(request, track_id)

    meta = request.META
    host = request.get_host()
    user_agent = meta.get('HTTP_USER_AGENT', '').lower()
    referer = meta.get('HTTP_REFERER')
    fetch_dest = meta.get('HTTP_SEC_FETCH_DEST')

    # 1. Scraper Client Filter
    # Identifies and blocks common automated tools.
    scrapers = ['curl', 'wget', 'python', 'go-http-client', 'libwww-perl', 'postman']
    if any(s in user_agent for s in scrapers):
        return Http404("Resource unavailable")

    # 2. Origin Validation
    # Ensures the request originates from the local domain.
    if not referer or urlparse(referer).netloc != host:
        return HttpResponseForbidden("Direct access restricted")

    # 3. Request Destination Validation
    # Validates that the request is initiated by a media element.
    if fetch_dest and fetch_dest not in ['audio', 'empty']:
        return Http404("Invalid request context")

    # 4. RANGE HEADER CHECK (The "HTML5 Player" behavior)
    # Real browsers almost always request a byte range to start playback.
    # Standard scrapers usually just ask for the whole file at once.
    if 'HTTP_RANGE' not in meta:
        # Optional: You can be extra strict here, but some mobile browsers 
        # might skip the range on the very first request.
        pass 

    return streamer(request, track_id)


def track_test(request, track_id):
    try:
        Track.objects.filter(id=track_id).update(plays=F('plays') + 1)
        track = Track.objects.select_related('album').get(id=track_id)
    except Track.DoesNotExist:
        raise Http404("Track not found")

    # client = storage.Client()
    # bucket = client.bucket(settings.BUCKETNAME)
    
    # FIX: Use get_blob() instead of blob(). 
    # This securely fetches the file AND its size metadata in one API call.
    # blob = bucket.get_blob(f"{catalog_config.DIR_MUSIC}/{full_track_path}")

    blob_test = 'local'

    # if blob is not None:
    #     blob_test = 'gcs'

    full_track_path = f"{track.album.folder_path}/{track.mp3}".strip('/')
    return HttpResponse(f"ID: {track_id}, Plays: {track.plays} Path: {full_track_path} Blob: {blob_test}, bucket: {settings.BUCKETNAME}")

# Served as both audio endpoint and play counter incrementor. But it was also the original, unprotected streaming endpoint that anyone could call.
def streamer(request, track_id):
    """
    Handles streaming audio to the client. Tries GCS first, falls back to local disk.
    Supports HTTP Range requests for audio scrubbing.
    """
    try:
        Track.objects.filter(id=track_id).update(plays=F('plays') + 1)
        track = Track.objects.select_related('album').get(id=track_id)
    except Track.DoesNotExist:
        raise Http404("Track not found")

    # Reconstruct the full path dynamically (e.g., "zola/Lengtong/Ka.Zua.Ngaih/Track.mp3")
    full_track_path = f"{track.album.folder_path}/{track.mp3}".strip('/')

    try:
        client = storage.Client()
        bucket = client.bucket(settings.BUCKETNAME)
        
        # FIX: Use get_blob() instead of blob(). 
        # This securely fetches the file AND its size metadata in one API call.
        blob = bucket.get_blob(f"{catalog_config.DIR_MUSIC}/{full_track_path}")

        if blob is not None:
            return _streamer_from_gcs(request, blob, track)
        else:
            return _streamer_from_local_disk(request, track, full_track_path)

    except Exception as e:
        print(f"GCS Error: {e}")
        return _streamer_from_local_disk(request, track, full_track_path)

# --- INTERNAL HELPERS ---
def _streamer_from_gcs(request, blob, track):
    print("using GCS stream")
    size = blob.size
    range_header = request.META.get('HTTP_RANGE', '').strip()

    if range_header:
        range_match = re.match(r'bytes=(\d+)-(.*)', range_header)
        if range_match:
            first_byte, last_byte = range_match.groups()
            first_byte = int(first_byte) if first_byte else 0
            last_byte = int(last_byte) if last_byte else size - 1
            length = last_byte - first_byte + 1

            data = blob.download_as_bytes(start=first_byte, end=last_byte)
            response = HttpResponse(data, status=206, content_type='audio/mpeg')
            response['Content-Length'] = str(length)
            response['Content-Range'] = f'bytes {first_byte}-{last_byte}/{size}'
            response['Content-Play'] = str(track.plays)
            return response

    def file_iterator():
        with blob.open('rb') as f:
            while chunk := f.read(8192):
                yield chunk

    response = StreamingHttpResponse(file_iterator(), content_type='audio/mpeg')
    response['Content-Length'] = str(size)
    response['Content-Play'] = str(track.plays)
    response['Accept-Ranges'] = 'bytes'
    return response


def _streamer_from_local_disk(request, track, full_track_path):
    # Fixed: Injected 'music' into the local storage path using config
    local_path = os.path.join(settings.STORAGE_DIR, catalog_config.DIR_MUSIC, full_track_path)
    
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
            response['Content-Play'] = str(track.plays)
            return response

    f = open(local_path, 'rb')
    response = StreamingHttpResponse(FileWrapper(f, 8192), content_type='audio/mpeg')
    response['Content-Length'] = str(size)
    response['Content-Play'] = str(track.plays)
    response['Accept-Ranges'] = 'bytes'
    return response
