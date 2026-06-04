"""Job status, history, and lifecycle routes."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from opensecai.runtime.job_runner import get_job_manager
from opensecai.runtime.pause_manager import PauseInfo, get_pause_manager
from opensecai.schemas.job import Job

router = APIRouter(prefix="/jobs", tags=["jobs"])


class JobList(BaseModel):
    jobs: list[Job]


class DecisionRequest(BaseModel):
    decision: str


class PauseState(BaseModel):
    paused: bool
    prompt: str | None = None
    options: list[str] = []


@router.get("", response_model=JobList)
def list_jobs(project: str | None = Query(default=None)) -> JobList:
    return JobList(jobs=get_job_manager().list(project=project))


@router.get("/{job_id}", response_model=Job)
def get_job(job_id: str) -> Job:
    job = get_job_manager().get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job


@router.get("/{job_id}/pause_state", response_model=PauseState)
def get_pause_state(job_id: str) -> PauseState:
    """Return the current pause state for a job.

    The frontend can poll this (or react to a WS "pause" event) to know
    what prompt and options to show the user.
    """
    pending: PauseInfo | None = get_pause_manager().get_pending(job_id)
    if pending is None:
        return PauseState(paused=False)
    return PauseState(paused=True, prompt=pending.prompt, options=pending.options)


@router.post("/{job_id}/decision")
def resolve_pause(job_id: str, req: DecisionRequest) -> dict:
    """Send a user decision to a paused job.

    Fires the on_resume callback registered by agent_registry, which sets an
    asyncio.Event that unblocks _run_dep_scan.  That coroutine then resumes
    the LangGraph graph with Command(resume=<decision>).
    """
    ok = get_pause_manager().resolve(job_id, req.decision)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Job {job_id} is not paused")
    return {"resumed": True, "decision": req.decision}


@router.post("/{job_id}/cancel", status_code=202)
async def cancel_job(job_id: str) -> dict:
    ok = await get_job_manager().cancel(job_id)
    if not ok:
        raise HTTPException(status_code=409, detail="job not running")
    return {"cancelled": True}
