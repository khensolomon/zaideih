
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    # 1. Django Admin 
    path('admin/', admin.site.urls),
    
    # 2. API Routes
    path('api/', include('api.urls')),
    
    # 3. Core App (Vue SPA Fallback and generic pages)
    # Includes anything that isn't caught by the admin or api routes.
    path('', include('core.urls')),
]
