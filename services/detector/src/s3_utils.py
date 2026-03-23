"""S3 download utility for the detector service."""

from __future__ import annotations

import logging

import boto3

from . import config

logger = logging.getLogger(__name__)

_s3_client = None


def _get_s3_client():
    global _s3_client
    if _s3_client is None:
        # On ECS, credentials come from the task role via the default credential chain.
        # Only set explicit credentials when provided (local development).
        kwargs = {"region_name": config.AWS_REGION}
        if config.AWS_ACCESS_KEY_ID and config.AWS_SECRET_ACCESS_KEY:
            kwargs["aws_access_key_id"] = config.AWS_ACCESS_KEY_ID
            kwargs["aws_secret_access_key"] = config.AWS_SECRET_ACCESS_KEY
        _s3_client = boto3.client("s3", **kwargs)
    return _s3_client


def download_file(s3_key: str, local_path: str) -> None:
    """Download a file from S3 to a local path."""
    logger.info("Downloading s3://%s/%s -> %s", config.AWS_S3_BUCKET, s3_key, local_path)
    client = _get_s3_client()
    client.download_file(config.AWS_S3_BUCKET, s3_key, local_path)
    logger.info("Download complete: %s", local_path)
