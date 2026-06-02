"""Job status + history routes."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from opensecai.runtime.job_runner import get_job_manager
from opensecai.schemas.job import Job

router = APIRouter(prefix="/jobs", tags=["jobs"])


class JobList(BaseModel):
    jobs: list[Job]


@router.get("", response_model=JobList)
def list_jobs(project: str | None = Query(default=None)) -> JobList:
    return JobList(jobs=get_job_manager().list(project=project))


@router.get("/{job_id}", response_model=Job)
def get_job(job_id: str) -> Job:
    job = get_job_manager().get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.post("/{job_id}/cancel", status_code=202)
async def cancel_job(job_id: str) -> dict:
    ok = await get_job_manager().cancel(job_id)
    if not ok:
        raise HTTPException(status_code=409, detail="job not running")
    return {"cancelled": True}
