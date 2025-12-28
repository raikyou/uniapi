import sqlite3
from pathlib import Path

from .settings import DB_PATH


def get_connection() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = get_connection()
    cur = conn.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS providers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            base_url TEXT NOT NULL,
            api_key TEXT NOT NULL,
            priority INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            translate_enabled INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )

    def ensure_column(table: str, column: str, definition: str) -> None:
        columns = {
            row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
        }
        if column not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    ensure_column("providers", "last_tested_at", "TEXT")
    ensure_column("providers", "last_ftl_ms", "INTEGER")
    ensure_column("providers", "last_tps", "REAL")

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS provider_models (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id INTEGER NOT NULL,
            model_id TEXT NOT NULL,
            alias TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (provider_id) REFERENCES providers(id)
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS configs (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS request_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id TEXT NOT NULL,
            model_alias TEXT,
            model_id TEXT,
            provider_id INTEGER,
            endpoint TEXT NOT NULL,
            request_body TEXT,
            response_body TEXT,
            is_streaming INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL,
            latency_ms INTEGER,
            first_token_ms INTEGER,
            tokens_in INTEGER,
            tokens_out INTEGER,
            tokens_total INTEGER,
            tokens_cache INTEGER,
            translated INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        """
    )

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS request_log_bodies (
            log_id INTEGER PRIMARY KEY,
            request_body TEXT,
            response_body TEXT,
            FOREIGN KEY (log_id) REFERENCES request_logs(id) ON DELETE CASCADE
        );
        """
    )

    conn.commit()
    conn.close()


class DatabaseSession:
    def __enter__(self) -> sqlite3.Connection:
        self.conn = get_connection()
        return self.conn

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc_type is None:
            self.conn.commit()
        else:
            self.conn.rollback()
        self.conn.close()


class DatabaseReadOnlySession:
    def __enter__(self) -> sqlite3.Connection:
        self.conn = get_connection()
        return self.conn

    def __exit__(self, exc_type, exc, tb) -> None:
        self.conn.close()
