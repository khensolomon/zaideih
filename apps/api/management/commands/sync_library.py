"""
Sync Library Command (sync_library.py)
======================================

Description:
A workspace tool for safely moving album directories back and forth between 
Google Cloud Storage and your local development environment. Allows you to 
download messy albums locally, fix ID3 tags or replace MP3s, and push a 
pristine copy back to the cloud.

Features:
- Structural Mirroring: Guarantees the local directory structure perfectly matches the GCS layout.
- Bulletproof Directory Handling: Automatically resolves GCS "Directory Marker" bugs (0-byte blobs ending with a slash) to prevent FileExistsErrors.
- Selective Syncing: Target specific artist or album directories rather than downloading gigabytes of data.

Usage:
# Download an album from GCS to your local workspace to edit tags
python manage.py sync_library --download zola/Lengtong/Ka.Zua.Ngaih

# Upload the fixed album back to GCS (overwriting the old one)
python manage.py sync_library --upload zola/Lengtong/Ka.Zua.Ngaih
"""
import os
from pathlib import Path
from django.core.management.base import BaseCommand
from django.conf import settings
from google.cloud import storage

from api import catalog_config

class Command(BaseCommand):
    help = 'Pulls or pushes music directories between Google Cloud Storage and local workspace.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--download', 
            type=str, 
            help="Path to download from GCS to local (e.g., 'zola/Lengtong/Ka.Zua.Ngaih')"
        )
        parser.add_argument(
            '--upload', 
            type=str, 
            help="Path to upload from local to GCS (e.g., 'zola/Lengtong/Ka.Zua.Ngaih')"
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

        # Initialize GCS Client
        client = storage.Client()
        bucket = client.bucket(settings.BUCKETNAME)
        
        # Base Local Directory: settings.STORAGE_DIR / 'music'
        base_local_dir = Path(settings.STORAGE_DIR) / catalog_config.DIR_MUSIC

        # --- MODE 1: DOWNLOAD FROM CLOUD ---
        if download_target:
            target_path = download_target.strip('/')
            gcs_prefix = f"{catalog_config.DIR_MUSIC}/{target_path}"
            
            self.stdout.write(self.style.SUCCESS(f"Connecting to GCS to download: {gcs_prefix}"))
            blobs = list(bucket.list_blobs(prefix=gcs_prefix))
            
            if not blobs:
                self.stderr.write(self.style.WARNING(f"No files found in GCS for path: {gcs_prefix}"))
                return

            downloaded_count = 0
            for blob in blobs:
                # 1. Skip GCS directory markers (0-byte blobs ending with '/')
                if blob.name.endswith('/'):
                    continue

                # Reconstruct exact local path mirroring GCS
                relative_blob_path = blob.name.replace(f"{catalog_config.DIR_MUSIC}/", "", 1)
                local_file_path = base_local_dir / relative_blob_path
                local_dir = os.path.dirname(local_file_path)
                
                # 2. Bulletproof directory creation
                if os.path.exists(local_dir) and not os.path.isdir(local_dir):
                    os.remove(local_dir)
                
                os.makedirs(local_dir, exist_ok=True)
                
                self.stdout.write(f"  ⬇ Downloading: {relative_blob_path}")
                blob.download_to_filename(str(local_file_path))
                downloaded_count += 1
                
            self.stdout.write(self.style.SUCCESS(f"Successfully downloaded {downloaded_count} files to workspace!"))

        # --- MODE 2: UPLOAD TO CLOUD ---
        if upload_target:
            target_path = upload_target.strip('/')
            local_target_dir = base_local_dir / target_path
            
            if not local_target_dir.exists() or not local_target_dir.is_dir():
                self.stderr.write(self.style.ERROR(f"Local directory not found: {local_target_dir}"))
                return

            self.stdout.write(self.style.SUCCESS(f"Preparing to upload local directory: {local_target_dir}"))
            
            uploaded_count = 0
            for root, _, files in os.walk(local_target_dir):
                for file in files:
                    if file.startswith('.'): continue
                    
                    local_file_path = Path(root) / file
                    relative_path = local_file_path.relative_to(base_local_dir)
                    gcs_blob_path = f"{catalog_config.DIR_MUSIC}/{relative_path}".replace('\\', '/')
                    
                    self.stdout.write(f"  ⬆ Uploading: {relative_path}")
                    blob = bucket.blob(gcs_blob_path)
                    blob.upload_from_filename(str(local_file_path))
                    uploaded_count += 1

            self.stdout.write(self.style.SUCCESS(f"Successfully uploaded {uploaded_count} files to GCS!"))
            self.stdout.write(self.style.WARNING("Note: Remember to run 'scan_library' if you added new tracks or changed ID3 tags!"))