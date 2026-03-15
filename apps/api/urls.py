from django.urls import path
from . import views

urlpatterns = [
    path('test/', views.test_api),
    
    # JSON Store APIs
    path('album/', views.get_albums),
    path('genre/', views.get_genres),
    path('artist/', views.get_artists),
    path('track/', views.get_track_list),
    
    # Audio Streamer + Play Counter
    path('audio/<int:track_id>/', views.stream_audio), 
]