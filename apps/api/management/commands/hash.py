import hashlib
# import os
# import json
# from pathlib import Path
# from mutagen.easyid3 import EasyID3
# from mutagen.mp3 import MP3
# from mutagen.id3 import ID3NoHeaderError

from django.core.management.base import BaseCommand
from django.conf import settings


class Command(BaseCommand):
    help = 'Scans the STORAGE_DIR for MP3s, extracts ID3 tags, and registers them to the DB and JSON stores.'

    def handle(self, *args, **kwargs):
        # self.stdout.write(self.style.SUCCESS('Starting Library Scan...'))
        # self.stdout.write('hash...')
        # self.stderr.write(self.style.ERROR(f"STORAGE_DIR '{storage_path}' does not exist."))
        # self.stdout.write(self.style.SUCCESS(f'Scan Complete! Added {added_count} new tracks.'))

        # data = "music/zola/Agape/Agape No.1"
        data = "zola/Agape/Agape No.1"

        # Encode the string to bytes using utf-8
        encoded_data = data.encode('utf-8')

        # Create an MD5 hash object and update it with the data
        md5_hash = hashlib.md5(encoded_data)

        # Get the hash in a human-readable hexadecimal format
        md5_hex_digest = md5_hash.hexdigest()[:16]

        self.stdout.write(f"Original string: {data}")
        self.stdout.write(f"MD5 hash: {md5_hex_digest}")


        # Create an SHA-1 hash object and update it with the data
        sha1_hash = hashlib.sha1(encoded_data)

        # Get the hash digest in hexadecimal format
        sha1_hex_digest = sha1_hash.hexdigest()[:16]

        # Print the result
        self.stdout.write(f"SHA-1 hash: {sha1_hex_digest}")
