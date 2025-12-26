import json
from datetime import datetime, timedelta
from typing import List, Optional

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RequestLog


class RequestLogService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_logs(
        self,
        page: int = 1,
        page_size: int = 20,
        provider_id: Optional[int] = None,
        model: Optional[str] = None,
        is_success: Optional[bool] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
    ):
        """Get paginated request logs"""
        query = select(RequestLog).order_by(RequestLog.created_at.desc())

        if provider_id:
            query = query.where(RequestLog.provider_id == provider_id)
        if model:
            query = query.where(RequestLog.model.contains(model))
        if is_success is not None:
            query = query.where(RequestLog.is_success == is_success)
        if start_time:
            query = query.where(RequestLog.created_at >= start_time)
        if end_time:
            query = query.where(RequestLog.created_at <= end_time)

        # Count total
        count_query = select(func.count(RequestLog.id))
        if provider_id:
            count_query = count_query.where(RequestLog.provider_id == provider_id)
        if model:
            count_query = count_query.where(RequestLog.model.contains(model))
        if is_success is not None:
            count_query = count_query.where(RequestLog.is_success == is_success)
        if start_time:
            count_query = count_query.where(RequestLog.created_at >= start_time)
        if end_time:
            count_query = count_query.where(RequestLog.created_at <= end_time)

        total_result = await self.db.execute(count_query)
        total = total_result.scalar() or 0

        # Apply pagination
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)

        result = await self.db.execute(query)
        logs = result.scalars().all()

        return {
            "items": logs,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": (total + page_size - 1) // page_size,
        }

    async def get_by_id(self, log_id: int) -> Optional[RequestLog]:
        """Get a log by ID"""
        query = select(RequestLog).where(RequestLog.id == log_id)
        result = await self.db.execute(query)
        return result.scalar_one_or_none()

    async def cleanup_old_logs(self, retention_days: int) -> int:
        """Delete logs older than retention_days"""
        cutoff = datetime.utcnow() - timedelta(days=retention_days)

        # Count before delete
        count_query = select(func.count(RequestLog.id)).where(
            RequestLog.created_at < cutoff
        )
        result = await self.db.execute(count_query)
        count = result.scalar() or 0

        # Delete old logs
        delete_query = delete(RequestLog).where(RequestLog.created_at < cutoff)
        await self.db.execute(delete_query)
        await self.db.commit()

        return count

    async def get_overview_stats(self, days: int = 7) -> dict:
        """Get overview statistics"""
        start_time = datetime.utcnow() - timedelta(days=days)

        # Total requests
        total_query = select(func.count(RequestLog.id)).where(
            RequestLog.created_at >= start_time
        )
        total_result = await self.db.execute(total_query)
        total_requests = total_result.scalar() or 0

        # Successful requests
        success_query = select(func.count(RequestLog.id)).where(
            RequestLog.created_at >= start_time,
            RequestLog.is_success == True,
        )
        success_result = await self.db.execute(success_query)
        successful_requests = success_result.scalar() or 0

        # Token stats
        token_query = select(
            func.sum(RequestLog.total_tokens),
            func.avg(RequestLog.latency_ms),
            func.avg(RequestLog.first_token_latency_ms),
        ).where(RequestLog.created_at >= start_time)
        token_result = await self.db.execute(token_query)
        token_row = token_result.one()

        return {
            "total_requests": total_requests,
            "successful_requests": successful_requests,
            "failed_requests": total_requests - successful_requests,
            "total_tokens": token_row[0] or 0,
            "avg_latency_ms": round(token_row[1] or 0, 2),
            "avg_first_token_latency_ms": round(token_row[2] or 0, 2),
        }

    async def get_request_stats(self, days: int = 7, interval: str = "day") -> list:
        """Get request statistics over time"""
        start_time = datetime.utcnow() - timedelta(days=days)

        # Group by date
        query = (
            select(
                func.date(RequestLog.created_at).label("date"),
                func.count(RequestLog.id).label("count"),
            )
            .where(RequestLog.created_at >= start_time)
            .group_by(func.date(RequestLog.created_at))
            .order_by(func.date(RequestLog.created_at))
        )

        result = await self.db.execute(query)
        rows = result.all()

        return [
            {"timestamp": str(row[0]), "value": row[1]}
            for row in rows
        ]

    async def get_token_stats(self, days: int = 7) -> dict:
        """Get token consumption statistics"""
        start_time = datetime.utcnow() - timedelta(days=days)

        query = select(
            func.sum(RequestLog.input_tokens),
            func.sum(RequestLog.output_tokens),
            func.sum(RequestLog.cache_tokens),
        ).where(RequestLog.created_at >= start_time)

        result = await self.db.execute(query)
        row = result.one()

        return {
            "total_input": row[0] or 0,
            "total_output": row[1] or 0,
            "total_cache": row[2] or 0,
        }

    async def get_provider_stats(self, days: int = 7) -> list:
        """Get statistics by provider"""
        start_time = datetime.utcnow() - timedelta(days=days)

        query = (
            select(
                RequestLog.provider_id,
                RequestLog.provider_name,
                func.count(RequestLog.id).label("request_count"),
                func.avg(
                    func.cast(RequestLog.is_success, func.Integer)
                ).label("success_rate"),
                func.avg(RequestLog.latency_ms).label("avg_latency"),
                func.sum(RequestLog.total_tokens).label("total_tokens"),
            )
            .where(RequestLog.created_at >= start_time)
            .group_by(RequestLog.provider_id, RequestLog.provider_name)
        )

        result = await self.db.execute(query)
        rows = result.all()

        return [
            {
                "provider_id": row[0],
                "provider_name": row[1] or "Unknown",
                "request_count": row[2],
                "success_rate": round((row[3] or 0) * 100, 2),
                "avg_latency_ms": round(row[4] or 0, 2),
                "total_tokens": row[5] or 0,
            }
            for row in rows
        ]
