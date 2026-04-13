# from django.views.generic import TemplateView

# class VueSPAView(TemplateView):
#     """
#     Serves the base HTML file for your Vue Single Page Application.
#     Django will look for this inside the 'templates' directory 
#     configured in settings.py TEMPLATES.
#     """
#     template_name = "home.html"

from django.http import  HttpRequest, HttpResponse
from django.shortcuts import render
from api.store import AssetJSONReader

def home(request: HttpRequest) -> HttpResponse:
    albums = AssetJSONReader('albums.json', location='media')
    artists = AssetJSONReader('artist.name.json')
    category = AssetJSONReader('category.json')

    context = {
        'title': 'Zaideih',
        "keywords": "zola, mp3, myanmar, music, station, zaideih",
		"description": "Zaideih Music Station",
		# "appName": "Zaideih",
		# "appVersion": "1.3.9",
		# "environment": "development",
        "raw":{
            "album": albums.get_stringify_length(),
            "artist": artists.get_stringify_length(),
            "genre": category.get_stringify_length('genre'),
            # "lang": "untitle,zola,myanmar,mizo,falam,haka,english,chin,korea,norwegian,collection"
            # "lang": category.get_names('lang')
            "lang": category.get_joined_names('lang')
        }
    }
    return render(request, 'core/home.html', context)

def health(request: HttpRequest) -> HttpResponse:
    return HttpResponse("ok")
