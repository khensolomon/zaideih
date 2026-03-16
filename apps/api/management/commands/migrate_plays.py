"""
Play Count Migrator Command (migrate_plays.py)
==============================================

Description:
A one-time MySQL migration script designed to rescue historical play counts 
from the deprecated legacy `file` table and merge them into the newly 
normalized `track` table.

Features:
- Path Reconstruction: Re-builds full MP3 paths dynamically to match old records with new normalized structures.
- Raw SQL Execution: Safely reads from tables that no longer exist in Django's Models.
- High Performance: Utilizes Django's `bulk_update` to commit tens of thousands of rows to MySQL in seconds.
- Safety Checks: Skips entries with 0 plays to save processing time and ignores missing/deleted files.

Usage:
# Ensure you have run 'compile_catalog' first so the new Track table is populated!
python manage.py migrate_plays
"""
from django.core.management.base import BaseCommand
from django.db import connection
from api.models import Track, Lang

class Command(BaseCommand):
    help = 'Migrates play counts from the legacy "file" table to the new "track" table.'

    def handle(self, *args, **options):
        self.stdout.write("Starting Play Count Migration...")

        # 1. Map Language IDs to Names
        langs = {l.id: l.name for l in Lang.objects.all()}

        # 2. Build In-Memory Map of New Tracks
        self.stdout.write("Fetching new tracks from database...")
        tracks = Track.objects.select_related('album').all()
        track_map = {}
        
        for t in tracks:
            full_path = f"{t.album.folder_path}/{t.mp3}"
            track_map[full_path] = t

        # 3. Read Legacy Data using Raw SQL
        self.stdout.write("Fetching old play counts from legacy 'file' table...")
        with connection.cursor() as cursor:
            try:
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
            if not plays or plays <= 0:
                skipped_zero += 1
                continue 

            lang_name = langs.get(lang_id, '')
            clean_old_dir = old_dir.replace('\\', '/')

            if clean_old_dir.startswith(f"{lang_name}/"):
                expected_path = clean_old_dir
            else:
                expected_path = f"{lang_name}/{clean_old_dir}".strip('/')

            # Match against the new Track table
            if expected_path in track_map:
                track = track_map[expected_path]
                if plays > track.plays:
                    track.plays = plays
                    tracks_to_update.append(track)
                matched += 1
            else:
                missed += 1

        # 5. Execute Bulk Update
        if tracks_to_update:
            self.stdout.write(f"Committing {len(tracks_to_update)} updated play counts to MySQL...")
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