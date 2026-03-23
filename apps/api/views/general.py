
import os
import re
from wsgiref.util import FileWrapper
from django.http import HttpResponseNotModified, JsonResponse, HttpResponse, StreamingHttpResponse, Http404
from django.db.models import F
from django.conf import settings
from google.cloud import storage

from ..store import AssetJSONReader
from ..models import Track
from .. import catalog_config

def get_albums(request, return_format=None):
    """
    Handles both metadata (hash) and full JSON data requests for albums.
    - GET /api/album        -> Returns just the hash
    - GET /api/album/json    -> Returns the full 1.8MB JSON file (with ETags)
    - GET /api/album?json   -> Also supported
    """
    reader = AssetJSONReader(catalog_config.FILE_ALBUMS, location='media')
    file_hash = reader.get_file_hash()

    if 'json' in request.GET or return_format == 'json':
        etag = f'"{file_hash}"' 
        if request.META.get('HTTP_IF_NONE_MATCH') == etag:
            return HttpResponseNotModified()

        response = JsonResponse(reader.json, safe=False)

        response['ETag'] = etag
        response['Cache-Control'] = 'must-revalidate, max-age=3600'
        return response
    else:
        return JsonResponse({"hash": file_hash})

def get_genres(request, return_format=None):
    """
    Reads assets/data/category.json, and strictly returns the 'genre' array
    - GET /api/genre        -> Returns just the hash
    - GET /api/genre?json   -> Returns the full JSON file (with ETags)
    """
    reader = AssetJSONReader(catalog_config.FILE_CATEGORY)
    file_hash = reader.get_file_hash()
    
    if 'json' in request.GET or return_format == 'json':
        etag = f'"{file_hash}"' 
        if request.META.get('HTTP_IF_NONE_MATCH') == etag:
            return HttpResponseNotModified()

        response = JsonResponse(reader.get_section('genre'), safe=False)
        response['ETag'] = etag
        response['Cache-Control'] = 'must-revalidate, max-age=3600' 
        return response
    else:
        return JsonResponse({"hash": file_hash})

def get_artists(request, return_format=None):
    """
    Reads assets/data/artist.name.json, and strictly returns the 'genre' array
    - GET /api/artist        -> Returns just the hash
    - GET /api/artist?json   -> Returns the full JSON file (with ETags)
    """
    reader = AssetJSONReader(catalog_config.FILE_ARTIST_CORRECTIONS)
    file_hash = reader.get_file_hash()
    
    if 'json' in request.GET or return_format == 'json':
        etag = f'"{file_hash}"' 
        if request.META.get('HTTP_IF_NONE_MATCH') == etag:
            return HttpResponseNotModified()

        response = JsonResponse(reader.json, safe=False)
        response['ETag'] = etag
        response['Cache-Control'] = 'must-revalidate, max-age=3600' 
        return response
    else:
        return JsonResponse({"hash": file_hash})

def get_track_list(request, return_format=None):
    """
    Reads assets/data/track.name.json, and strictly returns the 'genre' array
    - GET /api/artist        -> Returns just the hash
    - GET /api/artist?json   -> Returns the full JSON file (with ETags)
    """
    reader = AssetJSONReader(catalog_config.FILE_TRACK_CORRECTIONS)
    file_hash = reader.get_file_hash()
    
    if 'json' in request.GET or return_format == 'json':
        etag = f'"{file_hash}"' 
        if request.META.get('HTTP_IF_NONE_MATCH') == etag:
            return HttpResponseNotModified()

        response = JsonResponse(reader.json, safe=False)
        response['ETag'] = etag
        response['Cache-Control'] = 'must-revalidate, max-age=3600' 
        return response
    else:
        return JsonResponse({"hash": file_hash})

def test_api(request):
    return JsonResponse({"status": "success", "message": "Zaideih API is online!"})


# --- AUDIO STREAMING ENDPOINT ---
def stream_audio(request, track_id):
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
        bucket = client.bucket(settings.GS_BUCKET_NAME)
        
        # FIX: Use get_blob() instead of blob(). 
        # This securely fetches the file AND its size metadata in one API call.
        blob = bucket.get_blob(f"{catalog_config.DIR_MUSIC}/{full_track_path}")

        if blob is not None:
            return _stream_from_gcs(request, blob, track)
        else:
            return _stream_from_local_disk(request, track, full_track_path)

    except Exception as e:
        print(f"GCS Error: {e}")
        return _stream_from_local_disk(request, track, full_track_path)

# --- INTERNAL HELPERS ---
def _stream_from_gcs(request, blob, track):
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


def _stream_from_local_disk(request, track, full_track_path):
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