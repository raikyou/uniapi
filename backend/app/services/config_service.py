from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..db import DatabaseSession, DatabaseReadOnlySession


def list_configs() -> List[Dict[str, Any]]:
    with DatabaseReadOnlySession() as conn:
        rows = conn.execute("SELECT key, value FROM configs ORDER BY key ASC").fetchall()
        return [dict(row) for row in rows]


def get_config(key: str) -> Optional[str]:
    with DatabaseReadOnlySession() as conn:
        row = conn.execute(
            "SELECT value FROM configs WHERE key = ?",
            (key,),
        ).fetchone()
        return row["value"] if row else None


def set_config(key: str, value: str) -> Dict[str, Any]:
    with DatabaseSession() as conn:
        conn.execute(
            "INSERT INTO configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
    return {"key": key, "value": value}
