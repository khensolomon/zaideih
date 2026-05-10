"""
Sync Library Command (sync_library.py)
======================================

Description:
A workspace tool for safely moving album directories back and forth between 
your active cloud storage backend (GCS or R2) and your local development
environment. Allows you to download messy albums locally, fix ID3 tags or 
replace MP3s, and push a pristine copy back to the cloud.

The active backend is controlled by `STORAGE_BACKEND` in your .env file.

Features:
- Backend-Agnostic: Works with both Google Cloud Storage and Cloudflare R2.
- Structural Mirroring: Local directory structure perfectly matches the cloud layout.
- Bulletproof Directory Handling: Resolves directory marker bugs (0-byte blobs ending with a slash).
- Selective Syncing: Target specific artist or album directories.

Usage:
# Download an album from cloud to your local workspace
python manage.py sync_library --download zola/Lengtong/Ka.Zua.Ngaih

# Upload the fixed album back to cloud (overwriting the old one)
python manage.py sync_library --upload zola/Lengtong/Ka.Zua.Ngaih
"""
import os
from pathlib import Path
from django.core.management.base import BaseCommand
from django.conf import settings

from api import catalog_config
from api.storage_backend import get_backend


class Command(BaseCommand):
    help = 'Pulls or pushes music directories between cloud storage and local workspace.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--download',
            type=str,
            help="Path to download from cloud to local (e.g., 'zola/Lengtong/Ka.Zua.Ngaih')"
        )
        parser.add_argument(
            '--upload',
            type=str,
            help="Path to upload from local to cloud (e.g., 'zola/Lengtong/Ka.Zua.Ngaih')"
        )

    def handle(self, *args, **options):
        download_target = options.get('download')
        upload_target = options.get('upload')

        if not download_target and not upload_target:
            self.stderr.write(self.style.ERROR("You must specify either --download <path> or --upload <path>."))
            return

        if download_target and upload_target:
            self.stderr.write(self.style.ERROR("Please perform one action at a time (either download OR upload)."))
            return

        backend = get_backend()
        backend_name = settings.STORAGE_BACKEND.upper()

        # Base local directory: settings.STORAGE_ROOT / 'music'
        base_local_dir = Path(settings.STORAGE_ROOT) / catalog_config.DIR_MUSIC

        # --- MODE 1: DOWNLOAD FROM CLOUD ---
        if download_target:
            target_path = download_target.strip('/')
            cloud_prefix = f"{catalog_config.DIR_MUSIC}/{target_path}"

            self.stdout.write(self.style.SUCCESS(
                f"Connecting to {backend_name} to download: {cloud_prefix}"
            ))

            objects = list(backend.list_objects(cloud_prefix))

            if not objects:
                self.stderr.write(self.style.WARNING(
                    f"No files found in {backend_name} for path: {cloud_prefix}"
                ))
                return

            downloaded_count = 0
            for obj in objects:
                # Reconstruct local path mirroring cloud layout
                relative_key = obj.key.replace(f"{catalog_config.DIR_MUSIC}/", "", 1)
                local_file_path = base_local_dir / relative_key
                local_dir = os.path.dirname(local_file_path)

                # Bulletproof directory creation:
                # if a file with the directory's name exists, remove it
                if os.path.exists(local_dir) and not os.path.isdir(local_dir):
                    os.remove(local_dir)

                os.makedirs(local_dir, exist_ok=True)

                self.stdout.write(f"  ⬇ Downloading: {relative_key}")
                backend.download_to_filename(obj.key, local_file_path)
                downloaded_count += 1

            self.stdout.write(self.style.SUCCESS(
                f"Successfully downloaded {downloaded_count} files to workspace!"
            ))

        # --- MODE 2: UPLOAD TO CLOUD ---
        if upload_target:
            target_path = upload_target.strip('/')
            local_target_dir = base_local_dir / target_path

            if not local_target_dir.exists() or not local_target_dir.is_dir():
                self.stderr.write(self.style.ERROR(
                    f"Local directory not found: {local_target_dir}"
                ))
                return

            self.stdout.write(self.style.SUCCESS(
                f"Preparing to upload local directory to {backend_name}: {local_target_dir}"
            ))

            uploaded_count = 0
            for root, _, files in os.walk(local_target_dir):
                for file in files:
                    if file.startswith('.'):
                        continue

                    local_file_path = Path(root) / file
                    relative_path = local_file_path.relative_to(base_local_dir)
                    cloud_key = f"{catalog_config.DIR_MUSIC}/{relative_path}".replace('\\', '/')

                    self.stdout.write(f"  ⬆ Uploading: {relative_path}")
                    backend.upload_from_filename(local_file_path, cloud_key)
                    uploaded_count += 1

            self.stdout.write(self.style.SUCCESS(
                f"Successfully uploaded {uploaded_count} files to {backend_name}!"
            ))
            self.stdout.write(self.style.WARNING(
                "Note: Remember to run 'scan_library' if you added new tracks or changed ID3 tags!"
            ))