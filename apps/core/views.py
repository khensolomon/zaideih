from django.views.generic import TemplateView

class VueSPAView(TemplateView):
    """
    Serves the base HTML file for your Vue Single Page Application.
    Django will look for this inside the 'frontend_dist' directory 
    configured in settings.py TEMPLATES.
    """
    template_name = "index.html"