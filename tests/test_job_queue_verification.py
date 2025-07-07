"""
Comprehensive Job Queue System Verification Tests
Agent 2: Testing distributed job queue functionality for multi-worker coordination.
"""

import asyncio
import pytest
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any
import json

from src.claude_mcp_tools.services.scrape_job_service import ScrapeJobService
from src.claude_mcp_tools.models import DocumentationSource, ScrapeJob, ScrapeJobStatus, SourceType
from src.claude_mcp_tools.database import execute_query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

# Configure pytest for async tests
pytestmark = pytest.mark.asyncio


class TestJobQueueCore:
    """Core job queue functionality tests."""
    
    @pytest.fixture
    async def job_service(self):
        """Create a job service instance for testing."""
        return ScrapeJobService(worker_id="test-worker-1")
    
    @pytest.fixture
    async def test_source(self):
        """Create a test documentation source."""
        source_id = str(uuid.uuid4())
        
        async def _create_source(session: AsyncSession):
            source = DocumentationSource(
                id=source_id,
                name="Test Source",
                url="https://test.example.com/docs",
                source_type=SourceType.GUIDE
            )
            session.add(source)
            await session.commit()
            return source_id
            
        return await execute_query(_create_source)
    
    @pytest.fixture(autouse=True)
    async def cleanup_jobs(self):
        """Clean up any test jobs after each test."""
        yield
        
        async def _cleanup(session: AsyncSession):
            # Delete all test jobs
            await session.execute(delete(ScrapeJob))
            await session.commit()
            
        await execute_query(_cleanup)

    async def test_queue_scrape_job_success(self, job_service, test_source):
        """Test successful job queuing."""
        job_params = {
            "crawl_depth": 3,
            "selectors": {"content": "article"},
            "max_pages": 100
        }
        
        result = await job_service.queue_scrape_job(
            source_id=test_source,
            job_params=job_params,
            priority=3
        )
        
        assert result["success"] is True
        assert "job_id" in result
        assert result["source_id"] == test_source
        assert result["status"] == ScrapeJobStatus.PENDING.value
        
        # Verify job data was stored correctly
        job_status = await job_service.get_job_status(result["job_id"])
        assert job_status is not None
        assert job_status["job_data"]["priority"] == 3
        assert job_status["job_data"]["crawl_depth"] == 3

    async def test_queue_duplicate_job_prevention(self, job_service, test_source):
        """Test prevention of duplicate jobs for same source."""
        job_params = {"crawl_depth": 2}
        
        # Queue first job
        result1 = await job_service.queue_scrape_job(
            source_id=test_source,
            job_params=job_params,
            priority=5
        )
        assert result1["success"] is True
        
        # Attempt to queue duplicate job
        result2 = await job_service.queue_scrape_job(
            source_id=test_source,
            job_params=job_params,
            priority=3
        )
        
        assert result2["success"] is False
        assert "already exists" in result2["error"]
        assert "existing_job_id" in result2

    async def test_acquire_next_job_atomic_locking(self, job_service, test_source):
        """Test atomic job acquisition with SELECT FOR UPDATE SKIP LOCKED."""
        # Create multiple sources for different priority jobs to avoid duplicate prevention
        job_params = {"test": True}
        
        # Create additional sources for each priority job
        sources = [test_source]
        for i in range(3):
            source_id = str(uuid.uuid4())
            async def _create_extra_source(session: AsyncSession, src_id=source_id, idx=i):
                source = DocumentationSource(
                    id=src_id,
                    name=f"Test Source {idx+2}",
                    url=f"https://test{idx+2}.example.com/docs",
                    source_type=SourceType.GUIDE
                )
                session.add(source)
                await session.commit()
                return src_id
            extra_source = await execute_query(_create_extra_source)
            sources.append(extra_source)
        
        jobs = []
        for i, priority in enumerate([5, 1, 3, 2]):  # Mix priorities
            result = await job_service.queue_scrape_job(
                source_id=sources[i],
                job_params={**job_params, "priority": priority},
                priority=priority
            )
            if result["success"]:
                jobs.append(result["job_id"])
        
        # Acquire jobs and verify priority ordering (1=highest priority)
        acquired_job = await job_service.acquire_next_job()
        
        assert acquired_job is not None
        assert acquired_job["job_data"]["priority"] == 1  # Highest priority
        assert acquired_job["status"] == ScrapeJobStatus.IN_PROGRESS.value
        assert acquired_job["locked_by"] == "test-worker-1"
        
        # Verify job status was updated
        job_status = await job_service.get_job_status(acquired_job["job_id"])
        assert job_status["status"] == ScrapeJobStatus.IN_PROGRESS.value
        assert job_status["locked_by"] == "test-worker-1"

    async def test_complete_job_success(self, job_service, test_source):
        """Test successful job completion."""
        # Queue and acquire a job
        result = await job_service.queue_scrape_job(
            source_id=test_source,
            job_params={"test": True},
            priority=5
        )
        
        acquired = await job_service.acquire_next_job()
        assert acquired is not None
        
        # Complete the job
        completion_result = {
            "pages_scraped": 25,
            "urls_processed": ["url1", "url2", "url3"],
            "execution_time": 120.5
        }
        
        complete_result = await job_service.complete_job(
            job_id=acquired["job_id"],
            result=completion_result
        )
        
        assert complete_result["success"] is True
        assert complete_result["status"] == ScrapeJobStatus.COMPLETED.value
        assert complete_result["pages_scraped"] == 25
        
        # Verify lock was released
        job_status = await job_service.get_job_status(acquired["job_id"])
        assert job_status["locked_by"] is None
        assert job_status["locked_at"] is None
        assert job_status["pages_scraped"] == 25

    async def test_fail_job_with_error(self, job_service, test_source):
        """Test job failure handling."""
        # Queue and acquire a job
        result = await job_service.queue_scrape_job(
            source_id=test_source,
            job_params={"test": True}
        )
        
        acquired = await job_service.acquire_next_job()
        
        # Fail the job
        error_message = "Network timeout after 30 seconds"
        fail_result = await job_service.fail_job(
            job_id=acquired["job_id"],
            error=error_message
        )
        
        assert fail_result["success"] is True
        assert fail_result["status"] == ScrapeJobStatus.FAILED.value
        assert fail_result["error_message"] == error_message
        
        # Verify job status and lock cleanup
        job_status = await job_service.get_job_status(acquired["job_id"])
        assert job_status["status"] == ScrapeJobStatus.FAILED.value
        assert job_status["error_message"] == error_message
        assert job_status["locked_by"] is None


class TestMultiWorkerCoordination:
    """Multi-worker coordination and distributed locking tests."""
    
    @pytest.fixture
    async def worker_services(self):
        """Create multiple worker services."""
        return [
            ScrapeJobService(worker_id=f"worker-{i}")
            for i in range(1, 4)
        ]
    
    @pytest.fixture
    async def test_source(self):
        """Create a test documentation source."""
        source_id = str(uuid.uuid4())
        
        async def _create_source(session: AsyncSession):
            source = DocumentationSource(
                id=source_id,
                name="Multi-Worker Test Source",
                url="https://test.example.com/multiworker",
                source_type=SourceType.GUIDE
            )
            session.add(source)
            await session.commit()
            return source_id
            
        return await execute_query(_create_source)
    
    async def test_concurrent_job_acquisition(self, worker_services, test_source):
        """Test that multiple workers can acquire different jobs concurrently."""
        # Create multiple sources to avoid duplicate prevention
        sources = [test_source]
        for i in range(4):
            source_id = str(uuid.uuid4())
            async def _create_source(session: AsyncSession, src_id=source_id, idx=i):
                source = DocumentationSource(
                    id=src_id,
                    name=f"Multi Source {idx+2}",
                    url=f"https://multi{idx+2}.example.com/docs",
                    source_type=SourceType.GUIDE
                )
                session.add(source)
                await session.commit()
                return src_id
            extra_source = await execute_query(_create_source)
            sources.append(extra_source)
        
        # Queue multiple jobs
        jobs = []
        for i in range(5):
            result = await worker_services[0].queue_scrape_job(
                source_id=sources[i],
                job_params={"job_number": i},
                priority=5
            )
            if result["success"]:
                jobs.append(result["job_id"])
        
        # Have multiple workers try to acquire jobs concurrently
        acquisition_tasks = [
            service.acquire_next_job() 
            for service in worker_services
        ]
        
        acquired_jobs = await asyncio.gather(*acquisition_tasks)
        
        # Verify no duplicate acquisitions
        non_null_jobs = [job for job in acquired_jobs if job is not None]
        job_ids = [job["job_id"] for job in non_null_jobs]
        
        assert len(job_ids) == len(set(job_ids))  # No duplicates
        assert len(non_null_jobs) <= len(worker_services)  # At most one per worker
        
        # Verify each job is locked by different workers
        worker_assignments = [job["locked_by"] for job in non_null_jobs]
        assert len(worker_assignments) == len(set(worker_assignments))

    async def test_lock_ownership_verification(self, worker_services, test_source):
        """Test that workers can only complete jobs they own."""
        # Worker 1 queues and acquires a job
        result = await worker_services[0].queue_scrape_job(
            source_id=test_source,
            job_params={"test": True}
        )
        
        acquired = await worker_services[0].acquire_next_job()
        assert acquired is not None
        
        # Worker 2 tries to complete the job owned by Worker 1
        completion_result = await worker_services[1].complete_job(
            job_id=acquired["job_id"],
            result={"pages": 10}
        )
        
        assert completion_result["success"] is False
        assert "locked by different worker" in completion_result["error"]
        
        # Worker 1 can successfully complete their own job
        completion_result = await worker_services[0].complete_job(
            job_id=acquired["job_id"],
            result={"pages": 10}
        )
        
        assert completion_result["success"] is True

    async def test_heartbeat_system(self, worker_services, test_source):
        """Test job heartbeat system for lock renewal."""
        # Acquire a job
        result = await worker_services[0].queue_scrape_job(
            source_id=test_source,
            job_params={"long_running": True}
        )
        
        acquired = await worker_services[0].acquire_next_job()
        
        # Send heartbeat
        heartbeat_result = await worker_services[0].heartbeat_job(
            job_id=acquired["job_id"]
        )
        
        assert heartbeat_result["success"] is True
        assert "heartbeat_time" in heartbeat_result
        assert "lock_expires_at" in heartbeat_result
        
        # Verify lock timestamp was updated
        job_status = await worker_services[0].get_job_status(acquired["job_id"])
        
        # Parse the timestamps and handle timezone properly
        original_lock_str = acquired["locked_at"]
        updated_lock_str = job_status["locked_at"]
        
        # Handle both Z and +00:00 timezone formats
        if original_lock_str.endswith('Z'):
            original_lock_str = original_lock_str[:-1] + '+00:00'
        if updated_lock_str.endswith('Z'):
            updated_lock_str = updated_lock_str[:-1] + '+00:00'
            
        original_lock_time = datetime.fromisoformat(original_lock_str)
        updated_lock_time = datetime.fromisoformat(updated_lock_str)
        
        assert updated_lock_time >= original_lock_time


class TestErrorHandlingRecovery:
    """Error handling and recovery scenario tests."""
    
    @pytest.fixture
    async def job_service(self):
        return ScrapeJobService(worker_id="recovery-tester")
    
    @pytest.fixture
    async def test_source(self):
        source_id = str(uuid.uuid4())
        
        async def _create_source(session: AsyncSession):
            source = DocumentationSource(
                id=source_id,
                name="Recovery Test Source",
                url="https://test.example.com/recovery",
                source_type=SourceType.GUIDE
            )
            session.add(source)
            await session.commit()
            return source_id
            
        return await execute_query(_create_source)
    
    async def test_expired_lock_cleanup(self, job_service, test_source):
        """Test cleanup of expired job locks."""
        # Create a job and manually set it to expired state
        async def _create_expired_job(session: AsyncSession):
            job_id = str(uuid.uuid4())
            # Set expired time to 2 hours ago, with 30-minute timeout
            expired_time = datetime.now(timezone.utc) - timedelta(hours=2)
            
            job = ScrapeJob(
                id=job_id,
                source_id=test_source,
                status=ScrapeJobStatus.IN_PROGRESS,
                locked_by="expired-worker",
                locked_at=expired_time,
                lock_timeout=1800  # 30 minute timeout (job expired 1.5 hours ago)
            )
            job.set_job_data({"test": "expired"})
            
            session.add(job)
            await session.commit()
            return job_id
        
        expired_job_id = await execute_query(_create_expired_job)
        
        # Run expired lock cleanup
        cleanup_result = await job_service.release_expired_locks(max_age_minutes=60)
        
        assert cleanup_result["success"] is True
        assert cleanup_result["released_count"] >= 1
        
        # Verify the job was released back to PENDING
        job_status = await job_service.get_job_status(expired_job_id)
        assert job_status["status"] == ScrapeJobStatus.PENDING.value
        assert job_status["locked_by"] is None

    async def test_queue_statistics(self, job_service, test_source):
        """Test job queue statistics functionality."""
        # Create additional sources for multiple jobs
        sources = [test_source]
        for i in range(3):
            source_id = str(uuid.uuid4())
            async def _create_stats_source(session: AsyncSession, src_id=source_id, idx=i):
                source = DocumentationSource(
                    id=src_id,
                    name=f"Stats Source {idx+2}",
                    url=f"https://stats{idx+2}.example.com/docs",
                    source_type=SourceType.GUIDE
                )
                session.add(source)
                await session.commit()
                return src_id
            extra_source = await execute_query(_create_stats_source)
            sources.append(extra_source)
        
        # Create jobs in different states
        jobs = []
        
        # Pending jobs
        for i in range(3):
            result = await job_service.queue_scrape_job(
                source_id=sources[i],
                job_params={"pending": i}
            )
            if result["success"]:
                jobs.append(result["job_id"])
        
        # In-progress job
        acquired = await job_service.acquire_next_job()
        
        # Complete one job (if we acquired one)
        if acquired:
            await job_service.complete_job(
                job_id=acquired["job_id"],
                result={"completed": True}
            )
        
        # Get statistics
        stats = await job_service.get_queue_stats()
        
        assert stats["success"] is True
        assert stats["queue_stats"]["pending_count"] >= 2
        assert stats["queue_stats"]["completed_count"] >= 1
        assert stats["active_worker_count"] >= 0


class TestPerformanceScalability:
    """Performance and scalability tests."""
    
    @pytest.fixture
    async def job_service(self):
        return ScrapeJobService(worker_id="perf-tester")
    
    @pytest.fixture
    async def test_source(self):
        source_id = str(uuid.uuid4())
        
        async def _create_source(session: AsyncSession):
            source = DocumentationSource(
                id=source_id,
                name="Performance Test Source",
                url="https://test.example.com/performance",
                source_type=SourceType.GUIDE
            )
            session.add(source)
            await session.commit()
            return source_id
            
        return await execute_query(_create_source)
    
    async def test_large_job_queue_performance(self, job_service, test_source):
        """Test performance with large number of queued jobs."""
        import time
        
        # Queue many jobs
        start_time = time.time()
        job_count = 50  # Reasonable number for testing
        
        queue_tasks = []
        for i in range(job_count):
            task = job_service.queue_scrape_job(
                source_id=test_source,
                job_params={"batch_job": i},
                priority=5
            )
            queue_tasks.append(task)
        
        # Execute queuing concurrently
        results = await asyncio.gather(*queue_tasks, return_exceptions=True)
        queue_time = time.time() - start_time
        
        # Count successful queues
        successful_queues = sum(1 for r in results 
                              if isinstance(r, dict) and r.get("success"))
        
        print(f"Queued {successful_queues}/{job_count} jobs in {queue_time:.2f}s")
        
        # Test concurrent job acquisition
        start_time = time.time()
        worker_count = 5
        workers = [ScrapeJobService(worker_id=f"perf-worker-{i}") 
                  for i in range(worker_count)]
        
        acquisition_tasks = [worker.acquire_next_job() for worker in workers]
        acquired_jobs = await asyncio.gather(*acquisition_tasks)
        
        acquisition_time = time.time() - start_time
        successful_acquisitions = sum(1 for job in acquired_jobs if job is not None)
        
        print(f"Acquired {successful_acquisitions} jobs in {acquisition_time:.2f}s")
        
        # Verify performance benchmarks
        assert queue_time < 10.0  # Should queue 50 jobs in under 10 seconds
        assert acquisition_time < 2.0  # Should acquire jobs in under 2 seconds
        assert successful_acquisitions > 0
        
        # Get final statistics
        stats = await job_service.get_queue_stats()
        assert stats["success"] is True

    async def test_job_cleanup_performance(self, job_service, test_source):
        """Test cleanup performance with old jobs."""
        # Create some completed jobs with old timestamps
        async def _create_old_jobs(session: AsyncSession):
            old_time = datetime.now(timezone.utc) - timedelta(days=8)
            
            for i in range(10):
                job_id = str(uuid.uuid4())
                job = ScrapeJob(
                    id=job_id,
                    source_id=test_source,
                    status=ScrapeJobStatus.COMPLETED,
                    completed_at=old_time
                )
                job.set_job_data({"old_job": i})
                session.add(job)
            
            await session.commit()
        
        await execute_query(_create_old_jobs)
        
        # Test cleanup performance
        import time
        start_time = time.time()
        
        cleanup_result = await job_service.cleanup_completed_jobs(max_age_days=7)
        
        cleanup_time = time.time() - start_time
        
        assert cleanup_result["success"] is True
        assert cleanup_result["deleted_count"] >= 10
        assert cleanup_time < 5.0  # Should cleanup in under 5 seconds
        
        print(f"Cleaned up {cleanup_result['deleted_count']} jobs in {cleanup_time:.2f}s")


if __name__ == "__main__":
    # Run specific test for quick verification
    import pytest
    pytest.main([__file__, "-v", "--tb=short"])