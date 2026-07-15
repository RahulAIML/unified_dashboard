"""Shared agent types."""
from __future__ import annotations

from typing import Awaitable, Callable

# log(phase, level, message)
LogFn = Callable[[str, str, str], Awaitable[None]]
