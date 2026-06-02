"""Agent listing + run triggering."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from opensecai.runtime.agent_registry import get_runner, list_agents
from opensecai.runtime.job_runner import get_job_manager
from opensecai.schemas.job import Job, StartAgentRequest, StartAgentResponse

router = APIRouter(prefix="/agents", tags=["agents"])


class AgentList(BaseModel):
    agents: list[str]


@router.get("", response_model=AgentList)
def list_available_agents() -> AgentList:
    return AgentList(agents=list_agents())


@router.post("/{agent_name}/run", response_model=StartAgentResponse, status_code=202)
async def run_agent(agent_name: str, req: StartAgentRequest) -> StartAgentResponse:
    runner = get_runner(agent_name)
    if runner is None:
        raise HTTPException(status_code=404, detail=f"Unknown agent: {agent_name}")

    manager = get_job_manager()
    job: Job = await manager.start(
        agent=agent_name,
        project=req.project,
        repo_path=req.repo_path,
        runner=runner,
    )
    return StartAgentResponse(job_id=job.id)
