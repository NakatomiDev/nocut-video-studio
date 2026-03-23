"""Supabase client and job lifecycle helpers for the AI engine service."""

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
    """Fetch queued ai.fill jobs ordered by priority then creation time."""
    client = get_client()
    resp = (
        client.table("job_queue")
        .select("id, project_id, user_id, type, payload, status, attempts, max_attempts")
        .eq("type", "ai.fill")
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
    return len(resp.data or []) > 0


def increment_attempts(job_id: str) -> None:
    """Increment the attempts counter for a job."""
    client = get_client()
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

def insert_ai_fill(
    edit_decision_id: str,
    gap_index: int,
    method: str,
    s3_key: str,
    duration_seconds: float,
    quality_score: float,
    metadata: dict[str, Any] | None = None,
) -> str:
    """Insert an ai_fills row and return its id."""
    client = get_client()
    row = {
        "edit_decision_id": edit_decision_id,
        "gap_index": gap_index,
        "method": method,
        "s3_key": s3_key,
        "duration_seconds": duration_seconds,
        "quality_score": quality_score,
    }
    if metadata:
        row["metadata"] = metadata
    resp = client.table("ai_fills").insert(row).execute()
    if not resp.data:
        raise RuntimeError("Failed to insert ai_fill")
    return resp.data[0]["id"]


def update_edit_decision_status(edit_decision_id: str, status: str) -> None:
    client = get_client()
    client.table("edit_decisions").update({
        "status": status,
    }).eq("id", edit_decision_id).execute()


def update_project_status(project_id: str, status: str) -> None:
    client = get_client()
    resp = client.table("projects").update({"status": status}).eq("id", project_id).execute()
    if not resp.data:
        raise RuntimeError(f"Failed to update project {project_id} status to {status}")


def enqueue_export_job(project_id: str, user_id: str, edit_decision_id: str) -> str:
    """Insert a video.export job into the job_queue and return its id."""
    import uuid
    client = get_client()
    job_id = str(uuid.uuid4())
    resp = client.table("job_queue").insert({
        "id": job_id,
        "project_id": project_id,
        "user_id": user_id,
        "type": "video.export",
        "payload": {
            "project_id": project_id,
            "edit_decision_id": edit_decision_id,
        },
        "status": "queued",
        "priority": 10,
    }).execute()
    if not resp.data:
        raise RuntimeError("Failed to enqueue export job")
    return job_id


def refund_credits(credit_transaction_id: str) -> None:
    """Refund credits for a failed gap via the refund_credits RPC."""
    client = get_client()
    try:
        client.rpc("refund_credits", {"p_transaction_id": credit_transaction_id}).execute()
        logger.info("Refunded credits for transaction %s", credit_transaction_id)
    except Exception:
        logger.exception("Failed to refund credits for transaction %s", credit_transaction_id)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
