from typing import Literal
from pydantic import BaseModel, Field


class RunSummary(BaseModel):
    fixed: int = Field(ge=0, description="Vulnerabilities present in start scan but absent in end scan")
    persisted: int = Field(ge=0, description="Vulnerabilities present in both start and end scans")
    new: int = Field(ge=0, description="Vulnerabilities absent in start scan but present in end scan")


class DepScanIndexEntry(BaseModel):
    run_id: str = Field(
        pattern=r"^\d{8}_\d{6}$",
        description="Unique run identifier (format: YYYYMMDD_HHMMSS)",
        examples=["20260531_172601"],
    )
    timestamp: str = Field(
        description="UTC completion time in ISO 8601 format",
        examples=["2026-05-31T19:00:00Z"],
    )
    status: Literal["completed", "failed", "partial"]
    summary: RunSummary
