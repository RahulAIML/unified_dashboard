"""Agent 7 — Validation. Static checks over the generated config + schema."""
from __future__ import annotations

from ..models import (
    DashboardConfig,
    NormalizedSchema,
    ServiceDescriptor,
    ServiceKind,
    ValidationIssue,
    ValidationReport,
    ValidationSeverity,
)
from .base import LogFn

_NEEDS_IDS = {ServiceKind.pharma_exceltis_rest, ServiceKind.pharma_sale_exercises}


async def run(cfg: DashboardConfig, schema: NormalizedSchema, service: ServiceDescriptor, log: LogFn) -> ValidationReport:
    issues: list[ValidationIssue] = []
    metric_keys = {m.key for m in schema.metrics}
    seen_ids: set[str] = set()
    widgets = [w for r in cfg.rows for w in r.widgets]

    if not widgets:
        issues.append(ValidationIssue(severity=ValidationSeverity.error, code="no_widgets",
                                      message="Dashboard has no widgets."))

    for w in widgets:
        if w.id in seen_ids:
            issues.append(ValidationIssue(severity=ValidationSeverity.error, code="duplicate_widget",
                                          message=f"Duplicate widget id '{w.id}'.", widget_id=w.id))
        seen_ids.add(w.id)
        if w.metric_key and w.metric_key not in metric_keys:
            issues.append(ValidationIssue(severity=ValidationSeverity.error, code="missing_metric",
                                          message=f"Widget '{w.id}' uses unknown metric '{w.metric_key}'.", widget_id=w.id))

    if service.kind in _NEEDS_IDS and not cfg.connector_handle.get("exercise_ids"):
        issues.append(ValidationIssue(severity=ValidationSeverity.warning, code="missing_exercise_ids",
                                      message=f"{service.kind.value} needs exercise IDs; totals may be empty without them."))

    if not service.has_data:
        issues.append(ValidationIssue(severity=ValidationSeverity.warning, code="no_data",
                                      message="The source is reachable but returned no data for the current scope."))

    for f in cfg.filters:
        if f.type == "module" and not f.options:
            issues.append(ValidationIssue(severity=ValidationSeverity.info, code="empty_module_filter",
                                          message="Module filter has no options."))

    errors = [i for i in issues if i.severity == ValidationSeverity.error]
    warns = [i for i in issues if i.severity == ValidationSeverity.warning]
    report = ValidationReport(
        ok=not errors, issues=issues,
        summary=f"{len(errors)} error(s), {len(warns)} warning(s), {len(issues) - len(errors) - len(warns)} info.",
    )
    lvl = "error" if errors else ("warn" if warns else "success")
    await log("validation", lvl, report.summary)
    return report
