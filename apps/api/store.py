import os
import json
import logging
import hashlib
from typing import Any, Dict, List, Optional, Union
from django.conf import settings

# Set up a logger for clean error handling
logger = logging.getLogger(__name__)

class AssetJSONReader:
    """
    A robust, Object-Oriented (OOP) reader for human-curated JSON files in a Django project.
    
    Core Features:
    - Lazy Loading: The physical file is parsed only when data is first accessed.
    - Caching: Subsequent accesses use an in-memory dictionary for maximum speed.
    - Flexible Locations: Easily toggle between reading from 'assets/data' or 'media/store'.
    - Pythonic API: Supports dictionary-like access (e.g., `reader['genre']`) and `in` operator.
    - Utilities: Includes built-in methods to extract lists of names, find items by ID, 
      and calculate the JS-equivalent JSON stringify length.
    """

    def __init__(self, filename: str, location: str = 'assets'):
        """
        Initializes the reader with the target filename.
        The data is not loaded until it is explicitly requested (Lazy Loading).
        
        Args:
            filename (str): The name of the JSON file.
            location (str): Where to look for the file ('assets' or 'media'). Defaults to 'assets'.
        """
        self.filename = filename
        
        # Explicit location assignment instead of fallback searching
        if location == 'media':
            # media_root = getattr(settings, 'MEDIA_ROOT', os.path.join(getattr(settings, 'BASE_DIR', ''), 'media'))
            # media_root = getattr(settings, 'MEDIA_ROOT', os.path.join(getattr(settings, 'BASE_DIR', ''), 'media'))
            self._filepath = os.path.join(settings.STORAGE_DIR, 'store', filename)
        else:
            self._filepath = os.path.join(settings.BASE_DIR, 'assets', 'data', filename)
            
        self._json_data: Optional[Union[Dict[str, Any], List[Any]]] = None

    @property
    def json(self) -> Union[Dict[str, Any], List[Any]]:
        """
        Property that lazily loads and caches the JSON data.
        File reading only happens once per instance.
        """
        if self._json_data is None:
            self._json_data = self._load_data()
        return self._json_data

    def _load_data(self) -> Union[Dict[str, Any], List[Any]]:
        """Internal helper to safely read the JSON file from the explicit path."""
        if not os.path.exists(self._filepath):
            logger.warning(f"Asset file '{self.filename}' not found at {self._filepath}.")
            return {}
            
        # --- Safe JavaScript Parity Helpers ---
        # Python keeps '.0' on floats (1.0 -> 3 chars), JS drops it (1 -> 1 char).
        # This safely converts them to ints upon loading so they stringify correctly.
        def js_float_parser(num_str):
            f = float(num_str)
            return int(f) if f.is_integer() else f
            
        # JS strictly converts NaN, Infinity, and -Infinity to null (Python keeps them)
        def js_constant_parser(c):
            return None
            
        try:
            with open(self._filepath, 'r', encoding='utf-8') as f:
                return json.load(
                    f, 
                    parse_float=js_float_parser, 
                    parse_constant=js_constant_parser
                )
        except json.JSONDecodeError as e:
            logger.error(f"Error decoding JSON in {self._filepath}: {e}")
            return {}
        except Exception as e:
            logger.exception(f"Unexpected error reading {self._filepath}: {e}")
            return {}

    def get_section(self, section_name: str) -> List[Dict[str, Any]]:
        """
        Retrieve a specific section (e.g., 'lang', 'genre').
        Returns an empty list if the section doesn't exist.
        Safely handles if the root JSON is a List instead of a Dict.
        """
        if isinstance(self.json, dict):
            return self.json.get(section_name, [])
        return []

    def get_names(self, section_name: str) -> List[str]:
        """
        Plucks only the 'name' attribute from a specific section.
        """
        items = self.get_section(section_name)
        return [item.get('name') for item in items if 'name' in item]

    def get_joined_names(self, section_name: str, separator: str = ", ") -> str:
        """
        Returns the names of a specific section as a single, joined string.
        """
        return separator.join(self.get_names(section_name))

    def get_stringify_length(self, section_name: Optional[str] = None) -> int:
        """
        Calculates the character length of the JSON stringified data,
        aiming for parity with JavaScript's JSON.stringify(data).length.
        
        Args:
            section_name (str, optional): The specific section to stringify.
                                          If None, stringifies the ENTIRE JSON file.
        Returns:
            int: The character count of the compact JSON string.
        """
        data_to_stringify = self.get_section(section_name) if section_name else self.json
        
        # separators=(',', ':') removes whitespace, matching JS
        # ensure_ascii=False prevents \uXXXX escaping, keeping native characters
        js_str = json.dumps(data_to_stringify, separators=(',', ':'), ensure_ascii=False)
        
        # JavaScript measures strings in UTF-16 code units (Emojis count as 2).
        # Python measures in true Unicode points (Emojis count as 1).
        # Encoding to utf-16-le and dividing bytes by 2 safely mimics JS length.
        return len(js_str.encode('utf-16-le')) // 2

    def get_file_hash(self) -> str:
        """
        Returns an MD5 hash of the raw file on disk.
        This is the safest, industry-standard way to detect if data has changed.
        If even a single letter in the file is modified, this hash completely changes.
        """
        if not os.path.exists(self._filepath):
            return ""
        
        file_hash = hashlib.md5()
        with open(self._filepath, "rb") as f:
            # Read in chunks to efficiently handle very large JSON files
            for chunk in iter(lambda: f.read(4096), b""):
                file_hash.update(chunk)
        return file_hash.hexdigest()

    def get_last_modified(self) -> float:
        """
        Returns the UNIX timestamp of when the file was last modified.
        Extremely fast cache invalidation method.
        """
        if not os.path.exists(self._filepath):
            return 0.0
        return os.path.getmtime(self._filepath)

    def get_by_id(self, section_name: str, item_id: int) -> Optional[Dict[str, Any]]:
        """Finds and returns a specific item by its ID within a section."""
        items = self.get_section(section_name)
        for item in items:
            if item.get('id') == item_id:
                return item
        return None

    # --- Python "Magic" Methods for a beautiful API ---

    def __getitem__(self, key: str) -> List[Dict[str, Any]]:
        """Allows dictionary-style access. reader['genre']"""
        return self.get_section(key)

    def __contains__(self, key: str) -> bool:
        """Allows using the 'in' keyword: if 'genre' in reader: ..."""
        if isinstance(self.json, dict):
            return key in self.json
        return False

    def __str__(self) -> str:
        status = "Loaded" if self._json_data is not None else "Not Loaded"
        return f"<AssetJSONReader: {self.filename} ({status})>"

# --- Example Usage ---
if __name__ == "__main__":
    import sys
    from types import SimpleNamespace
    
    settings = SimpleNamespace(
        BASE_DIR='/tmp/fake_django_project',
        MEDIA_ROOT='/tmp/fake_django_project/media'
    )
    
    # Mock Setup
    assets_dir = os.path.join(settings.BASE_DIR, 'assets', 'data')
    os.makedirs(assets_dir, exist_ok=True)
    
    mock_data = {
        "genre": [{"id": 1, "name": "Rock"}, {"id": 2, "name": "Alternative"}],
    }
    
    filepath = os.path.join(assets_dir, 'music_data.json')
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(mock_data, f)

    reader = AssetJSONReader('music_data.json') 
    
    print(f"Is 'genre' in reader? {'genre' in reader}")
    print(f"Genre Names: {reader.get_names('genre')}")
    print(f"Joined Names: {reader.get_joined_names('genre')}")
    print(f"Stringify Length: {reader.get_stringify_length()} chars")
    print(f"File Hash (MD5): {reader.get_file_hash()}")
    print(f"Last Modified Timestamp: {reader.get_last_modified()}")
    
    os.remove(filepath)