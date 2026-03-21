"""Supabase client and job lifecycle helpers for the detector service."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from supabase import create_client, Client

from . import config

logger = logging.getLogger(__name__)

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
    return _client


# ---------------------------------------------------------------------------
# Job queue helpers
# ---------------------------------------------------------------------------

def poll_queued_jobs(limit: int = 1) -> list[dict[str, Any]]:
    """Fetch queued video.detect jobs ordered by priority then creation time."""
    client = get_client()
    resp = (
        client.table("job_queue")
        .select("id, project_id, user_id, type, payload, status, attempts, max_attempts")
        .eq("type", "video.detect")
        .eq("status", "queued")
        .order("priority", desc=True)
        .order("created_at")
        .limit(limit)
        .execute()
    )
    return resp.data or []


def claim_job(job_id: str) -> bool:
    """Atomically claim a job by setting status to processing (only if still queued)."""
    client = get_client()
    resp = (
        client.table("job_queue")
        .update({
            "status": "processing",
            "started_at": _now_iso(),
        })
        .eq("id", job_id)
        .eq("status", "queued")
        .execute()
    )
    # If no rows were updated, another worker claimed it
    return len(resp.data or []) > 0


def increment_attempts(job_id: str) -> None:
    """Increment the attempts counter for a job."""
    client = get_client()
    # Read current value then increment (no RPC function available)
    resp = client.table("job_queue").select("attempts").eq("id", job_id).single().execute()
    if resp.data:
        client.table("job_queue").update({
            "attempts": resp.data["attempts"] + 1,
        }).eq("id", job_id).execute()


def update_job_progress(job_id: str, percent: int) -> None:
    client = get_client()
    client.table("job_queue").update({
        "progress_percent": max(0, min(100, percent)),
    }).eq("id", job_id).execute()


def complete_job(job_id: str) -> None:
    client = get_client()
    client.table("job_queue").update({
        "status": "complete",
        "progress_percent": 100,
        "completed_at": _now_iso(),
    }).eq("id", job_id).execute()


def fail_job(job_id: str, error_message: str) -> None:
    client = get_client()
    client.table("job_queue").update({
        "status": "failed",
        "error_message": error_message[:2000],
        "completed_at": _now_iso(),
    }).eq("id", job_id).execute()


# ---------------------------------------------------------------------------
# DB update helpers
# ---------------------------------------------------------------------------

def insert_cut_map(video_id: str, cuts_json: list[dict[str, Any]]) -> str:
    """Insert a cut_map row and return its id."""
    client = get_client()
    resp = (
        client.table("cut_maps")
        .insert({
            "video_id": video_id,
            "version": 1,
            "cuts_json": cuts_json,
        })
        .execute()
    )
    if not resp.data:
        raise RuntimeError("Failed to insert cut_map")
    return resp.data[0]["id"]


def update_project_status(project_id: str, status: str) -> None:
    client = get_client()
    resp = client.table("projects").update({"status": status}).eq("id", project_id).execute()
    if not resp.data:
        raise RuntimeError(f"Failed to update project {project_id} status to {status}")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
