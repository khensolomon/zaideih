"""
Bulk-sync command for pushing all tracks from Django to the Worker's D1.

Use cases:
  - Initial setup: push every existing track to a fresh D1.
  - Recovery: re-sync everything if D1 drifted (signal failures, schema
    change, etc.).
  - Subset sync: re-push tracks for a specific album.

Usage:
    python manage.py sync_d1 --all
    python manage.py sync_d1 --album <album_id>
    python manage.py sync_d1 --track <track_id>

Output is one line per track with its result, plus a summary at the end.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError

# Replace with the actual location of your models.
from api.models import Track

# from worker import services
# import worker.services as services
import services


class Command(BaseCommand):
    help = "Sync tracks from Django to the audio Worker's D1."

    def add_arguments(self, parser):
        group = parser.add_mutually_exclusive_group(required=True)
        group.add_argument(
            "--all", action="store_true",
            help="Sync every track in the database.",
        )
        group.add_argument(
            "--album", type=int,
            help="Sync all tracks belonging to a specific album id.",
        )
        group.add_argument(
            "--track", type=int,
            help="Sync a single track by id.",
        )
        parser.add_argument(
            "--limit", type=int, default=None,
            help="Stop after N tracks (for --all). Useful for dry-runs.",
        )
        parser.add_argument(
            "--quiet", action="store_true",
            help="Print only the summary, not per-track lines.",
        )

    def handle(self, *args, **options):
        # Quick sanity check: can we even reach the Worker?
        ok, msg = services.ping()
        if not ok:
            raise CommandError(f"Cannot reach Worker: {msg}")
        self.stdout.write(self.style.SUCCESS(f"Worker reachable: {msg}"))

        if options["all"]:
            qs = Track.objects.select_related("album").order_by("id")
            if options["limit"]:
                qs = qs[: options["limit"]]
        elif options["album"]:
            qs = Track.objects.select_related("album").filter(
                album_id=options["album"]
            ).order_by("id")
        else:  # --track
            qs = Track.objects.select_related("album").filter(
                id=options["track"]
            )

        total = qs.count()
        if total == 0:
            self.stdout.write(self.style.WARNING("No tracks matched."))
            return

        self.stdout.write(f"Syncing {total} track(s) to Worker...")

        ok_count = 0
        fail_count = 0

        for track in qs.iterator(chunk_size=200):
            try:
                folder_path = track.album.folder_path
            except Exception as exc:
                fail_count += 1
                if not options["quiet"]:
                    self.stdout.write(self.style.ERROR(
                        f"  track {track.id}: cannot resolve album ({exc})"
                    ))
                continue

            success = services.upsert_track(
                track_id=track.id,
                folder_path=folder_path,
                mp3=track.mp3,
            )

            if success:
                ok_count += 1
                if not options["quiet"]:
                    self.stdout.write(f"  track {track.id}: ok")
            else:
                fail_count += 1
                if not options["quiet"]:
                    self.stdout.write(self.style.ERROR(
                        f"  track {track.id}: FAILED (see logs)"
                    ))

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(f"Successful: {ok_count}"))
        if fail_count:
            self.stdout.write(self.style.ERROR(f"Failed:     {fail_count}"))
        else:
            self.stdout.write(f"Failed:     0")

        if fail_count:
            raise CommandError(
                f"{fail_count} track(s) failed to sync. "
                f"Check logs and re-run for failures."
            )
