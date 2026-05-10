"""
Storage Backend Abstraction
===========================

Provides a unified interface over Google Cloud Storage and Cloudflare R2
(S3-compatible). Used by sync_library, scan_library, and audio streaming.

The active backend is controlled by `settings.STORAGE_BACKEND` (loaded from .env).

Required Django settings:
    STORAGE_BACKEND         - 'gcs' or 'r2'

For GCS:
    GCS_BUCKETNAME          - Your GCS bucket name
    (auth via standard Google ADC: service-account env var or `gcloud auth`)

For R2:
    R2_BUCKETNAME           - Your R2 bucket name
    R2_ACCOUNT_ID           - Your Cloudflare account ID
    R2_ACCESS_ID        - R2 API token access key
    R2_SECRET_KEY    - R2 API token secret
"""
from collections import namedtuple
from django.conf import settings


# Normalized representation of an object in storage.
# Both backends return iterables of these from list_objects().
ObjectRef = namedtuple('ObjectRef', ['key', 'size'])


# ---------------------------------------------------------------------------
# Base interface
# ---------------------------------------------------------------------------
class StorageBackend:
    """Interface that all backends must implement."""

    # Subclasses set this in __init__
    bucket_name = None

    def list_objects(self, prefix):
        """Yield ObjectRef for every object whose key starts with `prefix`.
        Directory markers (0-byte keys ending with '/') are filtered out."""
        raise NotImplementedError

    def download_to_filename(self, key, local_path):
        """Download object `key` to local file `local_path`."""
        raise NotImplementedError

    def upload_from_filename(self, local_path, key):
        """Upload local file `local_path` to object `key`."""
        raise NotImplementedError

    def get_object_metadata(self, key):
        """Return ObjectRef if the object exists, otherwise None.
        Must NOT raise on missing objects."""
        raise NotImplementedError

    def download_range(self, key, first_byte, last_byte):
        """Return bytes for the inclusive range [first_byte, last_byte]."""
        raise NotImplementedError

    def open_stream(self, key, chunk_size=8192):
        """Yield chunks of `chunk_size` bytes for the full object."""
        raise NotImplementedError


# ---------------------------------------------------------------------------
# Google Cloud Storage
# ---------------------------------------------------------------------------
class GCSBackend(StorageBackend):
    def __init__(self):
        from google.cloud import storage
        self.bucket_name = settings.GCS_BUCKETNAME
        self._client = storage.Client()
        self._bucket = self._client.bucket(self.bucket_name)

    def list_objects(self, prefix):
        for blob in self._bucket.list_blobs(prefix=prefix):
            if blob.name.endswith('/'):
                continue
            yield ObjectRef(key=blob.name, size=blob.size or 0)

    def download_to_filename(self, key, local_path):
        blob = self._bucket.blob(key)
        blob.download_to_filename(str(local_path))

    def upload_from_filename(self, local_path, key):
        blob = self._bucket.blob(key)
        blob.upload_from_filename(str(local_path))

    def get_object_metadata(self, key):
        blob = self._bucket.get_blob(key)
        if blob is None:
            return None
        return ObjectRef(key=blob.name, size=blob.size or 0)

    def download_range(self, key, first_byte, last_byte):
        # GCS end is inclusive — same semantics as HTTP Range
        blob = self._bucket.blob(key)
        return blob.download_as_bytes(start=first_byte, end=last_byte)

    def open_stream(self, key, chunk_size=8192):
        blob = self._bucket.blob(key)
        with blob.open('rb') as f:
            while chunk := f.read(chunk_size):
                yield chunk


# ---------------------------------------------------------------------------
# Cloudflare R2 (S3-compatible)
# ---------------------------------------------------------------------------
class R2Backend(StorageBackend):
    def __init__(self):
        import boto3
        from botocore.config import Config

        self.bucket_name = settings.R2_BUCKETNAME

        endpoint = f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

        # signature_version='s3v4' is required for R2.
        # region_name='auto' is the R2 convention.
        self._client = boto3.client(
            's3',
            endpoint_url=endpoint,
            aws_access_key_id=settings.R2_ACCESS_ID,
            aws_secret_access_key=settings.R2_SECRET_KEY,
            region_name='auto',
            config=Config(signature_version='s3v4'),
        )

    def list_objects(self, prefix):
        paginator = self._client.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=self.bucket_name, Prefix=prefix):
            for obj in page.get('Contents', []):
                key = obj['Key']
                if key.endswith('/'):
                    continue
                yield ObjectRef(key=key, size=obj.get('Size', 0))

    def download_to_filename(self, key, local_path):
        self._client.download_file(self.bucket_name, key, str(local_path))

    def upload_from_filename(self, local_path, key):
        self._client.upload_file(str(local_path), self.bucket_name, key)

    def get_object_metadata(self, key):
        from botocore.exceptions import ClientError
        try:
            head = self._client.head_object(Bucket=self.bucket_name, Key=key)
        except ClientError as e:
            if e.response.get('Error', {}).get('Code') in ('404', 'NoSuchKey', 'NotFound'):
                return None
            raise
        return ObjectRef(key=key, size=head.get('ContentLength', 0))

    def download_range(self, key, first_byte, last_byte):
        # HTTP Range header is inclusive on both ends
        range_header = f'bytes={first_byte}-{last_byte}'
        resp = self._client.get_object(
            Bucket=self.bucket_name,
            Key=key,
            Range=range_header,
        )
        return resp['Body'].read()

    def open_stream(self, key, chunk_size=8192):
        resp = self._client.get_object(Bucket=self.bucket_name, Key=key)
        body = resp['Body']
        try:
            while True:
                chunk = body.read(chunk_size)
                if not chunk:
                    break
                yield chunk
        finally:
            body.close()


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------
_backend_instance = None


def get_backend():
    """Return the active backend, instantiated lazily and cached."""
    global _backend_instance
    if _backend_instance is not None:
        return _backend_instance

    name = settings.STORAGE_BACKEND.lower()
    if name == 'gcs':
        _backend_instance = GCSBackend()
    elif name == 'r2':
        _backend_instance = R2Backend()
    else:
        raise ValueError(
            f"Unknown STORAGE_BACKEND '{name}'. "
            f"Set STORAGE_BACKEND in .env to 'gcs' or 'r2'."
        )
    return _backend_instance


def get_backend_name():
    """Return the name of the active backend ('gcs' or 'r2'), uppercase."""
    return settings.STORAGE_BACKEND.upper()