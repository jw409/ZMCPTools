"""Scrape job queue management service for coordinated scraping across MCP server instances."""

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import execute_query
from ..models import DocumentationSource, ScrapeJob, ScrapeJobStatus

logger = structlog.get_logger()


class ScrapeJobService:
    """Service for managing scrape job queue with database-backed coordination."""

    def __init__(self, worker_id: str | None = None):
        """Initialize scrape job service.
        
        Args:
            worker_id: Unique identifier for this worker instance
        """
        self.worker_id = worker_id or f"worker-{uuid.uuid4().hex[:8]}"
        logger.info("ScrapeJobService initialized", worker_id=self.worker_id)

    async def queue_scrape_job(
        self,
        source_id: str,
        job_params: dict[str, Any],
        priority: int = 5,
        lock_timeout: int = 3600,
    ) -> dict[str, Any]:
        """Add a new scraping job to the queue.
        
        Args:
            source_id: Documentation source ID to scrape
            job_params: Parameters for the scraping job
            priority: Job priority (1=highest, 10=lowest)
            lock_timeout: Lock timeout in seconds
            
        Returns:
            Result with job ID and status
        """
        async def _queue_job(session: AsyncSession):
            try:
                # Verify source exists
                source_stmt = select(DocumentationSource).where(
                    DocumentationSource.id == source_id
                )
                source_result = await session.execute(source_stmt)
                source = source_result.scalar_one_or_none()
                
                if not source:
                    return {
                        "success": False,
                        "error": f"Documentation source {source_id} not found",
                    }

                # Check for existing pending job for this source
                existing_stmt = select(ScrapeJob).where(
                    ScrapeJob.source_id == source_id,
                    ScrapeJob.status.in_([ScrapeJobStatus.PENDING, ScrapeJobStatus.IN_PROGRESS])
                )
                existing_result = await session.execute(existing_stmt)
                existing_job = existing_result.scalar_one_or_none()
                
                if existing_job:
                    return {
                        "success": False,
                        "error": f"Job already exists for source {source_id}",
                        "existing_job_id": existing_job.id,
                        "existing_status": existing_job.status.value,
                    }

                # Create new job
                job_id = str(uuid.uuid4())
                job_data = {
                    "priority": priority,
                    "source_url": source.url,
                    "source_name": source.name,
                    **job_params,
                }

                new_job = ScrapeJob(
                    id=job_id,
                    source_id=source_id,
                    status=ScrapeJobStatus.PENDING,
                    lock_timeout=lock_timeout,
                )
                new_job.set_job_data(job_data)

                session.add(new_job)
                await session.commit()

                logger.info("Scrape job queued successfully",
                           job_id=job_id,
                           source_id=source_id,
                           priority=priority)

                return {
                    "success": True,
                    "job_id": job_id,
                    "source_id": source_id,
                    "status": ScrapeJobStatus.PENDING.value,
                    "created_at": new_job.created_at.isoformat(),
                }

            except Exception as e:
                logger.error("Failed to queue scrape job",
                            source_id=source_id, error=str(e))
                return {
                    "success": False,
                    "error": str(e),
                }

        return await execute_query(_queue_job)

    async def acquire_next_job(self, worker_id: str | None = None) -> dict[str, Any] | None:
        """Acquire the next pending job with atomic locking.
        
        Args:
            worker_id: Worker ID to acquire job for (defaults to instance worker_id)
            
        Returns:
            Job details if acquired, None if no jobs available
        """
        effective_worker_id = worker_id or self.worker_id

        async def _acquire_job(session: AsyncSession):
            try:
                # Use SELECT FOR UPDATE SKIP LOCKED for atomic job acquisition
                # This ensures only one worker can acquire a specific job
                job_stmt = (
                    select(ScrapeJob)
                    .where(ScrapeJob.status == ScrapeJobStatus.PENDING)
                    .order_by(
                        # Order by priority (1=highest), then by creation time
                        func.json_extract(ScrapeJob.job_data, "$.priority").asc(),
                        ScrapeJob.created_at.asc()
                    )
                    .limit(1)
                    .with_for_update(skip_locked=True)
                )
                
                result = await session.execute(job_stmt)
                job = result.scalar_one_or_none()

                if not job:
                    # No pending jobs available
                    return None

                # Acquire the lock
                now = datetime.now(timezone.utc)
                job.status = ScrapeJobStatus.IN_PROGRESS
                job.locked_by = effective_worker_id
                job.locked_at = now
                job.started_at = now

                await session.commit()

                logger.info("Job acquired successfully",
                           job_id=job.id,
                           worker_id=effective_worker_id,
                           source_id=job.source_id)

                return {
                    "job_id": job.id,
                    "source_id": job.source_id,
                    "job_data": job.get_job_data(),
                    "status": job.status.value,
                    "locked_by": job.locked_by,
                    "locked_at": job.locked_at.isoformat(),
                    "lock_timeout": job.lock_timeout,
                }

            except Exception as e:
                logger.error("Failed to acquire job",
                            worker_id=effective_worker_id, error=str(e))
                return None

        return await execute_query(_acquire_job)

    async def complete_job(
        self,
        job_id: str,
        result: dict[str, Any],
        worker_id: str | None = None,
    ) -> dict[str, Any]:
        """Mark a job as completed with results.
        
        Args:
            job_id: Job ID to complete
            result: Result data from the scraping job
            worker_id: Worker ID completing the job
            
        Returns:
            Completion result
        """
        effective_worker_id = worker_id or self.worker_id

        async def _complete_job(session: AsyncSession):
            try:
                # Get the job with lock verification
                job_stmt = select(ScrapeJob).where(ScrapeJob.id == job_id)
                job_result = await session.execute(job_stmt)
                job = job_result.scalar_one_or_none()

                if not job:
                    return {
                        "success": False,
                        "error": f"Job {job_id} not found",
                    }

                # Verify worker owns the lock
                if job.locked_by != effective_worker_id:
                    return {
                        "success": False,
                        "error": f"Job locked by different worker: {job.locked_by}",
                    }

                # Update job to completed
                now = datetime.now(timezone.utc)
                job.status = ScrapeJobStatus.COMPLETED
                job.completed_at = now
                job.pages_scraped = result.get("pages_scraped", 0)
                job.set_result_data(result)

                # Clear lock
                job.locked_by = None
                job.locked_at = None

                await session.commit()

                logger.info("Job completed successfully",
                           job_id=job_id,
                           worker_id=effective_worker_id,
                           pages_scraped=job.pages_scraped)

                return {
                    "success": True,
                    "job_id": job_id,
                    "status": ScrapeJobStatus.COMPLETED.value,
                    "completed_at": job.completed_at.isoformat(),
                    "pages_scraped": job.pages_scraped,
                }

            except Exception as e:
                logger.error("Failed to complete job",
                            job_id=job_id, worker_id=effective_worker_id, error=str(e))
                return {
                    "success": False,
                    "error": str(e),
                }

        return await execute_query(_complete_job)

    async def fail_job(
        self,
        job_id: str,
        error: str,
        worker_id: str | None = None,
    ) -> dict[str, Any]:
        """Mark a job as failed with error details.
        
        Args:
            job_id: Job ID to mark as failed
            error: Error message describing the failure
            worker_id: Worker ID that encountered the failure
            
        Returns:
            Failure result
        """
        effective_worker_id = worker_id or self.worker_id

        async def _fail_job(session: AsyncSession):
            try:
                # Get the job with lock verification
                job_stmt = select(ScrapeJob).where(ScrapeJob.id == job_id)
                job_result = await session.execute(job_stmt)
                job = job_result.scalar_one_or_none()

                if not job:
                    return {
                        "success": False,
                        "error": f"Job {job_id} not found",
                    }

                # Verify worker owns the lock (or allow if lock expired)
                if job.locked_by and job.locked_by != effective_worker_id and job.is_locked():
                    return {
                        "success": False,
                        "error": f"Job locked by different worker: {job.locked_by}",
                    }

                # Update job to failed
                now = datetime.now(timezone.utc)
                job.status = ScrapeJobStatus.FAILED
                job.completed_at = now
                job.error_message = error

                # Clear lock
                job.locked_by = None
                job.locked_at = None

                await session.commit()

                logger.error("Job marked as failed",
                            job_id=job_id,
                            worker_id=effective_worker_id,
                            error=error)

                return {
                    "success": True,
                    "job_id": job_id,
                    "status": ScrapeJobStatus.FAILED.value,
                    "failed_at": job.completed_at.isoformat(),
                    "error_message": error,
                }

            except Exception as e:
                logger.error("Failed to mark job as failed",
                            job_id=job_id, worker_id=effective_worker_id, error=str(e))
                return {
                    "success": False,
                    "error": str(e),
                }

        return await execute_query(_fail_job)

    async def release_expired_locks(self, max_age_minutes: int = 60) -> dict[str, Any]:
        """Release locks that have exceeded their timeout.
        
        Args:
            max_age_minutes: Maximum age for locks before considering them expired
            
        Returns:
            Result with count of released locks
        """
        async def _release_locks(session: AsyncSession):
            try:
                cutoff_time = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)

                # Find jobs with expired locks
                expired_stmt = select(ScrapeJob).where(
                    ScrapeJob.status == ScrapeJobStatus.IN_PROGRESS,
                    ScrapeJob.locked_at < cutoff_time
                )
                result = await session.execute(expired_stmt)
                expired_jobs = result.scalars().all()

                released_count = 0
                for job in expired_jobs:
                    # Check if lock is actually expired using job's timeout setting
                    if not job.is_locked():
                        job.status = ScrapeJobStatus.PENDING
                        job.locked_by = None
                        job.locked_at = None
                        job.started_at = None
                        released_count += 1

                        logger.warning("Released expired job lock",
                                     job_id=job.id,
                                     previous_worker=job.locked_by,
                                     locked_duration_minutes=(
                                         datetime.now(timezone.utc) - job.locked_at
                                     ).total_seconds() / 60)

                if released_count > 0:
                    await session.commit()

                logger.info("Expired lock cleanup completed",
                           released_count=released_count,
                           cutoff_time=cutoff_time.isoformat())

                return {
                    "success": True,
                    "released_count": released_count,
                    "cutoff_time": cutoff_time.isoformat(),
                }

            except Exception as e:
                logger.error("Failed to release expired locks", error=str(e))
                return {
                    "success": False,
                    "error": str(e),
                }

        return await execute_query(_release_locks)

    async def get_job_status(self, job_id: str) -> dict[str, Any] | None:
        """Get current status of a specific job.
        
        Args:
            job_id: Job ID to check status for
            
        Returns:
            Job status details or None if not found
        """
        async def _get_status(session: AsyncSession):
            try:
                job_stmt = select(ScrapeJob).where(ScrapeJob.id == job_id)
                result = await session.execute(job_stmt)
                job = result.scalar_one_or_none()

                if not job:
                    return None

                return {
                    "job_id": job.id,
                    "source_id": job.source_id,
                    "status": job.status.value,
                    "job_data": job.get_job_data(),
                    "locked_by": job.locked_by,
                    "locked_at": job.locked_at.isoformat() if job.locked_at else None,
                    "created_at": job.created_at.isoformat(),
                    "started_at": job.started_at.isoformat() if job.started_at else None,
                    "completed_at": job.completed_at.isoformat() if job.completed_at else None,
                    "error_message": job.error_message,
                    "pages_scraped": job.pages_scraped,
                    "result_data": job.get_result_data(),
                    "is_lock_expired": not job.is_locked() if job.locked_at else None,
                }

            except Exception as e:
                logger.error("Failed to get job status", job_id=job_id, error=str(e))
                return None

        return await execute_query(_get_status)

    async def heartbeat_job(
        self,
        job_id: str,
        worker_id: str | None = None,
    ) -> dict[str, Any]:
        """Send heartbeat to keep job lock alive.
        
        Args:
            job_id: Job ID to send heartbeat for
            worker_id: Worker ID sending heartbeat
            
        Returns:
            Heartbeat result
        """
        effective_worker_id = worker_id or self.worker_id

        async def _heartbeat(session: AsyncSession):
            try:
                job_stmt = select(ScrapeJob).where(ScrapeJob.id == job_id)
                result = await session.execute(job_stmt)
                job = result.scalar_one_or_none()

                if not job:
                    return {
                        "success": False,
                        "error": f"Job {job_id} not found",
                    }

                # Verify worker owns the lock
                if job.locked_by != effective_worker_id:
                    return {
                        "success": False,
                        "error": f"Job locked by different worker: {job.locked_by}",
                    }

                if job.status != ScrapeJobStatus.IN_PROGRESS:
                    return {
                        "success": False,
                        "error": f"Job not in progress: {job.status.value}",
                    }

                # Update lock timestamp
                job.locked_at = datetime.now(timezone.utc)
                await session.commit()

                return {
                    "success": True,
                    "job_id": job_id,
                    "heartbeat_time": job.locked_at.isoformat(),
                    "lock_expires_at": (
                        job.locked_at + timedelta(seconds=job.lock_timeout)
                    ).isoformat(),
                }

            except Exception as e:
                logger.error("Failed to send job heartbeat",
                            job_id=job_id, worker_id=effective_worker_id, error=str(e))
                return {
                    "success": False,
                    "error": str(e),
                }

        return await execute_query(_heartbeat)

    async def list_jobs(
        self,
        status_filter: list[ScrapeJobStatus] | None = None,
        worker_filter: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        """List jobs with optional filtering.
        
        Args:
            status_filter: Filter by job status
            worker_filter: Filter by worker ID
            limit: Maximum number of jobs to return
            
        Returns:
            List of jobs with metadata
        """
        async def _list_jobs(session: AsyncSession):
            try:
                stmt = select(ScrapeJob).order_by(ScrapeJob.created_at.desc())

                if status_filter:
                    stmt = stmt.where(ScrapeJob.status.in_(status_filter))

                if worker_filter:
                    stmt = stmt.where(ScrapeJob.locked_by == worker_filter)

                stmt = stmt.limit(limit)

                result = await session.execute(stmt)
                jobs = result.scalars().all()

                job_list = []
                for job in jobs:
                    job_list.append({
                        "job_id": job.id,
                        "source_id": job.source_id,
                        "status": job.status.value,
                        "locked_by": job.locked_by,
                        "created_at": job.created_at.isoformat(),
                        "started_at": job.started_at.isoformat() if job.started_at else None,
                        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
                        "pages_scraped": job.pages_scraped,
                        "has_error": bool(job.error_message),
                        "priority": job.get_job_data().get("priority", 5),
                    })

                return {
                    "success": True,
                    "jobs": job_list,
                    "total_returned": len(job_list),
                    "limit": limit,
                }

            except Exception as e:
                logger.error("Failed to list jobs", error=str(e))
                return {
                    "success": False,
                    "error": str(e),
                }

        return await execute_query(_list_jobs)

    async def get_queue_stats(self) -> dict[str, Any]:
        """Get statistics about the job queue.
        
        Returns:
            Queue statistics
        """
        async def _get_stats(session: AsyncSession):
            try:
                # Count jobs by status
                stats = {}
                for status in ScrapeJobStatus:
                    count_stmt = select(func.count(ScrapeJob.id)).where(
                        ScrapeJob.status == status
                    )
                    result = await session.execute(count_stmt)
                    stats[f"{status.value}_count"] = result.scalar() or 0

                # Get active workers
                active_workers_stmt = select(ScrapeJob.locked_by).where(
                    ScrapeJob.status == ScrapeJobStatus.IN_PROGRESS,
                    ScrapeJob.locked_by.is_not(None)
                ).distinct()
                workers_result = await session.execute(active_workers_stmt)
                active_workers = [row[0] for row in workers_result.fetchall()]

                # Get oldest pending job
                oldest_pending_stmt = select(ScrapeJob.created_at).where(
                    ScrapeJob.status == ScrapeJobStatus.PENDING
                ).order_by(ScrapeJob.created_at.asc()).limit(1)
                oldest_result = await session.execute(oldest_pending_stmt)
                oldest_pending = oldest_result.scalar_one_or_none()

                return {
                    "success": True,
                    "queue_stats": stats,
                    "active_workers": active_workers,
                    "active_worker_count": len(active_workers),
                    "oldest_pending_job": oldest_pending.isoformat() if oldest_pending else None,
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                }

            except Exception as e:
                logger.error("Failed to get queue stats", error=str(e))
                return {
                    "success": False,
                    "error": str(e),
                }

        return await execute_query(_get_stats)

    async def cleanup_completed_jobs(self, max_age_days: int = 7) -> dict[str, Any]:
        """Clean up old completed and failed jobs.
        
        Args:
            max_age_days: Maximum age for completed jobs before deletion
            
        Returns:
            Cleanup result with count of deleted jobs
        """
        async def _cleanup_jobs(session: AsyncSession):
            try:
                cutoff_date = datetime.now(timezone.utc) - timedelta(days=max_age_days)

                # Delete old completed and failed jobs
                delete_stmt = select(ScrapeJob).where(
                    ScrapeJob.status.in_([ScrapeJobStatus.COMPLETED, ScrapeJobStatus.FAILED]),
                    ScrapeJob.completed_at < cutoff_date
                )
                result = await session.execute(delete_stmt)
                old_jobs = result.scalars().all()

                deleted_count = len(old_jobs)
                for job in old_jobs:
                    await session.delete(job)

                if deleted_count > 0:
                    await session.commit()

                logger.info("Job cleanup completed",
                           deleted_count=deleted_count,
                           cutoff_date=cutoff_date.isoformat())

                return {
                    "success": True,
                    "deleted_count": deleted_count,
                    "cutoff_date": cutoff_date.isoformat(),
                }

            except Exception as e:
                logger.error("Failed to cleanup jobs", error=str(e))
                return {
                    "success": False,
                    "error": str(e),
                }

        return await execute_query(_cleanup_jobs)