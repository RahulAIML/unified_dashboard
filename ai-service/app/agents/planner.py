"""Agent 1 — Planner. Breaks the manager's request into the ordered task plan."""
from __future__ import annotations

from ..models import GenerateRequest
from .base import LogFn

PLAN = [
    "Locate company",
    "Find available services",
    "Discover endpoints",
    "Understand schema",
    "Generate dashboard",
    "Validate",
    "Preview",
    "Publish",
]


async def run(req: GenerateRequest, log: LogFn) -> list[str]:
    await log("planning", "info", f"Planning dashboard for '{req.company}'"
              + (f" with exercise IDs {req.exercise_ids}" if req.exercise_ids else " (IDs to be discovered)"))
    for i, step in enumerate(PLAN, 1):
        await log("planning", "info", f"  {i}. {step}")
    return PLAN
