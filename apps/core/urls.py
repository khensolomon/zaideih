import re
from django.conf import settings
from django.urls import re_path
from django.views.static import serve
from .views import general

urlpatterns = []

if settings.DEBUG:
    # 1. DEFINE YOUR STATIC FILTER FIRST
    # This matches files ending in specific extensions
    # STATIC_FILE_REGEX = r'^.*\.(js|json|ico|txt|css|png|jpg)$'
    # STATIC_FILE_REGEX = r'^(.*/)?(?:[^/]+)\.(js|json|ico|txt|css|png|jpg|svg)$'
    # ROOT_FILES = ['webpack-stats.json', 'robots.txt', 'favicon.ico', 'ads.txt']
    # STATIC_FILE_REGEX = r'^(' + '|'.join(map(re.escape, ROOT_FILES)) + r')$'

    ALLOWED_EXTS = r'(?:js|json|ico|txt|css|png|svg|map|webmanifest)'
    SPECIAL_FILES = '|'.join(map(re.escape, [
        'webpack-stats.json', 'robots.txt', 'favicon.ico', 'ads.txt'
    ]))

    STATIC_FILE_REGEX = (
        r'^'
        r'(?P<path>'
            r'(?:' + SPECIAL_FILES + r')'           # special files at any level (or just root if you prefer)
            r'|'
            r'.*?\.' + ALLOWED_EXTS + r''
        r')'
        r'$'
    )

    urlpatterns += [
        re_path(
            STATIC_FILE_REGEX, 
            serve, 
            {'document_root': settings.BASE_DIR / "static"}
        ),
    ]

urlpatterns += [
    # Catch-all pattern sends everything not caught by 'api/' to the SPA index
    re_path(r'^.*$', general.home, name='spa_index'),
]