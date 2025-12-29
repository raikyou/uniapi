from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from ..db import DatabaseSession, DatabaseReadOnlySession


def _utc_now() -> str:
    return datetime.utcnow().isoformat()


def list_providers(limit: Optional[int] = None, offset: int = 0) -> List[Dict[str, Any]]:
    with DatabaseReadOnlySession() as conn:
        if limit is None:
            rows = conn.execute(
                "SELECT * FROM providers ORDER BY priority DESC, name ASC, id DESC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM providers ORDER BY priority DESC, name ASC, id DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        return [dict(row) for row in rows]


def get_provider(provider_id: int) -> Optional[Dict[str, Any]]:
    with DatabaseReadOnlySession() as conn:
        row = conn.execute(
            "SELECT * FROM providers WHERE id = ?",
            (provider_id,),
        ).fetchone()
        return dict(row) if row else None


def create_provider(payload: Dict[str, Any]) -> Dict[str, Any]:
    now = _utc_now()
    with DatabaseSession() as conn:
        cur = conn.execute(
            """
            INSERT INTO providers (name, type, base_url, api_key, priority, enabled, translate_enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["name"],
                payload["type"],
                payload["base_url"],
                payload["api_key"],
                payload.get("priority", 0),
                1 if payload.get("enabled", True) else 0,
                1 if payload.get("translate_enabled", False) else 0,
                now,
                now,
            ),
        )
        provider_id = cur.lastrowid
    return get_provider(provider_id)


def update_provider(provider_id: int, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    existing = get_provider(provider_id)
    if not existing:
        return None

    fields = []
    values = []
    for key in ["name", "type", "base_url", "api_key", "priority", "enabled", "translate_enabled"]:
        if key in payload and payload[key] is not None:
            fields.append(f"{key} = ?")
            if key in ("enabled", "translate_enabled"):
                values.append(1 if payload[key] else 0)
            else:
                values.append(payload[key])

    if fields:
        values.append(_utc_now())
        values.append(provider_id)
        with DatabaseSession() as conn:
            conn.execute(
                f"UPDATE providers SET {', '.join(fields)}, updated_at = ? WHERE id = ?",
                tuple(values),
            )

    return get_provider(provider_id)


def update_provider_test_performance(
    provider_id: int, *, last_tested_at: str, last_ftl_ms: int, last_tps: Optional[float]
) -> Optional[Dict[str, Any]]:
    existing = get_provider(provider_id)
    if not existing:
        return None

    with DatabaseSession() as conn:
        conn.execute(
            """
            UPDATE providers
            SET last_tested_at = ?, last_ftl_ms = ?, last_tps = ?, updated_at = ?
            WHERE id = ?
            """,
            (last_tested_at, last_ftl_ms, last_tps, _utc_now(), provider_id),
        )
    return get_provider(provider_id)


def delete_provider(provider_id: int) -> bool:
    with DatabaseSession() as conn:
        conn.execute("DELETE FROM provider_models WHERE provider_id = ?", (provider_id,))
        cur = conn.execute("DELETE FROM providers WHERE id = ?", (provider_id,))
    return cur.rowcount > 0


def list_provider_models(provider_id: int) -> List[Dict[str, Any]]:
    with DatabaseReadOnlySession() as conn:
        rows = conn.execute(
            "SELECT * FROM provider_models WHERE provider_id = ? ORDER BY id DESC",
            (provider_id,),
        ).fetchall()
        return [dict(row) for row in rows]


def create_provider_model(provider_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
    now = _utc_now()
    with DatabaseSession() as conn:
        cur = conn.execute(
            """
            INSERT INTO provider_models (provider_id, model_id, alias, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (
                provider_id,
                payload["model_id"],
                payload.get("alias"),
                now,
            ),
        )
        model_id = cur.lastrowid
    return get_provider_model(model_id)


def get_provider_model(model_id: int) -> Optional[Dict[str, Any]]:
    with DatabaseReadOnlySession() as conn:
        row = conn.execute(
            "SELECT * FROM provider_models WHERE id = ?",
            (model_id,),
        ).fetchone()
        return dict(row) if row else None


def update_provider_model(model_id: int, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    existing = get_provider_model(model_id)
    if not existing:
        return None

    fields = []
    values = []
    for key in ["model_id", "alias"]:
        if key in payload:
            fields.append(f"{key} = ?")
            values.append(payload[key])

    if fields:
        values.append(model_id)
        with DatabaseSession() as conn:
            conn.execute(
                f"UPDATE provider_models SET {', '.join(fields)} WHERE id = ?",
                tuple(values),
            )

    return get_provider_model(model_id)


def delete_provider_model(model_id: int) -> bool:
    with DatabaseSession() as conn:
        cur = conn.execute("DELETE FROM provider_models WHERE id = ?", (model_id,))
    return cur.rowcount > 0


def find_model_match(provider_id: int, model_name: str) -> Optional[Dict[str, Any]]:
    with DatabaseReadOnlySession() as conn:
        rows = conn.execute(
            """
            SELECT * FROM provider_models
            WHERE provider_id = ?
            ORDER BY id DESC
            """,
            (provider_id,),
        ).fetchall()

    for row in rows:
        row_dict = dict(row)
        alias = row_dict.get("alias")
        if alias and alias == model_name:
            return row_dict

    for row in rows:
        row_dict = dict(row)
        alias = row_dict.get("alias")
        if alias and _regex_match(alias, model_name):
            return row_dict

    for row in rows:
        row_dict = dict(row)
        if row_dict.get("model_id") == model_name:
            return row_dict

    return None


def _regex_match(pattern: str, value: str) -> bool:
    import re

    try:
        return re.match(pattern, value) is not None
    except re.error:
        return False
