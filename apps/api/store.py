import json
import os
from django.conf import settings

def read_json_store(filename):
    """
    Reads the JSON data files (album.json, genre.json) from the 
    MEDIA_DIR/store defined in your .env configuration.
    """
    filepath = os.path.join(settings.MEDIA_ROOT, 'store', filename)
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Warning: Could not find JSON store file at {filepath}")
        return []