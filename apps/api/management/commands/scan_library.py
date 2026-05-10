"""
Library Scanner Command (scan_library.py)
=========================================

Description:
Scans MP3 files from either Local Disk or the active cloud storage backend
(GCS or R2), extracts their ID3 tags (Title, Artist, Duration, etc.) using 
Mutagen, and merges them into a language-specific `bucket.[lang].json` file.

The active cloud backend is controlled by `STORAGE_BACKEND` in your .env file.

Features:
- Backend-Agnostic: Works with both Google Cloud Storage and Cloudflare R2.
- Dual Environment: Seamlessly scans local folders or downloads temporary
  blobs from the configured cloud backend.
- Auto-Healing: Gracefully handles missing ID3 tags or broken MP3 durations.
- Smart Merging: Updates existing bucket JSONs by directory path without
  overwriting other albums.

Usage:
# Scan a specific folder from the local storage
python manage.py scan_library --src zola/Lengtong

# Scan a specific folder directly from the configured cloud backend
python manage.py scan_library --src zola/Lengtong --cloud
"""
import os
import json
import hashlib
import tempfile
from pathlib import Path
from mutagen.easyid3 import EasyID3
from mutagen.mp3 import MP3

from django.utils import timezone
from django.core.management.base import BaseCommand
from django.conf import settings

from api import catalog_config
from api.storage_backend import get_backend


class Command(BaseCommand):
    help = 'Scans MP3s (Local or Cloud), parses ID3 metadata, and merges into bucket.[lang].json.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--src',
            type=str,
            required=True,
            help="Source path relative to music directory (e.g., 'english' or 'falam/SINGLE')"
        )
        parser.add_argument(
            '--cloud',
            action='store_true',
            help="Scan directly from the configured cloud backend instead of local disk."
        )

    def handle(self, *args, **options):
        src_arg = options['src'].strip('/')
        is_cloud = options['cloud']

        # Language is always the first segment of the src argument
        lang = Path(src_arg).parts[0]
        bucket_filename = catalog_config.get_bucket_filename(lang)

        # 1. LOAD EXISTING BUCKET DATA (FOR MERGING)
        bucket_data = self.load_bucket(bucket_filename)

        # Convert to dictionary keyed by 'dir'
        bucket_dict = {}
        for album in bucket_data:
            old_dir = album.get(catalog_config.B_ALBUM_DIR, '')
            # Smooth migration: strip language prefix if present from older scans
            clean_dir = old_dir[len(lang)+1:] if old_dir.startswith(f"{lang}/") else old_dir
            album[catalog_config.B_ALBUM_DIR] = clean_dir
            bucket_dict[clean_dir] = album

        processed_albums = 0
        processed_tracks = 0

        # --- MODE 1: CLOUD SCANNING ---
        if is_cloud:
            backend = get_backend()
            backend_name = settings.STORAGE_BACKEND.upper()

            self.stdout.write(self.style.SUCCESS(
                f"Scanning Scope: {backend_name} bucket '{backend.bucket_name}' "
                f"-> {catalog_config.DIR_MUSIC}/{src_arg}"
            ))
            self.stdout.write("Fetching Cloud Directory Tree...")

            prefix = f"{catalog_config.DIR_MUSIC}/{src_arg}"
            cloud_folders = {}

            # Group flat object listing into virtual directories
            for obj in backend.list_objects(prefix):
                if not obj.key.lower().endswith('.mp3'):
                    continue
                folder_path = os.path.dirname(obj.key)
                cloud_folders.setdefault(folder_path, []).append(obj)

            lang_prefix = f"{catalog_config.DIR_MUSIC}/{lang}"

            for folder, obj_list in cloud_folders.items():
                # Extract album dir relative to the language prefix
                if folder == lang_prefix:
                    album_dir = ""
                else:
                    album_dir = folder.replace(lang_prefix + "/", "", 1)

                self.stdout.write(f"Processing Cloud Album: {album_dir or 'Root'}")
                a_count, t_count = self._process_album_batch(
                    album_dir, lang, obj_list, bucket_dict,
                    is_cloud=True, backend=backend,
                )
                processed_albums += a_count
                processed_tracks += t_count

        # --- MODE 2: LOCAL SCANNING ---
        else:
            base_music_dir = Path(settings.STORAGE_ROOT) / catalog_config.DIR_MUSIC
            target_dir = base_music_dir / src_arg
            lang_dir = base_music_dir / lang

            if not target_dir.exists():
                self.stderr.write(self.style.ERROR(
                    f"Target directory '{target_dir}' does not exist on local disk."
                ))
                return

            self.stdout.write(self.style.SUCCESS(f"Scanning Scope: Local Disk -> {target_dir}"))

            for root, dirs, files in os.walk(target_dir):
                mp3_files = [Path(root) / f for f in files if f.lower().endswith('.mp3')]
                if not mp3_files:
                    continue

                current_dir_path = Path(root)
                album_dir = str(current_dir_path.relative_to(lang_dir)).replace('\\', '/')
                if album_dir == '.':
                    album_dir = ''

                self.stdout.write(f"Processing Local Album: {album_dir or 'Root'}")
                a_count, t_count = self._process_album_batch(
                    album_dir, lang, mp3_files, bucket_dict,
                    is_cloud=False, backend=None,
                )
                processed_albums += a_count
                processed_tracks += t_count

        # 3. SAVE FLUSHED BUCKET
        self.stdout.write(f'Saving {processed_albums} albums to {bucket_filename}...')
        self.save_bucket(bucket_filename, list(bucket_dict.values()))

        self.stdout.write(self.style.SUCCESS(
            f'Scan Complete! Processed {processed_albums} albums and {processed_tracks} tracks.'
        ))

    # --- Helper Methods ---
    def _process_album_batch(self, album_dir, lang, items, bucket_dict, is_cloud, backend):
        """
        Processes a list of local Path objects or cloud ObjectRefs, extracting
        metadata and returning (album_count, track_count).
        """
        full_relative_dir = f"{lang}/{album_dir}".strip('/')
        album_id = hashlib.md5(full_relative_dir.encode('utf-8')).hexdigest()[:16]

        album_tracks = []

        for item in items:
            if is_cloud:
                # `item` is an ObjectRef from the backend
                mp3_filename = item.key.split('/')[-1]
                # Download to temp file so Mutagen can read the ID3 tags
                with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as tf:
                    temp_path = tf.name
                try:
                    backend.download_to_filename(item.key, temp_path)
                    track_meta = self.extract_metadata(Path(temp_path), mp3_filename)
                finally:
                    if os.path.exists(temp_path):
                        os.remove(temp_path)
            else:
                # `item` is a local Path
                mp3_filename = item.name
                track_meta = self.extract_metadata(item, mp3_filename)

            if track_meta:
                album_tracks.append(track_meta)
            else:
                self.stdout.write(self.style.WARNING(
                    f"  [Skipped] Invalid ID3 or zero duration: {mp3_filename}"
                ))

        if album_tracks:
            bucket_dict[album_dir] = catalog_config.get_bucket_album_template(
                album_id=album_id,
                album_dir=album_dir,
                date_iso=timezone.now().isoformat(),
                tracks=sorted(
                    album_tracks,
                    key=lambda x: self.safe_int(x.get(catalog_config.B_TRACK_NUM, '0'))
                )
            )
            return 1, len(album_tracks)

        return 0, 0

    def extract_metadata(self, file_path, filename):
        """Safely extracts ID3 tags using Mutagen"""
        try:
            audio = MP3(file_path, ID3=EasyID3)

            if not audio.info or int(audio.info.length) <= 0:
                return None

            length_secs = int(audio.info.length)
            mins, secs = divmod(length_secs, 60)
            duration_str = f"{mins}:{secs:02d}"

            title = audio.get('title', [filename.replace('.mp3', '')])[0]
            album = audio.get('album', [''])[0]
            artist = audio.get('artist', [])
            albumartist = audio.get('albumartist', [])
            genre = audio.get('genre', [])

            track_raw = audio.get('tracknumber', [''])[0]
            track_num = str(track_raw).split('/')[0] if track_raw else ""

            date_raw = audio.get('date', [''])[0]
            year = str(date_raw)[:4] if date_raw else ""

            return catalog_config.get_bucket_track_template(
                filename=filename,
                title=title,
                artist=artist,
                albumartist=albumartist,
                album=album,
                genre=genre,
                track_num=track_num,
                year=year,
                duration=duration_str
            )

        except Exception as e:
            self.stderr.write(self.style.WARNING(
                f"  [Warning] ID3 read failed for {filename}: {e}"
            ))
            return None

    def load_bucket(self, filename):
        filepath = os.path.join(settings.STORE_DIR, filename)
        try:
            with open(filepath, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return []

    def save_bucket(self, filename, data):
        filepath = os.path.join(settings.STORE_DIR, filename)
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def safe_int(self, value):
        try:
            return int(value)
        except (ValueError, TypeError):
            return 999