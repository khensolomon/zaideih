from django.urls import re_path
from . import views

urlpatterns = [
    # Catch-all for Vue SPA. 
    # This safely catches all frontend dynamic URLs (e.g., /album/123)
    re_path(r'^.*$', views.VueSPAView.as_view(), name='vue_spa'),
]