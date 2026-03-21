import os


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


SUPABASE_URL: str = _required("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY: str = _required("SUPABASE_SERVICE_ROLE_KEY")

AWS_ACCESS_KEY_ID: str = _required("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY: str = _required("AWS_SECRET_ACCESS_KEY")
AWS_S3_BUCKET: str = _required("AWS_S3_BUCKET")
AWS_REGION: str = _required("AWS_REGION")

POLL_INTERVAL_SECONDS: int = int(os.environ.get("POLL_INTERVAL_SECONDS", "5"))
SILENCE_THRESHOLD_DB: float = float(os.environ.get("SILENCE_THRESHOLD_DB", "-40"))
MIN_SILENCE_DURATION: float = float(os.environ.get("MIN_SILENCE_DURATION", "1.5"))
AUTO_ACCEPT_DURATION: float = float(os.environ.get("AUTO_ACCEPT_DURATION", "2.0"))
AUTO_ACCEPT_CONFIDENCE: float = float(os.environ.get("AUTO_ACCEPT_CONFIDENCE", "0.85"))
