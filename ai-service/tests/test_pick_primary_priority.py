"""pick_primary priority order.

Found live: Takeda's cached knowledge had coach_app_sql ranked above
rolplay_app_sql, so a wrong/coincidental match from CoachAppConnector's broad
domain LIKE probe won out over rolplay_app_sql's match on r_client.name --
where Takeda's real, verified account (client_id=13) actually lives. Pinning
the corrected order here so it cannot silently flip back.
"""
import unittest

from app.agents.service_discovery import pick_primary, pick_secondary
from app.models import CompanyKnowledge, ServiceDescriptor, ServiceKind


def _svc(kind: ServiceKind, has_data: bool = True) -> ServiceDescriptor:
    return ServiceDescriptor(
        kind=kind, name=kind.value, base_url="https://x.test",
        alive=True, has_data=has_data, handle={}, endpoints=[],
    )


def _knowledge(*services: ServiceDescriptor) -> CompanyKnowledge:
    k = CompanyKnowledge(company="Test", slug="test")
    k.services = list(services)
    return k


class PickPrimaryPriorityTests(unittest.TestCase):
    def test_rolplay_app_sql_beats_coach_app_sql(self):
        k = _knowledge(_svc(ServiceKind.coach_app_sql), _svc(ServiceKind.rolplay_app_sql))

        primary = pick_primary(k)

        self.assertEqual(primary.kind, ServiceKind.rolplay_app_sql)

    def test_coach_app_sql_still_beats_second_brain(self):
        k = _knowledge(_svc(ServiceKind.second_brain), _svc(ServiceKind.coach_app_sql))

        primary = pick_primary(k)

        self.assertEqual(primary.kind, ServiceKind.coach_app_sql)

    def test_pharma_kpi_still_outranks_rolplay_app_sql(self):
        k = _knowledge(_svc(ServiceKind.rolplay_app_sql), _svc(ServiceKind.pharma_kpi))

        primary = pick_primary(k)

        self.assertEqual(primary.kind, ServiceKind.pharma_kpi)

    def test_only_services_with_data_are_preferred(self):
        # coach_app_sql alive but empty; rolplay_app_sql alive WITH data --
        # having data should win regardless of the kind-priority ordering.
        k = _knowledge(_svc(ServiceKind.coach_app_sql, has_data=True), _svc(ServiceKind.rolplay_app_sql, has_data=False))

        primary = pick_primary(k)

        self.assertEqual(primary.kind, ServiceKind.coach_app_sql)

    def test_falls_back_to_no_data_services_when_none_have_data(self):
        k = _knowledge(_svc(ServiceKind.coach_app_sql, has_data=False), _svc(ServiceKind.rolplay_app_sql, has_data=False))

        primary = pick_primary(k)

        self.assertEqual(primary.kind, ServiceKind.rolplay_app_sql)

    def test_no_services_returns_none(self):
        self.assertIsNone(pick_primary(_knowledge()))


class PickSecondaryTests(unittest.TestCase):
    """Besins found live: rolplay_app_sql (3 sessions) AND coach_app_sql (17
    sessions) both alive with real data. pick_primary correctly keeps
    rolplay_app_sql (stronger match-type signal) -- pick_secondary must
    surface coach_app_sql rather than silently dropping its 17 sessions."""

    def test_returns_the_other_service_with_data(self):
        k = _knowledge(_svc(ServiceKind.rolplay_app_sql), _svc(ServiceKind.coach_app_sql))
        primary = pick_primary(k)

        secondary = pick_secondary(k, primary)

        self.assertEqual(primary.kind, ServiceKind.rolplay_app_sql)
        self.assertEqual(secondary.kind, ServiceKind.coach_app_sql)

    def test_none_when_only_the_primary_has_data(self):
        k = _knowledge(_svc(ServiceKind.rolplay_app_sql, has_data=True), _svc(ServiceKind.coach_app_sql, has_data=False))
        primary = pick_primary(k)

        self.assertIsNone(pick_secondary(k, primary))

    def test_none_when_there_is_only_one_service(self):
        k = _knowledge(_svc(ServiceKind.rolplay_app_sql))
        primary = pick_primary(k)

        self.assertIsNone(pick_secondary(k, primary))

    def test_picks_the_next_best_by_the_same_priority_order_among_three(self):
        # pharma_kpi is primary; both rolplay_app_sql and second_brain also
        # have data -- secondary should be rolplay_app_sql (higher priority
        # than second_brain), not just "whichever was found first".
        k = _knowledge(_svc(ServiceKind.second_brain), _svc(ServiceKind.rolplay_app_sql), _svc(ServiceKind.pharma_kpi))
        primary = pick_primary(k)

        secondary = pick_secondary(k, primary)

        self.assertEqual(primary.kind, ServiceKind.pharma_kpi)
        self.assertEqual(secondary.kind, ServiceKind.rolplay_app_sql)

    def test_none_when_primary_is_none(self):
        self.assertIsNone(pick_secondary(_knowledge(), None))


if __name__ == "__main__":
    unittest.main()
