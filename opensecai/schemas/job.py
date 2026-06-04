"""Job + JobEvent schemas — shared between API responses and WS streams."""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

JobStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


class Job(BaseModel):
    id: str = Field(description="Job UUID")
    agent: str = Field(description="Agent name (e.g. dep_scan)")
    project: str = Field(description="Target project name")
    status: JobStatus
    started_at: str = Field(description="ISO 8601 UTC timestamp")
    finished_at: Optional[str] = None
    error: Optional[str] = None


class JobEvent(BaseModel):
    """One event in the job's stream — log lines, status changes, etc."""
    job_id: str
    kind: Literal["log", "status", "error", "done", "pause"]
    payload: str
    timestamp: str


class StartAgentRequest(BaseModel):
    project: str
    repo_path: Optional[str] = None


class StartAgentResponse(BaseModel):
    job_id: str
