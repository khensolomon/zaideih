"""
middleware.py
"""
from typing import Callable
from django.http import HttpRequest, HttpResponse
from django.conf import settings
import logging

logger = logging.getLogger(__name__)

# Make sure to run: pip install minify-html
import minify_html

class HtmlMinifyMiddleware:
    """
    This middleware minifies the HTML response in production environments.

    It uses the blazing-fast Rust-based `minify-html` library, which properly 
    understands and safely minifies inline CSS and JavaScript without breaking them.
    """
    def __init__(self, get_response: Callable[[HttpRequest], HttpResponse]) -> None:
        self.get_response = get_response

    def __call__(self, request: HttpRequest) -> HttpResponse:
        # First, get the response from the view
        response = self.get_response(request)

        # We only want to minify valid HTML responses in a production setting.
        # We check for DEBUG=False, the 'text/html' content type, 
        # ensure it's not streaming, ensure there is actual content,
        # and ensure it hasn't already been compressed (e.g., gzip or brotli).
        if (
            not settings.DEBUG 
            and 'text/html' in response.get('Content-Type', '') 
            and not getattr(response, 'streaming', False)
            and not response.has_header('Content-Encoding')
            and response.content
        ):
            try:
                # Decode the original HTML content
                html_content = response.content.decode('utf-8')

                # Minify the HTML, including inline JS and CSS
                minified_content = minify_html.minify(
                    html_content,
                    minify_js=True,
                    minify_css=True,
                    keep_closing_tags=True,  # Safer if you use JS frameworks like Vue/React
                    do_not_minify_doctype=True,
                    ensure_spec_compliant_unquoted_attribute_values=True
                )
                
                # Re-encode the minified content
                response.content = minified_content.encode('utf-8')
                
                # CRITICAL: Update the Content-Length header if it exists. 
                # Since we removed bytes, the old length is now invalid.
                if 'Content-Length' in response:
                    response['Content-Length'] = str(len(response.content))
                    
            except Exception as e:
                # Log the exact error to your server logs instead of failing silently
                logger.error(f"HTML Minification failed: {e}")
                pass

        return response