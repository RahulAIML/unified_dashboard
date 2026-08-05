"""
Shared AI Assistant Harness — Reusable for all embedded assistants.

Provides context building, prompt routing, and confidence gating to ensure
all Rolplay assistants meet the quality standard: analytical (interpret data)
+ navigational (guide users through the product).

Reference: docs/AI_ASSISTANT_HARNESS_STANDARD.md
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Any


class Confidence(str, Enum):
    """Response confidence level, used for gating."""
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


@dataclass
class AssistantContext:
    """Platform context provided to every assistant.

    This is the starting point for all assistant queries. It bundles:
    - User/org metadata
    - Current screen state (visible data)
    - Product knowledge (glossary, navigation, benchmarks)
    - Historical context (trends, baselines)

    The assistant never operates in isolation; it always has the data it needs
    to provide grounded, contextual answers.
    """

    # User/Organization
    user_email: str
    user_role: str  # "admin", "manager", "learner"
    org_name: str

    # Current View (where the user is NOW)
    current_page: str  # "overview", "ranking", "lms", "certification", etc.
    current_dashboard_slug: Optional[str] = None
    current_filters: dict = None  # date range, solution filters, cohort

    # Data Context
    visible_metrics: list[dict] = None  # [{"id": "tile_1", "title": "Total Users", "value": 150}, ...]
    visible_data: dict = None  # Full JSON of what's on the page
    available_reports: list[str] = None  # ["export-csv", "drilldown-q3", ...]

    # Product Knowledge
    product_glossary: dict = None  # {"COACH": "Master Coach module", "bloque_time": "..."}
    navigation_map: dict = None  # {"leaderboard": "/ranking", "reports": "/reports"}
    data_dictionary: dict = None  # Metric definitions and units

    # Performance Baselines
    benchmarks: dict = None  # {"pass_rate_target": 75, "certification_pace": "X/week"}
    org_historical: dict = None  # {"last_week_avg_score": 82, "30d_trend": "up 5%"}

    def __post_init__(self):
        """Fill in defaults for optional fields."""
        self.current_filters = self.current_filters or {}
        self.visible_metrics = self.visible_metrics or []
        self.visible_data = self.visible_data or {}
        self.available_reports = self.available_reports or []
        self.product_glossary = self.product_glossary or {}
        self.navigation_map = self.navigation_map or {}
        self.data_dictionary = self.data_dictionary or {}
        self.benchmarks = self.benchmarks or {}
        self.org_historical = self.org_historical or {}


@dataclass
class AssistantResponse:
    """Response with confidence gating.

    The assistant only returns responses grounded in evidence. Low-confidence
    answers are replaced with "I don't have enough context" rather than
    speculative text.
    """

    content: str  # The answer
    confidence: Confidence  # How sure are we?
    evidence_count: int  # Number of data points cited
    citations: list[str] = None  # Specific data/sources referenced

    def __post_init__(self):
        self.citations = self.citations or []

    def is_grounded(self) -> bool:
        """Only return if confidence >= MEDIUM AND evidence > 0."""
        return (
            self.confidence in [Confidence.HIGH, Confidence.MEDIUM]
            and self.evidence_count > 0
        )


class IntentDetector:
    """Classify user questions as analytical or navigational."""

    ANALYTICAL_TRIGGERS = [
        "why", "what's the trend", "is that normal", "should we",
        "what does this mean", "is that good", "compared to",
        "improve", "drop", "increase", "decrease", "how much",
        "what changed", "when did", "trending"
    ]

    NAVIGATIONAL_TRIGGERS = [
        "where is", "how do i", "how do i find", "where can i",
        "what does this button do", "where's the", "how do you",
        "how to", "how to export", "what is", "what's" + " a "
    ]

    @classmethod
    def is_analytical(cls, question: str) -> bool:
        """Detect if question asks for interpretation/insight."""
        q_lower = question.lower()
        return any(trigger in q_lower for trigger in cls.ANALYTICAL_TRIGGERS)

    @classmethod
    def is_navigational(cls, question: str) -> bool:
        """Detect if question asks for navigation/product help."""
        q_lower = question.lower()
        return any(trigger in q_lower for trigger in cls.NAVIGATIONAL_TRIGGERS)


class PromptBuilder:
    """Build system + user prompts with full context."""

    ANALYTICAL_SYSTEM = """You are an analytics coach for sales-enablement dashboards.
Your role is to INTERPRET data, not RESTATE it.

HARD RULES:
1. NEVER restate what is already visible ("Total score is 85"). ALWAYS add interpretation.
2. Cite data precisely: "improved from 78 to 85 (+9%)" not "went up".
3. Provide context: benchmarks, peer comparison, or historical trend.
4. Suggest action if unclear: "Pass rate of 65% is below target 75%; recommend focusing on X."
5. If data is insufficient, say so rather than speculate: "Not enough data for a trend yet."
6. Acknowledge uncertainty: "Likely cause is..." not "The cause is..."

Available metrics and definitions:
{METRIC_DEFINITIONS}

Organization benchmarks and history:
{HISTORICAL_CONTEXT}

Current screen data:
{VISIBLE_DATA}"""

    NAVIGATIONAL_SYSTEM = """You are a product guide for Rolplay dashboards.
Help users find features and understand the platform.

HARD RULES:
1. ALWAYS provide click-by-click navigation, not just "it's in X page".
2. Explain WHY a feature exists and WHEN to use it.
3. Disambiguate Rolplay terminology clearly.
4. If the user can't access something, explain why (e.g., "requires org size >5").
5. Contextualize to their current location: "From where you are on {PAGE}, click..."
6. If you're not sure, say so: "I'm not certain of the exact path; ask your admin."

Navigation map:
{NAVIGATION_MAP}

Product glossary:
{GLOSSARY}

Current page and available actions:
{CURRENT_PAGE_CONTEXT}"""

    @classmethod
    def build_analytical_prompt(cls, context: AssistantContext, question: str) -> tuple[str, str]:
        """Build (system, user) prompts for analytical questions."""

        system = cls.ANALYTICAL_SYSTEM.format(
            METRIC_DEFINITIONS=json.dumps(context.data_dictionary, indent=2),
            HISTORICAL_CONTEXT=json.dumps({
                "benchmarks": context.benchmarks,
                "org_history": context.org_historical
            }, indent=2),
            VISIBLE_DATA=json.dumps(context.visible_data, indent=2)
        )

        user = f"""Current page: {context.current_page}
Filters: {json.dumps(context.current_filters)}
Visible data: {json.dumps(context.visible_metrics, indent=2)}

Question: {question}

Analyze this data. Provide insight (not a summary).
Cite numbers exactly. Reference benchmarks or historical context if available.
Suggest next steps if unclear."""

        return system, user

    @classmethod
    def build_navigational_prompt(cls, context: AssistantContext, question: str) -> tuple[str, str]:
        """Build (system, user) prompts for navigational questions."""

        system = cls.NAVIGATIONAL_SYSTEM.format(
            PAGE=context.current_page,
            NAVIGATION_MAP=json.dumps(context.navigation_map, indent=2),
            GLOSSARY=json.dumps(context.product_glossary, indent=2),
            CURRENT_PAGE_CONTEXT=json.dumps({
                "current_page": context.current_page,
                "available_reports": context.available_reports,
                "filters": context.current_filters
            }, indent=2)
        )

        user = f"""Current page: {context.current_page}
User role: {context.user_role}

Question: {question}

Answer with specific navigation steps:
1. Starting point (where they are now)
2. Step-by-step click path
3. Explanation of what they'll see
4. Why this feature exists (context)

If they can't reach it from their current view, say so."""

        return system, user


class ConfidenceAssessor:
    """Assess response confidence based on evidence."""

    @classmethod
    def assess(
        cls,
        response: str,
        context: AssistantContext,
        question: str
    ) -> Confidence:
        """Rate confidence: HIGH, MEDIUM, or LOW."""

        # Count citations (numbers, specific references)
        citation_count = cls._count_citations(response)

        # Check if grounded in context
        has_visible_data = len(context.visible_data) > 0
        has_historical = len(context.org_historical) > 0
        has_benchmarks = len(context.benchmarks) > 0

        # High confidence: multiple data points + good context
        if citation_count >= 3 and has_visible_data and (has_historical or has_benchmarks):
            return Confidence.HIGH

        # Medium confidence: some data + limited context
        if citation_count >= 1 and has_visible_data:
            return Confidence.MEDIUM

        # Low confidence: speculative or no data
        return Confidence.LOW

    @classmethod
    def _count_citations(cls, response: str) -> int:
        """Count how many concrete numbers/facts are cited."""
        import re
        # Look for patterns like "123", "45%", "improved 20"
        numbers = re.findall(r"\d+\.?\d*%?", response)
        return len(numbers)


# Example usage (for documentation):
"""
async def answer_question_with_harness(
    context: AssistantContext,
    question: str,
    llm_call: Callable
) -> AssistantResponse:
    '''Use the harness to answer a question grounded in context.'''

    # Detect intent
    is_analytical = IntentDetector.is_analytical(question)
    is_navigational = IntentDetector.is_navigational(question)

    # Route and build prompts
    if is_analytical:
        system, user = PromptBuilder.build_analytical_prompt(context, question)
    elif is_navigational:
        system, user = PromptBuilder.build_navigational_prompt(context, question)
    else:
        # Default to analytical (safer fallback)
        system, user = PromptBuilder.build_analytical_prompt(context, question)

    # Call LLM
    answer = await llm_call(system, user)

    # Assess confidence
    confidence = ConfidenceAssessor.assess(answer, context, question)
    citation_count = ConfidenceAssessor._count_citations(answer)

    response = AssistantResponse(
        content=answer,
        confidence=confidence,
        evidence_count=citation_count
    )

    # Gate: only return if grounded
    if not response.is_grounded():
        response.content = (
            "I don't have enough context to answer that accurately. "
            "Can you provide more details about what you're seeing, or try a more specific question?"
        )

    return response
"""
