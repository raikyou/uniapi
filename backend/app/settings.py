from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = Path(os.getenv("UNIAPI_DB_PATH", str(DATA_DIR / "uniapi.db")))
LOG_RETENTION_DAYS = int(os.getenv("UNIAPI_LOG_RETENTION_DAYS", "7"))
FREEZE_DURATION_SECONDS = int(os.getenv("UNIAPI_FREEZE_DURATION_SECONDS", "600"))

API_KEY = os.getenv("API_KEY", "").strip()
