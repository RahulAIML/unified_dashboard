# Shared AI Assistant Harness Standard
## Rolplay AI Quality Gate (2026-08-05)

**Status**: Reference Standard (Draft)  
**Applies to**: All embedded AI assistants across Rolplay prototypes  
**Authors**: Claude Code (drafted), Hariom (agent harness baseline), Team (adoption)

---

## Problem Statement

Current AI assistants return **shallow, fact-level responses** that:
- Restate what is already visible on screen
- Provide no analytical insights or interpretation
- Cannot navigate users to features or explain product concepts
- Add no value beyond a data dump

**Root cause**: No shared harness pattern. Each assistant is built in isolation with ad-hoc prompting.

---

## Two Mandatory Capabilities

### 1. **Analytical Capability**
Interpret data and produce insight, not summaries.

**Definition**: The assistant reads raw numbers/tables and produces:
- Trend interpretation (e.g., "scores improved 15% week-over-week because...")
- Comparative analysis (e.g., "this cohort underperforms peers by...")
- Anomaly detection (e.g., "pass rate dropped 20% on this date; likely cause is...")
- Actionable implications (e.g., "3 of 5 modules need intervention based on low completion")

**NOT Analytical**:
- "Total score is 85" (restatement)
- "Pass rate is 65%" (data dump)
- "Evaluations trended up" (fact without context)

**IS Analytical**:
- "Avg score improved from 78 to 85 (+9%) over the period, driven by 3 high-performers catching up"
- "Pass rate of 65% is below the 75% benchmark for this segment; recommend re-targeting Negotiation module"
- "Evaluation count dropped 40% this week; typically recovers by day 3; monitor Friday"

---

### 2. **Navigational Capability**
Answer product questions using platform context and show click paths.

**Definition**: The assistant can:
- Explain what a metric means, where it comes from, and why it matters
- Show where a report/export/feature is located (not just "it exists")
- Provide click-by-click navigation to reach a goal
- Disambiguate Rolplay-specific terminology (COACH vs SIM, "Certifier" vs "Certification")
- Contextualize features to the user's current view

**NOT Navigational**:
- "Reports are in the Reports page" (useless)
- "Leaderboard is on the Ranking page" (no context)
- User asks "What is bloque_time?" → "It's a field in the database" (not helpful)

**IS Navigational**:
- User asks "How do I export the leaderboard?" → "Open the Ranking tab (left nav, below KPIs). The table has an Export button in the top-right. It downloads as CSV with names and scores. Takes 10 seconds."
- User asks "What does 'Trial-and-Error Index' mean?" → "It shows what % of certification attempts were made without prior coaching. High = learners rushing to cert. Navigate to KPIs → Cesar Metrics to see yours. Benchmark is <25%."
- User asks "Where can I see per-user progress?" → "Click Ranking (nav bar). That page ranks everyone by cert score, shows trends. For individual journey, click a name → detail panel opens."

---

## Harness Architecture

### Layer 1: Platform Context (Every Assistant Starts Here)

Every assistant must be initialized with:

```python
class AssistantContext:
    """Provides all relevant platform metadata to the assistant."""
    
    # User/Organization
    user_email: str
    user_role: "admin" | "manager" | "learner"
    org_name: str
    
    # Current View (where the user is NOW)
    current_page: str  # "overview", "ranking", "lms", "certification", etc.
    current_dashboard_slug: str | None  # if on a dashboard
    current_filters: dict  # date range, solution filters, cohort, etc.
    
    # Data Context
    visible_metrics: list[str]  # metric keys visible on current screen
    visible_data: dict  # actual numbers/tables user is looking at
    available_reports: list[str]  # CSV exports, drilldowns, etc. user can access
    
    # Product Knowledge
    product_glossary: dict  # "COACH" → definition, "bloque_time" → origin, etc.
    navigation_map: dict  # "where is X?" lookups (page, tab, menu path)
    data_dictionary: dict  # schema docs for metrics/fields
    
    # Performance Baselines
    benchmarks: dict  # "pass_rate_target": 75, "certification_pace": "X per week", etc.
    org_historical: dict  # "last week avg_score was X", "typical volume is Y"
```

### Layer 2: Prompt Architecture

**System Prompt Framework:**

```python
ANALYTICAL_SYSTEM = """
You are an analytics coach for sales-enablement dashboards. Your role is to interpret data,
not restate it.

HARD RULES:
1. NEVER restate what is already visible ("Total score is 85"). ALWAYS add interpretation.
2. Cite data precisely: "improved from 78 to 85 (+9%)" not "went up".
3. Provide context: benchmarks, peer comparison, or historical trend.
4. Suggest action if unclear: "Pass rate of 65% is below typical 75%; recommend focusing on module X."
5. If data is insufficient, say so rather than speculate: "Not enough data for a trend yet."
6. Acknowledge uncertainty: "Likely cause is..." not "The cause is..."

Available metrics and their meaning:
{METRIC_DEFINITIONS}

Organization benchmarks and history:
{HISTORICAL_CONTEXT}

Current screen data:
{VISIBLE_DATA}
"""

NAVIGATIONAL_SYSTEM = """
You are a product guide for Rolplay dashboards. Help users find features and understand
the platform.

HARD RULES:
1. ALWAYS provide click-by-click navigation, not just "it's in X page".
2. Explain WHY a feature exists and when to use it.
3. Disambiguate Rolplay terminology clearly.
4. If the user can't access something, explain why (e.g., "Leaderboard shows only for orgs with >5 users").
5. Contextualize to their current location: "From where you are now on the Ranking page, scroll down..."
6. If you're not sure, say so: "I'm not certain of the exact path; ask your admin."

Navigation map:
{NAVIGATION_MAP}

Product glossary:
{GLOSSARY}

Current page and available actions:
{CURRENT_PAGE_CONTEXT}
"""
```

**User Prompt Framework:**

```python
ANALYTICAL_USER_PROMPT = """
Current data on {CURRENT_PAGE}:
{VISIBLE_DATA}

Question: {USER_QUESTION}

Analyze this data. Provide insight (not a summary). 
Cite numbers exactly. Reference benchmarks or historical context if available.
Suggest next steps if unclear.
"""

NAVIGATIONAL_USER_PROMPT = """
Current page: {CURRENT_PAGE}
User role: {USER_ROLE}

Question: {USER_QUESTION}

Answer the question with specific navigation steps:
1. Starting point (where they are now)
2. Step-by-step click path
3. Explanation of what they'll see
4. Why this feature exists (context)

If they can't reach it from their current view, say so.
"""
```

### Layer 3: Confidence Gating

**Borrowed from insights.py, applied universally:**

```python
class AssistantResponse:
    content: str  # The answer
    confidence: "high" | "medium" | "low"  # Based on evidence
    evidence_count: int  # Number of data points cited
    
    def is_grounded(self) -> bool:
        """Only return if confidence >= medium AND evidence > 0."""
        return self.confidence in ["high", "medium"] and self.evidence_count > 0
```

**Rules:**
- High confidence: Multiple data points, user's current org, historical comparison available
- Medium confidence: Sufficient data but limited context (e.g., single metric, first-time user)
- Low confidence: Speculative or insufficient evidence → **Return "I don't have enough context" instead**

**Never fabricate**:
```python
# DO NOT do this:
# "Based on typical patterns, you probably have X"

# DO this:
# "I don't have historical data for your org yet to compare. Check your reports for last month's benchmark."
```

---

## Implementation Checklist

### For All New Assistants

- [ ] **Initialize with AssistantContext** — Pass user, org, current page, visible data, platform metadata
- [ ] **Separate prompts** — One system+user pair for analysis, one for navigation (not mixed)
- [ ] **Confidence gating** — Only respond if grounded in evidence; otherwise say "insufficient context"
- [ ] **Cite precisely** — "65% pass rate (48 of 74)" not "65%"
- [ ] **Provide context** — Compare to benchmark or historical trend in every response
- [ ] **Test for shallow responses** — Before deploy, verify it doesn't restate visible data
- [ ] **Navigation must be click-by-click** — "Navigate to X" is not navigation; "Click X, then Y" is

### For Integrations (Embedding in Existing Assistants)

1. **Audit current assistant** — Collect 10 recent Q&A examples; grade: restatement vs. insight
2. **Inject platform context** — Wire visible data + navigation map into prompt
3. **Apply confidence gating** — Screen out low-confidence responses
4. **A/B test** — Deploy to 20% of users; measure: "Did this answer help?" (yes/no)
5. **Iterate** — Refine glossary, benchmarks, navigation map based on feedback

---

## Reference Implementation

### Step 1: Fetch Platform Context

```python
async def build_assistant_context(
    user_email: str,
    current_page: str,
    visible_data: dict
) -> AssistantContext:
    """Gather everything the assistant needs to answer analytically."""
    
    # Fetch org metadata
    org = await db.get_org_by_user(user_email)
    
    # Fetch visible dashboard/page data
    visible_metrics = {w['id']: w for w in visible_data.get('widgets', [])}
    
    # Fetch org history for context
    historical = await db.get_org_metrics_history(org.id, days=90)
    
    # Load product knowledge
    glossary = load_json("docs/product-glossary.json")
    nav_map = load_json("docs/navigation-map.json")
    
    return AssistantContext(
        user_email=user_email,
        org_name=org.name,
        current_page=current_page,
        visible_metrics=visible_metrics,
        visible_data=visible_data,
        org_historical=historical,
        product_glossary=glossary,
        navigation_map=nav_map,
    )
```

### Step 2: Route to Correct Prompt

```python
async def answer_question(
    context: AssistantContext,
    question: str
) -> AssistantResponse:
    """Route to analytical or navigational prompt based on question type."""
    
    # Detect intent
    is_analytical = detect_analytical_intent(question)
    # Examples: "Why did...", "What's the trend", "Is X normal", "Should we..."
    
    is_navigational = detect_navigational_intent(question)
    # Examples: "Where is...", "How do I...", "How do I export", "What does X mean"
    
    if is_analytical:
        response = await run_analytical(context, question)
    elif is_navigational:
        response = await run_navigational(context, question)
    else:
        # Ambiguous; try analytical first (safer fallback)
        response = await run_analytical(context, question)
    
    # Confidence gate
    if not response.is_grounded():
        return AssistantResponse(
            content="I don't have enough context to answer that accurately. "
                    "Can you provide more details about what you're seeing?",
            confidence="low",
            evidence_count=0
        )
    
    return response
```

### Step 3: Build Prompts with Context

```python
async def run_analytical(
    context: AssistantContext,
    question: str
) -> AssistantResponse:
    """Answer with insight, not summary."""
    
    system = f"""
    {ANALYTICAL_SYSTEM}
    
    Metric definitions: {json.dumps(context.data_dictionary)}
    Benchmarks: {json.dumps(context.benchmarks)}
    Org history (last 90d): {json.dumps(context.org_historical)}
    """
    
    user = f"""
    Current page: {context.current_page}
    Visible data: {json.dumps(context.visible_data)}
    
    Question: {question}
    """
    
    answer = await gemini_or_claude(system, user)
    
    return AssistantResponse(
        content=answer,
        confidence=assess_confidence(answer, context),
        evidence_count=count_citations(answer)
    )
```

---

## Validation Checklist (Before Declaring Standard)

Test each assistant against this benchmark:

### Analytical Validation

- [ ] **No restatements** — Ask "What's the score?"; should not respond "The score is 85"
- [ ] **Citations with context** — Ask "How's the trend?"; must cite numbers + comparison (baseline, prior period, or peer)
- [ ] **Action-oriented** — Ask "Is this OK?"; must reference a benchmark and suggest next step
- [ ] **Handles uncertainty** — Ask about data that doesn't exist; should say "insufficient data" not speculate

### Navigational Validation

- [ ] **Click-by-click** — Ask "How do I export this?"; must give exact path (not "go to reports")
- [ ] **Contextual** — Should reference current page; "From where you are now, click..."
- [ ] **Explains features** — Ask "What is the Ranking page?"; must explain why it exists + when to use
- [ ] **Disambiguates terms** — Ask "What's COACH?"; should explain concisely and link to where it appears

### Production Validation

- [ ] **Confidence gating works** — Inject false/incomplete data; assistant should decline to answer
- [ ] **No hallucination** — Create question about non-existent feature; assistant should say "That doesn't exist"
- [ ] **Latency acceptable** — Response time < 3 seconds (user-facing)
- [ ] **Cost reasonable** — Token usage < $0.05 per interaction (if using external LLM)

---

## Team Adoption Path

### Phase 1: Shared Harness Available (Today)
- Document published
- Template code in `ai-service/agents/harness.py`
- Reference implementation for dashboard Q&A

### Phase 2: First Adoption (Buddhadeb/Hariom) — DONE (2026-08-06)
- Assistant retrofitted: "Robin AI" (`components/ai-assistant.tsx` → `/api/ai` → `lib/ai.ts`), formerly "Ask AI" — the main dashboard's embedded Q&A widget
- Retrofit: added `AssistantContext`-equivalent (`PRODUCT_GLOSSARY` + `NAVIGATION_MAP` in `lib/ai.ts`), intent detection routing to a separate analytical/navigational system prompt each, and `hasGroundedContext()` confidence gating that declines rather than guesses when dashboard data hasn't loaded
- **Validation**: `lib/__tests__/ai-harness.test.ts` — 19/19 passing. Covers: confidence gating declines without calling the model; navigational questions proceed on empty context; intent routes to the correct system prompt; analytical prompt forbids restatement and requires citation; navigational prompt requires a click-by-click path; response never echoes the question back; retry-on-short-response preserved; response language matches the UI's EN/ES toggle regardless of the question's own language; navigational answers are contextualized to the person's current page and account role (denies admin-only paths to a non-admin rather than describing them)
- A/B test with 20% of users — not yet run (needs product/analytics team)
- Follow-up fixes found via live production testing, all shipped: the API route was masking every real error behind one generic message (now surfaces the actual cause); Gemini's default "thinking" was silently consuming the whole output-token budget, cutting answers off mid-sentence (`thinkingBudget: 0` fixed it); responses ignored the site's language toggle; answers could be generically vague instead of grounded in the specific data/path available

### Phase 3: Scale Across Prototypes
- Apply to second-most-used assistant
- Standardize the pattern across Rolplay
- Team members (Subhankar, Mario) adopt and validate new assistants
- Monthly audit: random sample of responses; grade quality

### Phase 4: Continuous Improvement
- Collect user feedback: "Did this help?" (binary)
- Refine glossary/benchmarks based on FAQ
- Retire assistants that don't meet standard (don't improve)

---

## Files to Create

1. **docs/ai-assistant-harness-standard.md** (this file)
2. **ai-service/agents/harness.py** — Reusable context builder and prompt framework
3. **docs/product-glossary.json** — Definitions for Rolplay terms
4. **docs/navigation-map.json** — Click paths for all features
5. **tests/test_assistant_quality.py** — Validation checklist tests

---

## Success Metrics

- **Adoption**: All new assistants built using this harness by 2026-09-01
- **Quality**: Assistants pass analytical + navigational validation 100%
- **User signal**: >70% of users rate assistant responses as "helpful" (A/B test)
- **Business**: Reduced support tickets related to "I don't know where X is"

---

**Drafted by**: Claude Code (2026-08-05)  
**Phase 2 validated**: Claude Code (2026-08-06) — see Phase 2 above  
**Next step**: Hariom reviews the Robin AI retrofit as the reference implementation, then picks the second assistant (e.g. the Dashboard Builder's AI Insights step) for Phase 3
