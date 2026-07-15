"""Drive the full generation pipeline (no HTTP) and print the result + live preview."""
import asyncio
import sys

sys.path.insert(0, ".")

from app.models import GenerateRequest, JobState
from app.workflow import run_generation


async def run(company: str, ids: list[int]):
    print(f"\n{'='*70}\nGENERATE: {company}  ids={ids or '—'}\n{'='*70}")
    job = JobState(job_id="test", request=GenerateRequest(company=company, exercise_ids=ids))
    last_phase = None

    async def update(j: JobState):
        nonlocal last_phase
        if j.logs:
            lg = j.logs[-1]
            key = (lg.phase, lg.message)
            if key != last_phase:
                icon = {"success": "✓", "warn": "!", "error": "✗", "info": "·"}.get(lg.level, "·")
                print(f"  [{j.percent:3d}%] {icon} {lg.message}")
                last_phase = key

    await run_generation(job, update)

    if job.dashboard:
        print(f"\n  DASHBOARD: {job.dashboard.title}  connector={job.dashboard.connector.value}")
        for row in job.dashboard.rows:
            print(f"    ▸ {row.title}: {[w.type.value+':'+ (w.metric_key or w.dimension or w.id) for w in row.widgets]}")
    if job.validation:
        print(f"  VALIDATION: ok={job.validation.ok}  {job.validation.summary}")
    if job.preview:
        print("  LIVE PREVIEW:")
        for wp in job.preview.widgets:
            if wp.value is not None:
                print(f"    - {wp.widget_id}: {wp.value}")
            elif wp.series:
                print(f"    - {wp.widget_id}: {len(wp.series)} trend points (e.g. {wp.series[0]})")
            elif wp.rows:
                print(f"    - {wp.widget_id}: {len(wp.rows)} rows (e.g. {wp.rows[0]})")
            else:
                print(f"    - {wp.widget_id}: EMPTY ({wp.error})")


async def main():
    await run("Apotex", [])
    await run("Heineken", [137, 159, 173])
    await run("Siigo", [])


if __name__ == "__main__":
    asyncio.run(main())
