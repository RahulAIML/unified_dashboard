"""Drive the LangGraph pipeline end-to-end and print phases + preview."""
import asyncio
import sys

sys.path.insert(0, ".")

from app.graph import run_generation_graph
from app.models import GenerateRequest, JobState


async def run(company: str, ids: list[int]):
    print(f"\n{'='*64}\nLANGGRAPH: {company} ids={ids or '-'}\n{'='*64}")
    job = JobState(job_id="g", request=GenerateRequest(company=company, exercise_ids=ids))
    seen = set()

    async def update(j: JobState):
        if j.logs:
            lg = j.logs[-1]
            k = (lg.phase, lg.message)
            if k not in seen:
                seen.add(k)
                print(f"  [{j.percent:3d}%] {lg.message}")

    await run_generation_graph(job, update)
    print(f"  final phase={job.phase.value}")
    if job.preview:
        vals = [f"{w.widget_id}={w.value}" for w in job.preview.widgets if w.value is not None]
        print(f"  preview: {vals}")


async def main():
    await run("Apotex", [])
    await run("Nonexistentco", [])  # exercises the no-service error branch


if __name__ == "__main__":
    asyncio.run(main())
