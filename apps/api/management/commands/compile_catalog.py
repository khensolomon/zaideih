import os
import json
import re
from collections import Counter
from pathlib import Path

from django.core.management.base import BaseCommand
from django.conf import settings
from api.models import Album, Track, Lang
from api import catalog_config

class Command(BaseCommand):
    help = 'Compiles bucket.[lang].json files into a highly optimized albums.json payload.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--lang',
            nargs='+',
            help='Specific languages to compile (e.g., "zola falam" or "all").'
        )
        parser.add_argument(
            '--minify',
            action='store_true',
            help='Output the final albums.json without indentation to save space.'
        )

    def handle(self, *args, **options):
        target_langs = options.get('lang')
        
        if not target_langs:
            self.stderr.write(self.style.ERROR("No language specified. Use --lang zola, --lang zola falam, or --lang all"))
            return

        store_dir = Path(settings.MEDIA_ROOT) / 'store'
        data_dir = Path(settings.BASE_DIR) / 'assets' / 'data'
        
        # 1. RESOLVE TARGET LANGUAGES
        all_buckets = list(store_dir.glob('bucket.*.json'))
        if 'all' in target_langs:
            langs_to_process = [b.name.split('.')[1] for b in all_buckets]
        else:
            langs_to_process = target_langs

        if not langs_to_process:
            self.stderr.write(self.style.WARNING("No buckets found for the specified languages."))
            return

        self.stdout.write(self.style.SUCCESS(f"Starting compilation for: {', '.join(langs_to_process)}"))

        # 2. LOAD MASTER DICTIONARIES
        self.stdout.write("Loading master dictionaries...")
        artists_dict, artists_changed = self.load_dictionary(data_dir / catalog_config.FILE_ARTIST_CORRECTIONS)
        
        category_data, _ = self.load_dictionary(data_dir / catalog_config.FILE_CATEGORY)
        if isinstance(category_data, dict):
            genres_dict = category_data.get('genre', [])
        else:
            genres_dict = []
            category_data = {'genre': genres_dict}
        genres_changed = False

        albums_dict, _ = self.load_dictionary(data_dir / catalog_config.FILE_ALBUM_CORRECTIONS)
        tracks_dict, _ = self.load_dictionary(data_dir / catalog_config.FILE_TRACK_CORRECTIONS)

        # 3. LOAD MYSQL DATABASE STATE (2 Tables)
        self.stdout.write("Fetching MySQL database state...")
        
        db_albums = {a.uid: a for a in Album.objects.all()}
        db_tracks = {f"{t.album.uid}/{t.mp3}": t for t in Track.objects.select_related('album').all()}
        
        # Get Language Models
        lang_models = {}
        for l_name in langs_to_process:
            lang_obj, _ = Lang.objects.get_or_create(name=l_name, defaults={'dir': f'music/{l_name}/'})
            lang_models[l_name] = lang_obj

        # 3.5 PRE-SYNC ALBUMS TO DATABASE
        self.stdout.write("Synchronizing Albums to MySQL...")
        new_albums_to_insert = {}
        for lang in langs_to_process:
            bucket_path = store_dir / catalog_config.get_bucket_filename(lang)
            if not bucket_path.exists(): continue
            with open(bucket_path, 'r', encoding='utf-8') as f:
                for album_data in json.load(f):
                    uid = album_data[catalog_config.B_ALBUM_ID]
                    if uid not in db_albums and uid not in new_albums_to_insert:
                        folder_path = f"{lang}/{album_data[catalog_config.B_ALBUM_DIR]}".strip('/')
                        album_obj = Album(uid=uid, folder_path=folder_path)
                        new_albums_to_insert[uid] = album_obj

        if new_albums_to_insert:
            self.stdout.write(f"Inserting {len(new_albums_to_insert)} new albums...")
            Album.objects.bulk_create(new_albums_to_insert.values())
            db_albums = {a.uid: a for a in Album.objects.all()}

        final_albums = []
        new_tracks_to_insert = []

        # 4. PROCESS BUCKETS
        for lang in langs_to_process:
            bucket_path = store_dir / catalog_config.get_bucket_filename(lang)
            if not bucket_path.exists(): continue

            with open(bucket_path, 'r', encoding='utf-8') as f:
                bucket_data = json.load(f)

            for album_data in bucket_data:
                album_tracks_data = album_data.get(catalog_config.B_ALBUM_TRACKS, [])

                raw_album_name = next((t.get(catalog_config.B_TRACK_ALBUM) for t in album_tracks_data if t.get(catalog_config.B_TRACK_ALBUM)), None)
                if not raw_album_name:
                    raw_album_name = album_data.get(catalog_config.B_ALBUM_DIR, '').split('/')[-1]
                    
                clean_album_name = self.resolve_string(raw_album_name, albums_dict)

                album_years = []
                album_genres = set()
                compiled_tracks = []

                for track in album_tracks_data:
                    raw_title = track.get(catalog_config.B_TRACK_TITLE) or track.get(catalog_config.B_TRACK_FILE)
                    clean_track_name = self.resolve_string(raw_title, tracks_dict)
                    
                    duration_sec = self.parse_duration(track.get(catalog_config.B_TRACK_DURATION, '0:00'))
                    album_years.extend(self.extract_years(track.get(catalog_config.B_TRACK_YEAR, '')))
                    
                    track_artist_ids = []
                    for raw_artist in track.get(catalog_config.B_TRACK_ARTIST, []):
                        artist_id, artists_changed = self.resolve_entity_id(
                            raw_artist, artists_dict, artists_changed, entity_type="Artist"
                        )
                        if artist_id: track_artist_ids.append(artist_id)
                        
                    for raw_genre in track.get(catalog_config.B_TRACK_GENRE, []):
                        genre_id, genres_changed = self.resolve_entity_id(
                            raw_genre, genres_dict, genres_changed, entity_type="Genre"
                        )
                        if genre_id: album_genres.add(genre_id)

                    track_key = f"{album_data[catalog_config.B_ALBUM_ID]}/{track[catalog_config.B_TRACK_FILE]}"
                    
                    track_payload = catalog_config.get_compiled_track_template(
                        track_name=clean_track_name,
                        artist_ids=track_artist_ids,
                        duration_sec=duration_sec
                    )
                    track_payload['db_track_key'] = track_key 

                    if track_key in db_tracks:
                        db_record = db_tracks[track_key]
                        track_payload['i'] = db_record.id
                        track_payload['p'] = db_record.plays
                    else:
                        new_tracks_to_insert.append(
                            Track(
                                album=db_albums[album_data[catalog_config.B_ALBUM_ID]], 
                                mp3=track[catalog_config.B_TRACK_FILE], 
                                lang=lang_models[lang], 
                                plays=0
                            )
                        )
                        track_payload['p'] = 0

                    compiled_tracks.append(track_payload)

                if compiled_tracks:
                    final_album_payload = catalog_config.get_compiled_album_template(
                        uid=album_data[catalog_config.B_ALBUM_ID],
                        album_name=clean_album_name,
                        genre_ids=list(album_genres),
                        years=self.reduce_years(album_years),
                        lang_id=lang_models[lang].id,
                        tracks=compiled_tracks
                    )
                    final_albums.append(final_album_payload)

        # 5. SYNCHRONIZE MYSQL
        if new_tracks_to_insert:
            self.stdout.write(f"Inserting {len(new_tracks_to_insert)} new tracks into MySQL...")
            Track.objects.bulk_create(new_tracks_to_insert)
            
            newly_inserted_tracks = {
                f"{t.album.uid}/{t.mp3}": t.id 
                for t in Track.objects.select_related('album').all()
            }
            
            for album in final_albums:
                for track in album['tk']:
                    if 'i' not in track:
                        track['i'] = newly_inserted_tracks.get(track['db_track_key'], 0)

        for album in final_albums:
            for track in album['tk']:
                track.pop('db_track_key', None)

        # 6. SAVE UPDATED DICTIONARIES
        if artists_changed:
            self.save_dictionary(data_dir / catalog_config.FILE_ARTIST_CORRECTIONS, artists_dict)
        if genres_changed:
            if isinstance(category_data, dict):
                category_data['genre'] = genres_dict
                self.save_dictionary(data_dir / catalog_config.FILE_CATEGORY, category_data)

        # 7. EXPORT FINAL JSON
        output_path = store_dir / catalog_config.FILE_ALBUMS
        indent_val = None if options['minify'] else 2
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(final_albums, f, indent=indent_val, ensure_ascii=False)

        self.stdout.write(self.style.SUCCESS(f"Successfully compiled {len(final_albums)} albums to albums.json!"))


    # --- HELPER METHODS ---

    def load_dictionary(self, filepath):
        if not filepath.exists(): return [], False
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f), False
        except json.JSONDecodeError:
            return [], False

    def save_dictionary(self, filepath, data):
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def resolve_string(self, raw_string, dictionary_list):
        if not raw_string: return "Unknown"
        raw_string_lower = raw_string.strip().lower()
        
        # --- NEW: Using Centralized Dictionary Keys ---
        for item in dictionary_list:
            match_list = [
                item.get(catalog_config.DICT_NAME, '').lower(), 
                item.get(catalog_config.DICT_AKA, '').lower()
            ]
            match_list.extend([t.lower() for t in item.get(catalog_config.DICT_THESAURUS, []) if t])
            match_list.extend([c.lower() for c in item.get(catalog_config.DICT_CORRECTION, []) if c])
            
            if raw_string_lower in match_list:
                return item.get(catalog_config.DICT_NAME)
        return raw_string.strip()

    def resolve_entity_id(self, raw_name, dict_list, changed_flag, entity_type):
        if not raw_name: return None, changed_flag
        clean_name = raw_name.strip()
        search_name = clean_name.lower()

        # --- NEW: Using Centralized Dictionary Keys ---
        id_key = catalog_config.DICT_ARTIST_ID if entity_type == 'Artist' else catalog_config.DICT_GENRE_ID

        def get_next_id():
            valid_ids = [item.get(id_key) for item in dict_list if isinstance(item.get(id_key), int)]
            return max(valid_ids, default=0) + 1

        for item in dict_list:
            match_list = [
                item.get(catalog_config.DICT_NAME, '').lower(), 
                item.get(catalog_config.DICT_AKA, '').lower()
            ]
            match_list.extend([t.lower() for t in item.get(catalog_config.DICT_THESAURUS, []) if t])
            match_list.extend([c.lower() for c in item.get(catalog_config.DICT_CORRECTION, []) if c])
            
            if search_name in match_list:
                if id_key not in item:
                    item[id_key] = get_next_id()
                    self.stdout.write(self.style.WARNING(f"  [Fixed] Assigned missing ID {item[id_key]} to {entity_type}: '{item[catalog_config.DICT_NAME]}'"))
                    changed_flag = True
                return item[id_key], changed_flag

        new_id = get_next_id()
        
        if entity_type == 'Artist':
            new_entry = catalog_config.get_new_artist_template(new_id, clean_name)
        else:
            new_entry = catalog_config.get_new_genre_template(new_id, clean_name)
            
        dict_list.append(new_entry)
        
        self.stdout.write(self.style.WARNING(f"  [Auto-Added] New {entity_type}: '{clean_name}' (ID: {new_id})"))
        return new_id, True

    def parse_duration(self, duration_str):
        try:
            parts = [int(p) for p in duration_str.split(':')]
            if len(parts) == 2: return parts[0] * 60 + parts[1]
            elif len(parts) == 3: return parts[0] * 3600 + parts[1] * 60 + parts[2]
        except (ValueError, AttributeError): pass
        return 0

    def extract_years(self, raw_year_str):
        matches = re.findall(r'\b(19\d{2}|20\d{2})\b', str(raw_year_str))
        return [int(m) for m in matches]

    def reduce_years(self, year_list):
        if not year_list: return []
        counter = Counter(year_list)
        max_freq = max(counter.values())
        return [year for year, count in counter.items() if count == max_freq]