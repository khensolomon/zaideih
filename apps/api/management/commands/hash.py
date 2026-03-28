import hashlib
from django.core.management.base import BaseCommand

class Command(BaseCommand):
    help = 'Tests various hashing algorithms (MD5, SHA-1, SHA-256, SHA-512) on a string.'

    def add_arguments(self, parser):
        parser.add_argument(
            '-s', '--string', 
            type=str, 
            help='The string to hash. Uses a default if not provided.'
        )
        parser.add_argument(
            '-t', '--trim', 
            type=int, 
            help='Number of characters to trim the hash to. Omit for the full hash.'
        )

    def handle(self, *args, **options):
        default_string = "zola/Agape/Agape No.1"
        target_string = options.get('string') or default_string
        trim_length = options.get('trim')

        self.stdout.write(self.style.WARNING(f"Original string: '{target_string}'"))
        if trim_length:
            self.stdout.write(self.style.WARNING(f"Trimming to:     {trim_length} characters\n"))
        else:
            self.stdout.write(self.style.WARNING("Outputting:      Full length hashes\n"))

        encoded_data = target_string.encode('utf-8')

        # Dictionary mapping the display name to the hashlib function
        algorithms = {
            'MD5': hashlib.md5,
            'SHA-1': hashlib.sha1,
            'SHA-256': hashlib.sha256,
            'SHA-512': hashlib.sha512
        }

        for name, algo_func in algorithms.items():
            # Generate the hash
            hash_obj = algo_func(encoded_data)
            hex_digest = hash_obj.hexdigest()
            
            # Apply trimming if the argument was provided
            if trim_length:
                hex_digest = hex_digest[:trim_length]
                
            # .ljust(8) keeps the output cleanly aligned in your terminal
            self.stdout.write(self.style.SUCCESS(f"{name.ljust(8)}: {hex_digest}"))