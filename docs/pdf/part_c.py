"""API reference, domain contracts, AI builder, frontend, i18n/demo."""
from reportlab.lib import colors
from reportlab.platypus import PageBreak

from pdfkit import BULLETS, CAP, CODE, H1, H2, H3, KV, NOTE, NUMBERED, P, TABLE

AMBER = colors.HexColor('#B45309')


def s7_api():
    f = H1('7.  API reference')

    f.append(P(
        'All Next.js handlers run on the Node runtime and return the envelope '
        '`{success, data, meta}` via `buildSuccess()` / `buildApiError()`. `meta.source` '
        'names the pipeline that served the request. Because `middleware.ts` skips '
        '`/api/*`, **each handler authenticates itself**.'))
    f.append(CAP(
        'Auth column: "Session" = valid `accessToken` cookie (401 otherwise); '
        '"ADMIN" = session plus `role === \'admin\'` (403 otherwise); '
        '"None" = unauthenticated by design. Required params are marked *.'))

    f.append(H2('7.1  Dashboard data'))
    f += TABLE(
        ['Route', 'Auth', 'Returns', 'Params'],
        [['`GET /api/dashboard/overview`', 'Session',
          'KPI totals, avg score, pass rate, plus the previous period for deltas',
          '`from`*, `to`*, `solution`, `usecaseIds`'],
         ['`GET /api/dashboard/trends`', 'Session',
          'Score, pass/fail and eval-count series; optional score distribution',
          '`from`*, `to`*, `solution`, `granularity`, `compare`, `usecaseIds`'],
         ['`GET /api/dashboard/results`', 'Session', 'Evaluation result rows',
          '`from`*, `to`*, `solution`, `limit` (default 50, max 200), `usecaseIds`'],
         ['`GET /api/dashboard/usecase-breakdown`', 'Session',
          'Per-usecase / per-simulator aggregation', '`from`*, `to`*, `solution`, `usecaseIds`'],
         ['`GET /api/dashboard/best-performers`', 'Session',
          'Leaderboard; adds all-time stats where `hasTopStats`',
          '`from`*, `to`*, `limit` (1-5), `solution`, `usecaseIds`'],
         ['`GET /api/dashboard/lms`', 'Session',
          'LMS course metrics: enrollments, completion rate, quiz scores, per-course rows',
          '`from`*, `to`*'],
         ['`GET /api/dashboard/business-lines`', 'Session',
          'Business-line catalog; empty unless `hasBusinessLines`', '`from`*, `to`*'],
         ['`GET /api/dashboard/objections`', 'Session',
          'Objection handling; empty unless `hasObjections`', '`from`*, `to`*'],
         ['`GET /api/dashboard/organization`', 'Session',
          'Current-state roster: members, admins, supervisors', 'none (current state)'],
         ['`GET /api/dashboard/modules`', 'Session',
          'Which modules this tenant has. **Fails open** to the full set on error',
          'none'],
         ['`GET /api/dashboard/data-bounds`', 'Session',
          'Real data span for snapping the default range; `null` if unknown', 'none'],
         ['`GET /api/dashboard/drilldown/[savedReportId]`', 'Session',
          'Single saved-report detail', 'path id (400 if not numeric)'],
         ['`GET /api/banco`', 'Session', 'Isolated Banco KPIs plus 20 recent sessions',
          '`from`, `to` (default trailing 30 d)'],
         ['`GET /api/second-brain/profile`', 'Session',
          'Second Brain org profile, **phone numbers masked**', 'none']],
        [30, 9, 34, 27], font_size=7.3)

    f.append(H2('7.2  Authentication'))
    f += TABLE(
        ['Route', 'Auth', 'Purpose'],
        [['`POST /api/auth/login`', 'Public',
          'Verify password, **re-resolve `customer_id`**, set both cookies'],
         ['`POST /api/auth/register`', 'Public', 'Create user, resolve tenant, issue cookies'],
         ['`POST /api/auth/logout`', 'Cookie', 'Invalidate the refresh `jti`, clear cookies'],
         ['`GET /api/auth/me`', 'Session', 'Current user; falls back to JWT claims if the DB is down'],
         ['`POST /api/auth/refresh`', 'Refresh cookie', 'Issue a new access token'],
         ['`GET /api/auth/access-status`', 'Session', 'Which data sources this user can reach'],
         ['`GET /api/auth/setup`', '`?secret=SETUP_SECRET`',
          'Create/upgrade the auth schema. 503 when the secret is unset']],
        [26, 18, 56])

    f.append(H2('7.3  Admin (role-gated)'))
    f += TABLE(
        ['Route', 'Purpose'],
        [['`GET /api/admin/tenants`', 'List DB tenants plus static `TENANT_CONFIG` and domain maps'],
         ['`POST /api/admin/tenants`', 'Register or upsert a tenant and its domain mappings'],
         ['`PATCH /api/admin/tenants/[key]`', 'Partial update of a DB-registered tenant'],
         ['`DELETE /api/admin/tenants/[key]`', 'Soft-delete (deactivate)'],
         ['`POST /api/admin/tenants/probe`', 'Heuristic auto-detect of a bridge kind from a URL']],
        [32, 68])
    f.append(CAP(
        'POST body: `tenantKey`*, `displayName`*, `kind`*, `url`*, `ucids`*, `xTenant`, '
        'the `has*` capability flags, `coachActivityIds`, `authHeaderName`, '
        '`authHeaderValue`, `domains`.'))
    f += NOTE(
        'The probe endpoint returns a **suggestion, not a decision**. Bridge kinds are '
        'inferred from response shape, which is ambiguous for some endpoints, so the '
        'wizard requires a human to confirm before saving.',
        label='By design.')

    f.append(H2('7.4  Utility and diagnostics'))
    f += TABLE(
        ['Route', 'Auth', 'Purpose'],
        [['`POST /api/ai`', 'Session', 'LLM Q&amp;A over dashboard context'],
         ['`GET,POST /api/ai/[...path]`', '**None**',
          'Reverse proxy to the FastAPI service; 502 when unreachable'],
         ['`GET /api/branding`', 'Session', 'Branding settings and resolved client brand'],
         ['`PUT /api/branding`', 'Session', 'Save branding (validated and normalized)'],
         ['`GET /api/health`', '**None**', 'Bridge connectivity and env diagnostics'],
         ['`GET /api/debug/banco-test`', 'Session', 'Three raw bridge probes; not admin-gated'],
         ['`GET /api/debug/second-brain-check`', '**None**', 'Second Brain lookup by email or org']],
        [30, 13, 57])
    f += NOTE(
        'Three routes are reachable without a session: `/api/health`, '
        '`/api/ai/[...path]` and `/api/debug/second-brain-check`. The last two accept '
        'parameters and reach upstreams, so they should be gated before a public '
        'deployment. Tracked in section 14.',
        accent=AMBER, label='Security note.')
    f.append(PageBreak())

    f.append(H2('7.5  AI service (FastAPI)'))
    f.append(P(
        'Mounted at `/ai` by `ai-service/app/main.py`. Reached from the browser through '
        'the Next.js proxy at `/api/ai/*`. **No endpoint carries auth**, so the service '
        'must not be exposed publicly &mdash; the proxy is the intended entry point.'))
    f += TABLE(
        ['Method and path', 'Purpose', 'Request -> Response'],
        [['`GET /health`', 'Health, `llm_enabled`, `db_configured`', '-> dict'],
         ['`POST /ai/discover-company`', 'Company discovery, no persist', '`CompanyIn` -> `CompanyKnowledge`'],
         ['`POST /ai/discover-services`', 'Company + service discovery, persists', '`CompanyIn` -> `CompanyKnowledge`'],
         ['`POST /ai/generate-dashboard`', 'Create a background job', '`GenerateRequest` -> `JobState`'],
         ['`GET /ai/status/{job_id}`', 'Poll job state (404 if unknown)', '-> `JobState`'],
         ['`POST /ai/provide-ids`', 'Resume a job paused at `needs_ids` (409 if not waiting)',
          '`ProvideIdsIn` -> `JobState`'],
         ['`POST /ai/confirm-services`', 'Resume a job paused at `review_services`',
          '`ConfirmServicesIn` -> `JobState`'],
         ['`POST /ai/generate-sync`', 'Whole pipeline in one request (serverless-friendly)',
          '`GenerateRequest` -> `JobState`'],
         ['`POST /ai/publish`', 'Publish a job\'s config; registers domain routing',
          '`PublishIn` -> `{published, slug}`'],
         ['`GET /ai/dashboard/{slug}`', 'Published config, metadata only', '-> `DashboardConfig`'],
         ['`GET /ai/render/{slug}`', 'Published config **plus** live widget preview',
          '-> `{config, preview}`'],
         ['`DELETE /ai/knowledge/{slug}`', 'Drop cached discovery so the next run re-probes',
          '-> `{cleared}`']],
        [27, 41, 32], font_size=7.4)
    f.append(PageBreak())
    return f


def s8_contracts():
    f = H1('8.  TypeScript domain contracts')

    f.append(P(
        'These types in `lib/types.ts` are the contract every connector normalizes '
        'into and every page reads. Adding a client means writing an adapter to these '
        'types, not adding a branch to a page.'))

    f.append(H2('8.1  Envelope and filters'))
    f += CODE("""
ApiResponse<T>  { success: boolean; data: T; meta: ApiMeta }
ApiMeta         { filters: Record<string, unknown>; timestamp: string; source: string }

Module          'lms' | 'coach' | 'simulator' | 'certification' | 'second-brain'
DateRange       { from: Date; to: Date }
DashboardFilters{ selectedModules: Module[]; dateRange: DateRange; customerId?: number }

KpiCard         { label, labelKey, value: number|string, delta: number,
                  unit?: string, tier: 'A'|'B', noComparison?: boolean }
TimeSeriesPoint { date: string /* YYYY-MM-DD */; value: number; value2?: number }
""")

    f.append(H2('8.2  Live API response shapes'))
    f.append(P(
        'Null is meaningful throughout: `avgScore: null` means the upstream reported no '
        'scores, which is different from an average of zero. Pages must render "no '
        'data" for null and a real zero for `0`.'))
    f += CODE("""
OverviewApiResponse   { totalEvaluations, avgScore|null, passRate|null,
                        passedEvaluations, prevTotalEvaluations,
                        prevAvgScore|null, prevPassRate|null }
TrendsApiResponse     { scoreTrend, passFailTrend, evalCountTrend,
                        scoreDistribution?: ScoreDistributionBucket[] }
EvaluationApiRow      { savedReportId, usecaseId|null, usecaseName|null,
                        score|null, result|null, passed, date }
UsecaseApiRow         { usecaseId, usecase_name|null, totalEvaluations,
                        avgScore|null, passRate|null, passed }
BestPerformerRow      { user_email, user_name|null, sessions, avg_score, pass_rate }
  allTimeStats?       { totalRecords, avgBestScore, recordsGe80,
                        uniqueUsers, uniqueSims }        -- hasTopStats only
ObjectionRow          { usecaseId, objectionText, count, passRate,
                        modelAnswer|null, topAnswers: {text, name}[] }
BusinessLineRow       { tagId, name, memberCount, simCount, avgScore|null, activeUsers }
OrganizationApiResponse { totalMembers, totalAdmins, totalSupervisors,
                          members: OrgMemberRow[], admins: OrgAdminRow[] }

LmsApiResponse        { configured: boolean, enrolledUsers, totalEnrollments,
                        totalCourses, modulesCompleted,
                        completionRate|null, avgQuizScore|null,
                        completionTrend: ApiTrendPoint[], courses: LmsCourseRow[] }
LmsCourseRow          { courseId, name, enrolled, completed,
                        completionRate|null, avgScore|null }
""")
    f += NOTE(
        '`LmsApiResponse` is deliberately **not** shaped like `OverviewApiResponse`. An '
        'LMS measures course progress (enrolled, completed, quiz score); a Simulator '
        'measures scored practice sessions. Sharing one response type is what let '
        'Simulator figures render under an LMS heading, so the types are kept apart on '
        'purpose. `configured: false` is the signal to render an empty state.',
        label='Why LMS has its own contract.')

    f.append(H2('8.3  Tenant and identity types'))
    f += CODE("""
AuthUser        { id, email, full_name, customer_id, role: 'user'|'admin', created_at }
JwtClaims       { user_id, email, customer_id, jti, iat, exp }
AccessStatus    { hasCoachData, hasSecondBrainData, hasAnyAccess }

PharmaTenant    = string        -- open, not a literal union: wizard-registered
                                -- tenants must be representable at runtime
TenantConfig    { kind: 'sale_exercises'|'kpi'|'exceltis_rest'
                  url, xTenant?, ucids?: number[]
                  hasCertification?, hasObjections?, hasBusinessLines?
                  hasOrganization?, hasTopStats?, hasLms?, hasSimulator?
                  coachActivityIds?: number[]
                  authHeaderName?, authHeaderValue? }
PharmaTenantRow -- camelCase view of the pharma_tenants row, plus isActive/timestamps
""")
    f.append(CAP(
        '`PharmaTenant` was narrowed to a literal union originally; it had to be '
        'widened to `string` so tenants registered at runtime through the admin wizard '
        'are expressible without a code change.'))
    f.append(PageBreak())
    return f


def s9_builder():
    f = H1('9.  AI dashboard builder')

    f.append(P(
        'The builder exists to make onboarding a data operation. It probes a client\'s '
        'upstream, works out which services and metrics exist, proposes a dashboard '
        'layout, validates every widget against live data, and publishes a config that '
        'the frontend renders generically. `ai-service/app/agents/` holds one agent per '
        'stage; `workflow.py` is the sequential runtime the API uses, mirrored by a '
        'formal LangGraph `StateGraph` in `graph.py`.'))
    f += NOTE(
        'The LLM is **optional**. With no `anthropic` key the agents fall back to '
        'heuristics, and `asyncpg` is optional too, so the builder runs with neither an '
        'LLM nor a database. That keeps onboarding usable in local development and '
        'stops the pipeline from being a hard dependency on model availability.',
        label='Degrades deliberately.')

    f.append(H2('9.1  Job phases'))
    f += CODE("""
queued -> planning -> company_discovery -> service_discovery
                                             |
                            (bridge cannot list its own IDs)
                                             v
                                        [needs_ids]  <-- human input
                                             |
       -> schema_discovery -> [review_services] <-- human confirmation
       -> dashboard_planning -> dashboard_config -> validation
       -> preview -> publish -> done                      (or -> error)
""")
    f.append(P(
        'The two bracketed phases are **deliberate human-in-the-loop pauses**, not '
        'failures. `needs_ids` occurs because some bridges cannot enumerate their own '
        'exercise IDs, and guessing the allowlist would silently widen or narrow a '
        'client\'s scope. `review_services` asks a human to confirm the discovered '
        'module set before anything is published.'))

    f.append(H2('9.2  Core models'))
    f += CODE("""
ServiceKind   pharma_kpi | pharma_sale_exercises | pharma_exceltis_rest
              | coach_app_sql | second_brain | rolplay_app_sql | unknown
MetricType    count | score | rate | dimension | timeseries | table
WidgetType    kpi_tile | line_chart | bar_chart | donut | table | histogram

GenerateRequest   company* (min_length 1), exercise_ids[], domains[],
                  services[]        -- contracted services, guided step 1
                  manager_request, auto_publish
CompanyKnowledge  company, slug, domains[], services[ServiceDescriptor],
                  exercise_ids[], coach_activity_ids[], last_discovery,
                  source: 'fresh'|'cache'
DiscoveredMetric  key, label, type, unit, source_kind, source_action,
                  sample_value, supported, raw_field  -- dotted path into real JSON
WidgetConfig      id, type, title, metric_key, dimension, metrics[],
                  source_kind, source_action, span (1-4), raw_field
DashboardConfig   company, slug, title, connector, connector_handle,
                  rows[DashboardRow], filters[], recommendations[],
                  branding, version, created_at
ValidationReport  ok, issues[ValidationIssue], summary, has_errors
JobState          job_id, request, phase, percent, logs[], knowledge,
                  schema_ (alias "schema"), dashboard, validation, preview,
                  published, error, pending_connector, available_modules
""")
    f.append(CAP(
        '`DiscoveredMetric.raw_field` is a dotted path into the real upstream JSON, so '
        'a published widget reads the field that was actually observed during '
        'discovery rather than a field name the model guessed.'))

    f.append(H2('9.3  Validation before publish'))
    f.append(P(
        'The `validation` and `preview` phases execute every proposed widget against '
        'live data. A widget whose metric does not resolve is reported as a '
        '`ValidationIssue` and `POST /ai/publish` returns 400 rather than shipping a '
        'dashboard with broken tiles. This is the automated form of the '
        '"never invent data" rule: a widget must prove it can render before it exists.'))

    f.append(H2('9.4  The guided configuration flow'))
    f.append(P(
        'The operator-facing flow at `/dashboard-builder` is three sections of one '
        'page &mdash; no wizard framework, no separate route.'))
    f += NUMBERED([
        '**Contracted services.** Multi-select cards (Simulator, Master Coach, '
        'Certifier Coach, LMS, Second Brain), all selected by default so a rushed '
        'operator cannot create an empty dashboard. Sent as `services[]`.',
        '**Identifier.** Company name is the only required field. The email domain is '
        'recommended (it routes logins) but can be derived from the client\'s users; '
        'exercise IDs and a Second Brain admin email sit behind **Advanced** for the '
        'exceptions.',
        '**Fetch, review, publish.** Each discovered service is listed with its real '
        'counts, plus honest "no data yet" and "not contracted" lines, and a preview '
        'of the layout. Publishing registers domain routing so the client\'s users can '
        'sign in immediately.',
    ])
    f += NOTE(
        'Step 1 captures **intent**; the platform independently verifies which of those '
        'services have data. A service that is contracted but empty is hidden rather '
        'than shown as zeros, and a service with data that was not ticked stays off. '
        'Contracted AND has-data is the condition for rendering.',
        label='The rule that matters.')
    f.append(CAP('Full wireframes: `docs/guided-config-wireframe.md`.'))
    f.append(PageBreak())
    return f


def s10_frontend():
    f = H1('10.  Frontend structure')

    f.append(P(
        'Next.js App Router. `app/layout.tsx` composes providers in a fixed order: '
        '`ThemeProvider` -> `HtmlLangSync` -> `AuthProvider` -> `ClientBrandProvider` '
        '-> `LayoutContent`. Branding must load after auth because it is tenant-scoped.'))

    f.append(H2('10.1  Routes'))
    f += TABLE(
        ['Route', 'Shows', 'Gating'],
        [['`/`', 'Landing page, or the global overview when signed in', 'Auth state'],
         ['`/simulator`', 'Simulator KPIs, score trend, per-usecase table', 'Module'],
         ['`/coach`', 'Master Coach: usecases, best performers, coaching insights', 'Module'],
         ['`/certification`', 'Certifier Coach: pass/fail stacked bar, results', 'Module'],
         ['`/lms`', 'LMS: enrollments, completion rate, quiz scores, per-course table', 'Module'],
         ['`/second-brain`', 'Members, message logs, documents', 'Module'],
         ['`/activities`', 'Per-activity list with score colouring', 'Access caps'],
         ['`/conversational`', 'Objection cards, expandable', '`hasPharmaAccess`'],
         ['`/business-lines`', 'Business-line metrics', 'Pharma + capability'],
         ['`/organization`', 'Members, admins, roles', 'Pharma + capability'],
         ['`/reports`', 'Multi-solution CSV export and report templates', 'Session'],
         ['`/drilldown/[id]`', 'One evaluation in full, on-demand ES/EN translation, CSV', 'Session'],
         ['`/settings`', 'Branding: logo, colours, theme presets, platform name', 'Session'],
         ['`/admin/tenants`', 'Client-onboarding wizard', '**Admin**'],
         ['`/dashboard-builder`', 'AI builder: guided config and job progress', 'Session'],
         ['`/d/[slug]`', 'A published AI-generated dashboard', 'Session'],
         ['`/auth/login`, `/auth/register`', 'Authentication', 'Public'],
         ['`/privacy`, `/terms`', 'Legal', 'Public']],
        [24, 56, 20])

    f.append(H2('10.2  Dynamic rendering'))
    f.append(P(
        'No page is hardcoded per client. Two mechanisms make the whole dashboard '
        'adapt: capability-driven navigation, and config-driven widget rendering.'))
    f += BULLETS([
        '`useAvailableModules()` reads `/api/dashboard/modules`; `Sidebar.tsx` filters '
        'its entries from that. While loading it assumes **all** modules, so navigation '
        'never flickers items away.',
        '`DashboardRenderer.tsx` renders an AI-generated `DashboardConfig` &mdash; rows '
        'of widgets with a `type` and a `span` &mdash; so a published dashboard needs '
        'no bespoke page component.',
        '`useSnapDateRange()` snaps the default window once to the tenant\'s real data '
        'bounds from `/api/dashboard/data-bounds`, so a new client does not open on an '
        'empty chart.',
    ])

    f.append(H2('10.3  Client state and data'))
    f += KV([
        ('`lib/store.ts`', 'zustand: `selectedModules`, `selectedSolution`, `dateRange`, '
                           '`rangeInitialized`, `refreshKey`. Default window **24 months** '
                           '&mdash; a 30-day default was hiding real history.'),
        ('`useApi()`', 'Generic fetch hook. Unwraps `{success, data, meta}`, 35 s timeout, '
                       '`credentials: \'include\'`.'),
        ('`buildApiUrl()`', 'Builds range-scoped URLs; `rk: refreshKey` busts the cache.'),
        ('Charts', '`recharts` wrappers: `ActivityLineChart`, `DonutChart`, '
                   '`ModuleBarChart`, `StackedBarChart`.'),
        ('Primitives', '`SummaryCard`, `MetricCard`, `ChartCard`, `DataTable`, '
                       '`EmptyState`, `ExportButton`, `DateRangePicker`, plus shadcn `ui/`.'),
    ], widths=(21, 79))
    f.append(PageBreak())
    return f


def s11_i18n():
    f = H1('11.  Localization and demo mode')

    f.append(H2('11.1  Localization'))
    f.append(P(
        'A static dictionary, no i18n library. `lib/translations.ts` holds flat `en` and '
        '`es` objects; `lib/lang-store.ts` is a zustand store persisted to '
        '`localStorage[\'rp-lang\']`, **defaulting to Spanish**, exposing `useT()` which '
        'components consume as `const t = useT(); t.someKey`.'))
    f += BULLETS([
        '`components/HtmlLangSync.tsx` keeps `<html lang>` in sync so Chrome\'s '
        'auto-translate does not rewrite the brand name "Rolplay" to "Roleplay".',
        '`lib/hooks/useTranslation.ts` is a **different**, AI-backed runtime translator '
        'for free-text content that comes from upstreams and cannot be pre-translated. '
        'It batches N strings into one call and caches in `sessionStorage`.',
        '`lib/field-labels.ts` and `lib/field-map.ts` normalize upstream field names '
        'into human labels, since each bridge names its columns differently.',
    ])

    f.append(H2('11.2  Demo mode'))
    f.append(P(
        'Demo mode exists for sales demonstrations, and its central risk is a real '
        'client seeing synthetic numbers. Scoping is therefore narrow and tested.'))
    f += TABLE(
        ['Property', 'Behaviour'],
        [['Activation', '`NEXT_PUBLIC_DEMO_MODE === \'true\'`, or the signed-in email is on a '
                        'Rolplay-owned domain (`rolplay.ai|app|net|com`, extendable via `DEMO_DOMAINS`)'],
         ['Single check', '`useDemoData(email)` &mdash; called in each route **before** '
                          '`resolveOrgType()`, so a demo session never reaches a real upstream'],
         ['Deterministic', 'Seeded PRNG (mulberry32) keyed off the date range plus a '
                           'per-solution salt &mdash; no flicker between reloads'],
         ['Range-aware', 'Figures scale with the selected window, so changing the range '
                         'behaves like real data'],
         ['Self-consistent', '`passedEvaluations = total x passRate`; LMS completions sum '
                             'to the per-course totals'],
         ['Module-honest', '`demoLms()` produces course metrics, not relabelled session '
                           'counts &mdash; the same rule real pipelines follow'],
         ['Guarded', '`lib/__tests__/demo-scope.test.ts` asserts a real client email '
                     'never activates demo mode']],
        [18, 82])
    f.append(CAP('Runbook: `docs/DEMO_RUNBOOK.md`.'))
    f.append(PageBreak())
    return f
