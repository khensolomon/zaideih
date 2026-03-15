import json
import hashlib
from pathlib import Path

from django.utils import timezone
from django.core.management.base import BaseCommand
from django.conf import settings

from api import catalog_config

class Command(BaseCommand):
    help = 'Migrates legacy bucket.[lang].json files to the new highly optimized schema.'

    def handle(self, *args, **options):
        store_dir = Path(settings.MEDIA_ROOT) / 'store'
        buckets = list(store_dir.glob('bucket.*.json'))

        if not buckets:
            self.stderr.write(self.style.WARNING("No bucket files found in the store directory."))
            return

        for bucket_path in buckets:
            lang = bucket_path.name.split('.')[1]
            self.stdout.write(f"Migrating {bucket_path.name} (Lang: {lang})...")

            with open(bucket_path, 'r', encoding='utf-8') as f:
                old_data = json.load(f)

            new_data = []
            
            for album in old_data:
                # 3. Fix the "dir" (Remove "music/zola/" or just "zola/")
                old_dir = album.get(catalog_config.B_ALBUM_DIR, '')
                clean_dir = old_dir.replace(f"{catalog_config.DIR_MUSIC}/{lang}/", "")
                clean_dir = clean_dir.replace(f"{lang}/", "").strip('/')

                # 1. Regenerate ID using MD5 Hash
                full_relative_dir = f"{lang}/{clean_dir}"
                new_id = hashlib.md5(full_relative_dir.encode('utf-8')).hexdigest()[:16]

                # 4. Sort Tracks Safely (handles empty strings or "1/12" formats)
                raw_tracks = album.get(catalog_config.B_ALBUM_TRACKS, [])
                sorted_tracks = sorted(raw_tracks, key=lambda x: self.safe_int(x.get(catalog_config.B_TRACK_NUM, '0')))

                # 2, 5 & 6. Reposition & Filter using our Central Config Template
                # This automatically drops "raw", "task", and "meta" because they aren't in the template!
                new_album = catalog_config.get_bucket_album_template(
                    album_id=new_id,
                    album_dir=clean_dir,
                    date_iso=timezone.now().isoformat(),
                    tracks=sorted_tracks
                )
                
                new_data.append(new_album)

            # Overwrite the old bucket with the newly formatted data
            with open(bucket_path, 'w', encoding='utf-8') as f:
                json.dump(new_data, f, indent=2, ensure_ascii=False)

            self.stdout.write(self.style.SUCCESS(f"  -> Successfully migrated {len(new_data)} albums in {bucket_path.name}!\n"))

        self.stdout.write(self.style.SUCCESS("All buckets migrated successfully! You are ready to run compile_catalog."))

    def safe_int(self, value):
        """Safely parses track numbers into integers for accurate sorting."""
        try:
            if isinstance(value, str):
                # Handle cases where track is written as "1/12"
                value = value.split('/')[0]
            return int(value)
        except (ValueError, TypeError):
            # Fallback for tracks without a valid number so they go to the bottom
            return 999