from django.core.management.base import BaseCommand
from django.db import connection
from api.models import Track, Lang

class Command(BaseCommand):
    help = 'Migrates play counts from the legacy "file" table to the new "track" table.'

    def handle(self, *args, **options):
        self.stdout.write("Starting Play Count Migration...")

        # 1. Map Language IDs to Names (e.g., 1 -> 'zola')
        langs = {l.id: l.name for l in Lang.objects.all()}

        # 2. Build In-Memory Map of New Tracks
        self.stdout.write("Fetching new tracks from database...")
        tracks = Track.objects.select_related('album').all()
        track_map = {}
        
        for t in tracks:
            # Reconstruct the absolute path: e.g., "zola/Lengtong/Ka.Zua.Ngaih/Track.mp3"
            full_path = f"{t.album.folder_path}/{t.mp3}"
            track_map[full_path] = t

        # 3. Read Legacy Data using Raw SQL
        self.stdout.write("Fetching old play counts from legacy 'file' table...")
        with connection.cursor() as cursor:
            try:
                # We use raw SQL because the old `File` model no longer exists in Django
                cursor.execute("SELECT plays, lang, dir FROM file")
                old_files = cursor.fetchall()
            except Exception as e:
                self.stderr.write(self.style.ERROR(f"Could not read from 'file' table. Does it still exist? Error: {e}"))
                return

        # 4. Match and Prepare Updates
        tracks_to_update = []
        matched = 0
        missed = 0
        skipped_zero = 0

        for plays, lang_id, old_dir in old_files:
            # Skip tracks with 0 plays to save processing time
            if not plays or plays <= 0:
                skipped_zero += 1
                continue 

            lang_name = langs.get(lang_id, '')
            clean_old_dir = old_dir.replace('\\', '/')

            # Ensure the old path has the language prefix for a perfect match
            if clean_old_dir.startswith(f"{lang_name}/"):
                expected_path = clean_old_dir
            else:
                expected_path = f"{lang_name}/{clean_old_dir}".strip('/')

            # Match against the new Track table
            if expected_path in track_map:
                track = track_map[expected_path]
                
                # Only update if the old plays are higher than current plays
                if plays > track.plays:
                    track.plays = plays
                    tracks_to_update.append(track)
                matched += 1
            else:
                missed += 1

        # 5. Execute Bulk Update
        if tracks_to_update:
            self.stdout.write(f"Committing {len(tracks_to_update)} updated play counts to MySQL...")
            # bulk_update is incredibly fast, even for 50,000 rows
            Track.objects.bulk_update(tracks_to_update, ['plays'], batch_size=2000)

        # 6. Summary Report
        self.stdout.write(self.style.SUCCESS(
            f"Migration Complete!\n"
            f" - Successfully Matched: {matched}\n"
            f" - Missed (Not in new DB): {missed}\n"
            f" - Skipped (0 Plays): {skipped_zero}"
        ))

        if missed > 0:
            self.stdout.write(self.style.WARNING(
                "Note: 'Missed' tracks usually mean the old MP3 was deleted from the hard drive, "
                "or the directory was renamed before the new scan."
            ))