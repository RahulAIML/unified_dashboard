"""Connector registry.

Adding support for a new data source (a new REST API, SQL DB, GraphQL, SaaS
connector) means adding one module here that produces a ServiceDescriptor — the
agents above never change. That is the extension point for future domains.
"""
from __future__ import annotations

from .coach_app import CoachAppConnector
from .rolplay_app import RolplayAppConnector
from .rolplay_pharma import RolplayPharmaConnector
from .second_brain import SecondBrainConnector

__all__ = [
    "RolplayPharmaConnector",
    "CoachAppConnector",
    "SecondBrainConnector",
    "RolplayAppConnector",
]
