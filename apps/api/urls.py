# from py_compile import main

from django.urls import path
# from . import views
from .views import general
from .views import audio

urlpatterns = [
    path('test', general.test_api),
    
    # JSON Store APIs
    path('album', general.get_albums),
    path('albums', general.get_albums, {'return_format': 'json'}),
    
    path('genre', general.get_genres),
    path('genres', general.get_genres, {'return_format': 'json'}),

    path('artist', general.get_artists),
    path('artists', general.get_artists, {'return_format': 'json'}),

    path('track', general.get_track_list),
    path('tracks', general.get_track_list, {'return_format': 'json'}),
    
    path('track/<int:track_id>', audio.track_test, name='track_test'),

    # Audio Streamer + Play Counter
    # path('audio/<int:track_id>/', general.stream_audio), 

    # 1. The Vue app calls this behind the scenes to get the temporary ticket
    # path('request-audio/<int:track_id>', audio.requests, name='request_audio'),
    # 2. The browser automatically calls this when Vue sets the <audio src="...">
    # path('audio/<int:track_id>', audio.streams, name='serve_audio'),
    path('audio/<int:track_id>', audio.streamer, name='serve_audio'),

    # # 1. Get the ticket (RESTful Action)
    # path('audio/<int:track_id>/request', audio.requests, name='request_audio'),
    
    # # 2. Serve the audio (The Resource itself)
    # path('audio/<int:track_id>', audio.streams, name='serve_audio'),
]