
# import os
# import re
# from wsgiref.util import FileWrapper
from django.http import HttpResponseNotModified, JsonResponse
# from django.db.models import F
# from django.conf import settings
# from google.cloud import storage

from ..store import AssetJSONReader
# from ..models import Track
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

def home(request):
    return JsonResponse({"status": "success", "message": "online!"})
