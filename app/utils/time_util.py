"""CST (China Standard Time, UTC+8) time utilities."""
from datetime import datetime, timezone, timedelta

CST = timezone(timedelta(hours=8))


def cst_now() -> datetime:
    """Return current datetime in CST (UTC+8), naive (no tzinfo) for SQLite compatibility."""
    return datetime.now(CST).replace(tzinfo=None)
