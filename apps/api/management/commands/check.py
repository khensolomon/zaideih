"""
Search & Check Command (check.py)
=================================

Description:
A developer experience (DX) tool to safely search the music catalog. 
It bypasses terminal UTF-8 encoding issues by outputting search results 
directly to a cleanly formatted text file (`cache/check-result.txt`).

Features:
- Smart Detection: Automatically detects whether a query is an Integer ID or a String.
- Dictionary Search: Fuzzy searches `artist.name.json` and `category.json` for typos, AKAs, and thesaurus matches.
- Deep Catalog Search: Cross-references the compiled `albums.json` with the MySQL database to provide real-world context (folder paths, play counts, track lists) for Albums and Tracks.
- Safe UTF-8: Guarantees perfect rendering of complex scripts (like Myanmar/Burmese).

Usage:
python manage.py check --artist 171
python manage.py check --artist "Lengtong Pauno"
python manage.py check --genre "Alternative"
python manage.py check --album "Ka Zua Ngaih"
python manage.py check --track "Damlai Nite"
"""
import os
import json
from pathlib import Path
from django.core.management.base import BaseCommand
from django.conf import settings

from api import catalog_config
from api.models import Track, Album

class Command(BaseCommand):
    help = 'Searches dictionaries and DB for an artist, track, album, or genre. Outputs safe UTF-8 to a text file.'

    def add_arguments(self, parser):
        # Dictionary searches (Entity Records)
        parser.add_argument('--artist', type=str, help='Search for an Artist by Name or ID')
        parser.add_argument('--genre', type=str, help='Search for a Genre by Name or ID')
        
        # Deep Catalog Searches (Cross-references JSON with DB)
        parser.add_argument('--album', type=str, help='Search the compiled catalog by Album Title or UID')
        parser.add_argument('--track', type=str, help='Search the compiled catalog by Track Title, ID, or MP3 filename')

    def handle(self, *args, **options):
        # 1. Figure out what we are searching for
        search_term = None
        search_type = None
        target_file = None
        is_catalog_search = False

        if options.get('artist'):
            search_term = options['artist']
            search_type = 'Artist'
            target_file = catalog_config.FILE_ARTIST_CORRECTIONS
        elif options.get('genre'):
            search_term = options['genre']
            search_type = 'Genre'
            target_file = catalog_config.FILE_CATEGORY
        elif options.get('album'):
            search_term = options['album']
            search_type = 'Compiled Catalog (Album)'
            is_catalog_search = True
        elif options.get('track'):
            search_term = options['track']
            search_type = 'Compiled Catalog (Track)'
            is_catalog_search = True

        if search_term is None:
            self.stderr.write(self.style.ERROR("Please provide a flag: --artist, --track, --album, or --genre"))
            return

        self.stdout.write(f"Searching for {search_type}: '{search_term}'...")

        search_term_lower = search_term.strip().lower()
        results = []

        # --- MODE A: COMPILED CATALOG SEARCH ---
        if is_catalog_search:
            store_dir = Path(settings.MEDIA_ROOT) / 'store'
            albums_file = store_dir / catalog_config.FILE_ALBUMS
            
            try:
                with open(albums_file, 'r', encoding='utf-8') as f:
                    catalog_data = json.load(f)
            except Exception as e:
                self.stderr.write(self.style.ERROR(f"Failed to load {catalog_config.FILE_ALBUMS}: {e}"))
                return

            # Fetch DB references for real file paths
            db_albums = {a.uid: a.folder_path for a in Album.objects.all()}
            db_tracks = {t.id: t.mp3 for t in Track.objects.all()} if search_type == 'Compiled Catalog (Track)' else {}

            for album in catalog_data:
                # --- ALBUM SEARCH ---
                if search_type == 'Compiled Catalog (Album)':
                    uid = album.get('ui', '')
                    title = album.get('ab', '')
                    folder_path = db_albums.get(uid, 'Unknown (Not in DB)')
                    
                    if (search_term_lower in uid.lower() or 
                        search_term_lower in title.lower() or 
                        search_term_lower in folder_path.lower()):
                        
                        artist_ids = set(a_id for t in album.get('tk', []) for a_id in t.get('a', []))
                        
                        results.append({
                            'UID': uid,
                            'Title': title,
                            'Directory': folder_path,
                            'Total Tracks': len(album.get('tk', [])),
                            'Artist IDs': list(artist_ids),
                            'Genre IDs': album.get('gr', []),
                            'Language ID': album.get('lg', ''),
                            'Track List': ", ".join([t.get('t', 'Unknown') for t in album.get('tk', [])])
                        })

                # --- TRACK SEARCH ---
                elif search_type == 'Compiled Catalog (Track)':
                    for track in album.get('tk', []):
                        track_title = track.get('t', '')
                        track_id = track.get('i')
                        mp3_name = db_tracks.get(track_id, 'Unknown.mp3')
                        
                        # Match by title, actual MP3 filename, or database ID
                        if (search_term_lower in track_title.lower() or 
                            search_term_lower in mp3_name.lower() or 
                            search_term_lower == str(track_id)):
                            
                            results.append({
                                'Track ID': track_id,
                                'Title': track_title,
                                'MP3 File': mp3_name,
                                'Album Title': album.get('ab', ''),
                                'Album Folder': db_albums.get(album.get('ui', ''), 'Unknown'),
                                'Play Counts': track.get('p', 0),
                                'Artist IDs': track.get('a', []),
                                'Duration (sec)': track.get('d', 0)
                            })

        # --- MODE B: DICTIONARY SEARCH ---
        else:
            data_dir = Path(settings.BASE_DIR) / 'assets' / 'data'
            dict_path = data_dir / target_file
            
            try:
                with open(dict_path, 'r', encoding='utf-8') as f:
                    dict_data = json.load(f)
            except Exception as e:
                self.stderr.write(self.style.ERROR(f"Failed to load {target_file}: {e}"))
                return

            if 'Genre' in search_type and isinstance(dict_data, dict):
                dict_data = dict_data.get('genre', [])

            id_key = catalog_config.DICT_ARTIST_ID if search_type == 'Artist' else catalog_config.DICT_GENRE_ID

            for item in dict_data:
                is_match = False
                
                # --- ID Match (if query is a number) ---
                if search_term.isdigit() and str(item.get(id_key, '')) == search_term:
                    is_match = True
                
                # --- Fuzzy String Match ---
                if not is_match:
                    match_list = [
                        item.get(catalog_config.DICT_NAME, '').lower(),
                        item.get(catalog_config.DICT_AKA, '').lower()
                    ]
                    match_list.extend([t.lower() for t in item.get(catalog_config.DICT_THESAURUS, []) if t])
                    match_list.extend([c.lower() for c in item.get(catalog_config.DICT_CORRECTION, []) if c])

                    if any(search_term_lower in m for m in match_list if m):
                        is_match = True

                if is_match:
                    results.append(item)

        # 4. Write results to a UTF-8 Safe TXT file in the cache directory
        cache_dir = Path(settings.BASE_DIR) / 'cache'
        cache_dir.mkdir(parents=True, exist_ok=True)
        output_file = cache_dir / 'check-result.txt'

        with open(output_file, 'w', encoding='utf-8') as f:
            f.write("Check - result\n")
            f.write(f"query     : {search_term}\n")
            f.write(f"type      : {search_type}\n")
            f.write(f"match     : {len(results)}\n\n")

            for idx, item in enumerate(results, 1):
                f.write("-" * 4 + f" Match #{idx} " + "-" * 4 + "\n")
                for k, v in item.items():
                    f.write(f"{str(k).ljust(15)} : {v}\n")
                f.write("\n")

        # 5. Print Safe Terminal Summary
        if results:
            self.stdout.write(self.style.SUCCESS(f"Found {len(results)} match(es)!"))
            self.stdout.write(self.style.WARNING(f"--> Open 'cache/{output_file.name}' in your editor to see the full UTF-8 data."))
        else:
            self.stdout.write(self.style.ERROR("No matches found."))