import os


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


SUPABASE_URL: str = _required("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY: str = _required("SUPABASE_SERVICE_ROLE_KEY")

# When running on ECS, credentials come from the task role via the SDK default credential chain.
# Explicit keys are only needed for local development.
AWS_ACCESS_KEY_ID: str = os.environ.get("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY: str = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
AWS_S3_BUCKET: str = os.environ.get("AWS_S3_BUCKET") or _required("S3_BUCKET")
AWS_REGION: str = _required("AWS_REGION")

POLL_INTERVAL_SECONDS: int = int(os.environ.get("POLL_INTERVAL_SECONDS", "5"))

# Boundary analysis
BOUNDARY_FRAME_COUNT: int = int(os.environ.get("BOUNDARY_FRAME_COUNT", "15"))

# Compositing
CROSSFADE_RAMP_FRAMES: int = int(os.environ.get("CROSSFADE_RAMP_FRAMES", "5"))

# Quality thresholds
MIN_QUALITY_SCORE: float = float(os.environ.get("MIN_QUALITY_SCORE", "0.3"))
