"""Manual discovery harness — runs agents 2→3→4 against the REAL bridges."""
import asyncio
import sys

sys.path.insert(0, ".")

from app.agents import company_discovery, schema_discovery, service_discovery
from app.agents.service_discovery import pick_primary


async def log(phase, level, msg):
    icon = {"success": "✓", "warn": "!", "error": "✗", "info": "·"}.get(level, "·")
    print(f"  {icon} [{phase}] {msg}")


async def discover(company: str, exercise_ids: list[int]):
    print(f"\n=== {company}  (exercise_ids={exercise_ids or '—'}) ===")
    k = await company_discovery.run(company, exercise_ids, log)
    k = await service_discovery.run(k, exercise_ids, log)
    primary = pick_primary(k)
    if not primary:
        print("  → NO SERVICE FOUND")
        return
    print(f"  → primary service: {primary.kind.value}  has_data={primary.has_data}")
    schema = await schema_discovery.run(k, primary, exercise_ids, log)
    print(f"  → metrics: {[m.key for m in schema.metrics]}")
    print(f"  → modules: {schema.modules}   date_range: {schema.date_range}")
    print(f"  → discovered exercise_ids: {k.exercise_ids[:12]}{'…' if len(k.exercise_ids) > 12 else ''}")
    print(f"  → coach_activity_ids: {k.coach_activity_ids}")


async def main():
    await discover("Apotex", [])
    await discover("Heineken", [137, 159, 173])
    await discover("Siigo", [])


if __name__ == "__main__":
    asyncio.run(main())
