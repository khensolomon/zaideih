"""
Sanity check the connection between Django and the audio Worker.

Usage:
    python manage.py check_d1

Verifies:
  - WORKER_URL setting is configured
  - APP_SECRET_SHARED setting is configured
  - The Worker is reachable
  - The shared HMAC secret is correct (Worker accepts our signature)
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

# from worker import services
import services


class Command(BaseCommand):
    help = "Verify Django ↔ audio Worker connectivity and HMAC alignment."

    def handle(self, *args, **options):
        # 1. Settings are present.
        if not getattr(settings, "WORKER_URL", None):
            raise CommandError("WORKER_URL is not set in settings.")
        if not getattr(settings, "APP_SECRET_SHARED", None):
            raise CommandError("APP_SECRET_SHARED is not set in settings.")

        self.stdout.write(f"Worker URL: {settings.WORKER_URL}")
        secret_preview = (
            settings.APP_SECRET_SHARED[:4]
            + "..."
            + settings.APP_SECRET_SHARED[-4:]
        )
        self.stdout.write(f"Secret:     {secret_preview} (length {len(settings.APP_SECRET_SHARED)})")

        # 2. Round-trip ping with HMAC.
        ok, msg = services.ping()
        if ok:
            self.stdout.write(self.style.SUCCESS(f"\nConnection OK: {msg}"))
        else:
            self.stdout.write(self.style.ERROR(f"\nConnection FAILED: {msg}"))
            self.stdout.write(
                "\nTroubleshooting:\n"
                "  - Is the Worker deployed and routing /sync/ping?\n"
                "  - Are APP_SECRET_SHARED (Django) and WORKER_SECRET_SHARED\n"
                "    (Worker) the EXACT SAME value?\n"
                "  - Check `wrangler tail` to see what the Worker received.\n"
            )
            raise CommandError("Connection check failed.")
