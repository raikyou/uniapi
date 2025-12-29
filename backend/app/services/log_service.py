from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

from ..db import DatabaseSession, DatabaseReadOnlySession
from .config_service import get_config
from ..settings import LOG_RETENTION_DAYS


def _utc_now() -> str:
    return datetime.utcnow().isoformat()


def _retention_days() -> int:
    value = get_config("log_retention_days")
    if value:
        try:
            return int(value)
        except ValueError:
            return LOG_RETENTION_DAYS
    return LOG_RETENTION_DAYS


_LOG_SELECT_SQL = """
    SELECT
        r.id,
        r.request_id,
        r.model_alias,
        r.model_id,
        r.provider_id,
        r.endpoint,
        COALESCE(b.request_body, r.request_body) AS request_body,
        COALESCE(b.response_body, r.response_body) AS response_body,
        r.is_streaming,
        r.status,
        r.latency_ms,
        r.first_token_ms,
        r.tokens_in,
        r.tokens_out,
        r.tokens_total,
        r.tokens_cache,
        r.translated,
        r.created_at
    FROM request_logs r
    LEFT JOIN request_log_bodies b ON b.log_id = r.id
"""


def _upsert_log_bodies(
    conn: Any,
    log_id: int,
    request_body: Optional[str],
    response_body: Optional[str],
) -> None:
    if request_body is None and response_body is None:
        return
    conn.execute(
        """
        INSERT INTO request_log_bodies (log_id, request_body, response_body)
        VALUES (?, ?, ?)
        ON CONFLICT(log_id) DO UPDATE SET
            request_body = COALESCE(excluded.request_body, request_log_bodies.request_body),
            response_body = COALESCE(excluded.response_body, request_log_bodies.response_body)
        """,
        (log_id, request_body, response_body),
    )


def purge_old_logs() -> None:
    cutoff = datetime.utcnow() - timedelta(days=_retention_days())
    cutoff_iso = cutoff.isoformat()
    with DatabaseSession() as conn:
        conn.execute(
            """
            DELETE FROM request_log_bodies
            WHERE log_id IN (SELECT id FROM request_logs WHERE created_at < ?)
            """,
            (cutoff_iso,),
        )
        conn.execute(
            """
            UPDATE request_logs
            SET request_body = NULL, response_body = NULL
            WHERE created_at < ?
              AND (request_body IS NOT NULL OR response_body IS NOT NULL)
            """,
            (cutoff_iso,),
        )


def create_log(payload: Dict[str, Any]) -> Dict[str, Any]:
    now = _utc_now()
    request_body = payload.get("request_body")
    response_body = payload.get("response_body")
    with DatabaseSession() as conn:
        cur = conn.execute(
            """
            INSERT INTO request_logs (
                request_id, model_alias, model_id, provider_id, endpoint,
                is_streaming, status,
                latency_ms, first_token_ms, tokens_in, tokens_out,
                tokens_total, tokens_cache, translated, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["request_id"],
                payload.get("model_alias"),
                payload.get("model_id"),
                payload.get("provider_id"),
                payload["endpoint"],
                1 if payload.get("is_streaming", False) else 0,
                payload.get("status", "pending"),
                payload.get("latency_ms"),
                payload.get("first_token_ms"),
                payload.get("tokens_in"),
                payload.get("tokens_out"),
                payload.get("tokens_total"),
                payload.get("tokens_cache"),
                1 if payload.get("translated", False) else 0,
                now,
            ),
        )
        log_id = cur.lastrowid
        _upsert_log_bodies(conn, log_id, request_body, response_body)
    return get_log(log_id)


def update_log(log_id: int, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    fields = []
    values = []
    for key in [
        "model_alias",
        "model_id",
        "provider_id",
        "endpoint",
        "is_streaming",
        "status",
        "latency_ms",
        "first_token_ms",
        "tokens_in",
        "tokens_out",
        "tokens_total",
        "tokens_cache",
        "translated",
    ]:
        if key in payload and payload[key] is not None:
            fields.append(f"{key} = ?")
            if key in ("is_streaming", "translated"):
                values.append(1 if payload[key] else 0)
            else:
                values.append(payload[key])

    request_body = payload.get("request_body")
    response_body = payload.get("response_body")
    if not fields and request_body is None and response_body is None:
        return get_log(log_id)
    with DatabaseSession() as conn:
        if fields:
            values.append(log_id)
            conn.execute(
                f"UPDATE request_logs SET {', '.join(fields)} WHERE id = ?",
                tuple(values),
            )
        _upsert_log_bodies(conn, log_id, request_body, response_body)
    return get_log(log_id)


def get_log(log_id: int) -> Optional[Dict[str, Any]]:
    with DatabaseReadOnlySession() as conn:
        row = conn.execute(
            _LOG_SELECT_SQL + " WHERE r.id = ?",
            (log_id,),
        ).fetchone()
        return dict(row) if row else None


def list_logs(limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    with DatabaseReadOnlySession() as conn:
        rows = conn.execute(
            _LOG_SELECT_SQL + " ORDER BY r.id DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        return [dict(row) for row in rows]


def metrics_summary() -> Dict[str, Any]:
    with DatabaseReadOnlySession() as conn:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS request_count,
                COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS success_count,
                COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) AS error_count,
                AVG(latency_ms) AS avg_latency_ms,
                COALESCE(
                    SUM(
                        COALESCE(tokens_total, COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0))
                    ),
                    0
                ) AS tokens_total
            FROM request_logs
            """
        ).fetchone()

    data = dict(row) if row else None
    return data or {
        "request_count": 0,
        "success_count": 0,
        "error_count": 0,
        "avg_latency_ms": None,
        "tokens_total": 0,
    }


def metrics_by_provider() -> List[Dict[str, Any]]:
    with DatabaseReadOnlySession() as conn:
        rows = conn.execute(
            """
            SELECT
                provider_id,
                COUNT(*) AS request_count,
                SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_count,
                SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_count,
                AVG(latency_ms) AS avg_latency_ms
            FROM request_logs
            GROUP BY provider_id
            ORDER BY request_count DESC
            """
        ).fetchall()

    return [dict(row) for row in rows]


def metrics_top_models(limit: int = 10) -> List[Dict[str, Any]]:
    with DatabaseReadOnlySession() as conn:
        rows = conn.execute(
            """
            SELECT
                COALESCE(model_alias, model_id, 'unknown') AS label,
                COUNT(*) AS request_count,
                COALESCE(
                    SUM(
                        COALESCE(tokens_total, COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0))
                    ),
                    0
                ) AS token_count
            FROM request_logs
            GROUP BY COALESCE(model_alias, model_id, 'unknown')
            ORDER BY request_count DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]


def metrics_top_providers(limit: int = 10) -> List[Dict[str, Any]]:
    with DatabaseReadOnlySession() as conn:
        rows = conn.execute(
            """
            SELECT
                COALESCE(p.name, 'unknown') AS label,
                COUNT(*) AS request_count,
                COALESCE(
                    SUM(
                        COALESCE(r.tokens_total, COALESCE(r.tokens_in, 0) + COALESCE(r.tokens_out, 0))
                    ),
                    0
                ) AS token_count
            FROM request_logs r
            LEFT JOIN providers p ON p.id = r.provider_id
            GROUP BY COALESCE(p.name, 'unknown')
            ORDER BY request_count DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]


def metrics_by_date(limit: int = 10) -> List[Dict[str, Any]]:
    with DatabaseReadOnlySession() as conn:
        rows = conn.execute(
            """
            SELECT
                substr(created_at, 1, 10) AS label,
                COUNT(*) AS request_count,
                COALESCE(
                    SUM(
                        COALESCE(tokens_total, COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0))
                    ),
                    0
                ) AS token_count
            FROM request_logs
            GROUP BY label
            ORDER BY label DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [dict(row) for row in rows]
