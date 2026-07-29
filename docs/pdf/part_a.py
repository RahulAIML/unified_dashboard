"""Front matter, product overview, architecture, multi-tenancy, auth."""
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import PageBreak, Paragraph, Spacer, Table, TableStyle

from pdfkit import (
    BULLETS, CAP, CODE, CONTENT_W, H1, H2, H3, INK, KV, MUTED, NOTE, NUMBERED,
    P, RED, RULE, S, TABLE, TEAL, ZEBRA,
)


def cover(build_date, commit):
    ttl = ParagraphStyle('ttl', fontName='Helvetica-Bold', fontSize=31, leading=36,
                         textColor=INK, alignment=TA_CENTER)
    sub = ParagraphStyle('sub', fontName='Helvetica', fontSize=13.5, leading=19,
                         textColor=RED, alignment=TA_CENTER)
    small = ParagraphStyle('small', fontName='Helvetica', fontSize=9.4, leading=14,
                           textColor=MUTED, alignment=TA_CENTER)
    kicker = ParagraphStyle('kick', fontName='Helvetica-Bold', fontSize=9.6, leading=13,
                            textColor=RED, alignment=TA_CENTER)

    f = [Spacer(1, 52 * mm)]
    f.append(Paragraph('ROLPLAY', kicker))
    f.append(Spacer(1, 3 * mm))
    f.append(Paragraph('Unified Analytics Dashboard', ttl))
    f.append(Spacer(1, 5 * mm))
    f.append(Paragraph('End-to-End Engineering Documentation', sub))
    f.append(Spacer(1, 9 * mm))

    bar = Table([['']], colWidths=[52 * mm], rowHeights=[1.6 * mm])
    bar.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, -1), RED)]))
    bar.hAlign = 'CENTER'
    f.append(bar)
    f.append(Spacer(1, 9 * mm))

    f.append(Paragraph(
        'One multi-tenant dashboard serving every Rolplay client, whatever '
        'backend their data lives in &mdash; architecture, data pipelines, '
        'schemas, API reference, and the AI dashboard builder.', small))
    f.append(Spacer(1, 26 * mm))

    meta = Table(
        [['Document', 'End-to-end technical documentation'],
         ['Repository', 'Rolplay_Dashboard_Project'],
         ['Branch / commit', commit],
         ['Generated', build_date],
         ['Audience', 'Engineering, technical leadership, onboarding'],
         # Plain strings here, not Paragraphs: XML entities would not be parsed.
         ['Classification', 'Internal — confidential']],
        colWidths=[42 * mm, 92 * mm])
    meta.setStyle(TableStyle([
        ('FONT', (0, 0), (0, -1), 'Helvetica-Bold', 8.4),
        ('FONT', (1, 0), (1, -1), 'Helvetica', 8.4),
        ('TEXTCOLOR', (0, 0), (0, -1), INK),
        ('TEXTCOLOR', (1, 0), (1, -1), MUTED),
        ('LINEBELOW', (0, 0), (-1, -2), 0.4, RULE),
        ('TOPPADDING', (0, 0), (-1, -1), 4.2),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4.2),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ]))
    meta.hAlign = 'CENTER'
    f.append(meta)
    f.append(PageBreak())
    return f


def contents():
    f = H1('Contents')
    rows = [
        ['1', 'What we are building, and why', 'Problem, goals, non-negotiable principles'],
        ['2', 'System architecture', 'Layers, request lifecycle, repository layout'],
        ['3', 'Multi-tenancy', 'Three resolution mechanisms, dynamic tenants, caching'],
        ['4', 'Authentication and authorization', 'Postgres auth DB, JWT, guards, partial access'],
        ['5', 'Data pipelines (connectors)', 'Every upstream, how they differ, module gating'],
        ['6', 'Data schemas', 'Postgres auth DB, tenant config, MySQL analytics, AI tables'],
        ['7', 'API reference', 'All Next.js routes and the FastAPI AI service'],
        ['8', 'TypeScript domain contracts', 'Shared types the UI and routes agree on'],
        ['9', 'AI dashboard builder', 'Agent pipeline, job phases, guided configuration flow'],
        ['10', 'Frontend structure', 'Routes, components, client state, dynamic rendering'],
        ['11', 'Localization and demo mode', 'ES/EN dictionary, seeded demo engine, scoping'],
        ['12', 'Technology stack', 'Versions, tooling, test suite'],
        ['13', 'Deployment and configuration', 'Environment variables, targets, migrations'],
        ['14', 'Known issues and open items', 'Verified discrepancies and what is still pending'],
    ]
    f += TABLE(['#', 'Section', 'Covers'], rows, [5, 33, 62])
    f += NOTE(
        'Every fact in this document was read out of the repository at the commit '
        'on the cover page. Where the code and an older migration disagree, both '
        'are stated and the live behaviour is identified &mdash; see section 14 '
        'rather than assuming the migration is authoritative.',
        label='On accuracy.')
    f.append(PageBreak())
    return f


def s1_product():
    f = H1('1.  What we are building, and why')

    f.append(H2('1.1  The problem'))
    f.append(P(
        'Rolplay sells AI-driven commercial simulation and coaching. Over time each '
        'client was delivered a **bespoke dashboard**, wired directly to whichever '
        'backend happened to hold that client\'s data. The result was roughly a dozen '
        'separate frontends with duplicated logic, no shared design language, and a '
        'per-client engineering cost every time a metric or a branding tweak was '
        'requested. Onboarding a new client meant building a new dashboard.'))
    f.append(P(
        'The upstreams genuinely differ &mdash; they are not one API behind a wall. '
        'Some clients are served by an action-dispatch bridge over MySQL, some by '
        'pre-existing Flask REST services, some by a knowledge-base product with its '
        'own API and token, and one by a raw read-only SQL endpoint. Any unification '
        'had to absorb that variety rather than pretend it away.'))

    f.append(H2('1.2  What this project is'))
    f.append(P(
        '**One multi-tenant Next.js dashboard** that serves every client. A user signs '
        'in with their work email; the platform resolves which client they belong to, '
        'which upstream holds their data, and which modules they actually have &mdash; '
        'then renders only those. No per-client frontend, no per-client deploy.'))
    f += BULLETS([
        '**A single codebase, many tenants.** Tenant identity is resolved at request '
        'time from the session, never from a build-time constant.',
        '**Connector-per-upstream, one contract.** Each backend gets an adapter that '
        'normalizes into shared types, so pages are written once against those types.',
        '**Capability-driven rendering.** The navigation and pages are generated from '
        'what the tenant demonstrably has, not from a hardcoded per-client layout.',
        '**Self-service onboarding.** An admin registers a client through a wizard, '
        'or the AI builder discovers and generates the dashboard, with no code change.',
    ])

    f.append(H2('1.3  Product surface'))
    f += TABLE(
        ['Module', 'What it measures', 'Where the data comes from'],
        [['Simulator', 'Practice-conversation sessions, scores, pass rate',
          'Pharma bridge, coach_app MySQL, or rolplay.app SQL'],
         ['Master Coach', 'Coaching sessions and derived coaching insights',
          'Separate activity IDs (kpi tenants) or a coaching lens on sim rows'],
         ['Certifier Coach', 'Formal certification attempts, pass/fail',
          'Only where a genuinely separate certification source is confirmed'],
         ['LMS', 'Course enrollments, completion rate, quiz scores',
          'LearnWorlds API (lib/lms-learnworlds.ts), per-tenant credentials'],
         ['Second Brain', 'Knowledge-base org, members, documents',
          'Dedicated Second Brain REST API and token &mdash; never the SQL bridge'],
         ['Conversational / Objections', 'Objection handling and model answers',
          'Bridge objections endpoint, capability-gated'],
         ['Business Lines', 'Per-business-line performance', 'Members-tag catalog, capability-gated'],
         ['Organization', 'Roster: members, admins, supervisors', 'Bridge org endpoints, capability-gated']],
        [16, 34, 50])

    f.append(H2('1.4  Principles the code actually enforces'))
    f.append(P(
        'These are not aspirations; they are invariants with tests and code comments '
        'defending them, and they explain most of the design decisions in this document.'))
    f += NUMBERED([
        '**Never invent data.** A metric with no verified upstream returns empty or '
        'null &mdash; never zero-as-a-number and never another module\'s figures. A '
        'tenant without Coach Maestro must not see its Simulator numbers relabelled '
        '"Coach Maestro"; a tenant without an LMS must not see session counts labelled '
        '"courses". Nullable means "no data upstream", zero means "measured zero".',
        '**Capability before render.** Contracted intent and verified data are separate '
        'facts. A module renders only when the tenant has it AND it has data.',
        '**Tenant isolation by construction.** customer_id is re-resolved at login '
        'rather than trusted from the user row, so a stale value cannot leak another '
        'client\'s data. Second Brain deliberately has no shared fallback org.',
        '**Fail honestly.** When an upstream errors, the route surfaces the error. '
        'Module discovery is the one deliberate exception: it fails open to the full '
        'module set rather than hiding a client\'s real data behind an outage.',
        '**No hardcoded client layouts.** Everything a client sees is derived from '
        'tenant config plus live probes, which is what makes the AI builder possible.',
    ])
    f.append(PageBreak())
    return f


def s2_architecture():
    f = H1('2.  System architecture')

    f.append(H2('2.1  Layers'))
    f.append(P(
        'Four layers, with a strict rule: **connectors are server-only**. They hold '
        'secrets and upstream URLs, so no client component may import them. Pages '
        'reach data exclusively through route handlers.'))
    f += CODE("""
 BROWSER          Next.js App Router pages + React client components
                  zustand store (filters, date range)  |  useApi() hooks
                       |  fetch, cookies: accessToken (HTTP-only)
                       v
 EDGE             middleware.ts -- page-route auth redirects only.
                  Explicitly SKIPS /api/*, injects no tenant headers.
                       v
 SERVER           app/api/**/route.ts   (runtime: nodejs)
                  1. getAuthContextFromRequest()  -> {userId, email, customerId}
                  2. useDemoData(email)?           -> synthetic payload, done
                  3. resolveOrgType(email, customerId)
                       -> 'banco' | 'pharma' | 'rolplay-app' | 'analytics' | 'none'
                  4. dispatch to exactly ONE connector
                  5. buildSuccess(data, meta) -> {success, data, meta}
                       v
 CONNECTORS       lib/bridge-pharma-analytics.ts   pharma action bridges (3 kinds)
 (server only)    lib/bridge-client.ts             PHP SQL bridge -> coach_app
                  lib/bridge-banco*.ts             Banco, domain-scoped
                  lib/bridge-rolplay-app.ts        rolplay.app raw SQL endpoint
                  lib/second-brain-api.ts          Second Brain REST + token
                  lib/lms-learnworlds.ts           LearnWorlds LMS API
                       v
 UPSTREAMS        MySQL (coach_app, rolplay_pro) | per-tenant bridge containers
                  Flask REST (exceltis) | Second Brain API | LearnWorlds API
                  Postgres (auth + tenant config + AI service tables)
""")

    f.append(H2('2.2  The request lifecycle, concretely'))
    f.append(P(
        'A GET of the Simulator page\'s KPI row resolves like this. The ordering is '
        'load-bearing: the demo check precedes tenant resolution so a demo session '
        'never touches a real upstream, and tenant resolution precedes dispatch so no '
        'connector is ever called with an unresolved tenant.'))
    f += NUMBERED([
        'Browser requests `/api/dashboard/overview?from=..&to=..&solution=simulator` '
        'with the `accessToken` cookie.',
        '`getAuthContextFromRequest()` verifies the JWT (HS256, `jose`) and yields '
        '`{userId, email, customerId}`. No row read, so this is cheap.',
        '`useDemoData(email)` short-circuits for Rolplay-owned domains.',
        '`resolveOrgType()` classifies the caller. For pharma it awaits '
        '`ensureDynamicTenantsLoaded()`, so DB-registered tenants are visible.',
        'The matching connector runs. `isUnsupportedModule()` decides whether this '
        'module is real for this tenant, returning empty rather than blended data.',
        '`buildSuccess()` wraps the payload with `meta.source`, which names the '
        'pipeline that served it &mdash; the fastest way to diagnose wrong numbers.',
    ])
    f += NOTE(
        '`meta.source` is the debugging entry point. `pharma-apotex` means the pharma '
        'bridge served it; `demo` means synthetic; `fallback` means module discovery '
        'failed open; `lms-not-configured` means the tenant has no LMS. If a client '
        'reports wrong numbers, read `meta.source` before reading any code.',
        label='Operational tip.')

    f.append(H2('2.3  Repository layout'))
    f += TABLE(
        ['Path', 'Contents'],
        [['`app/`', 'App Router pages and all `api/**/route.ts` handlers'],
         ['`lib/`', 'Connectors, auth, tenant resolution, types, demo engine, i18n'],
         ['`lib/demo/`', 'Seeded deterministic demo data engine and its scoping guard'],
         ['`lib/hooks/`', 'Client data hooks: `useApi`, `useAvailableModules`, snapping'],
         ['`components/`', 'Shared UI, charts, shadcn primitives'],
         ['`migrations/`', 'Numbered SQL migrations (001-005)'],
         ['`ai-service/`', 'FastAPI + LangGraph dashboard-builder service (Python)'],
         ['`docs/`', 'Onboarding runbooks, tenant isolation, wireframes'],
         ['`rolplay-bridge.php`', 'The PHP SQL bridge deployed alongside MySQL upstreams']],
        [22, 78])
    f += NOTE(
        'The `dashboard/` directory and anything under `.claude/worktrees/` are '
        'duplicates of the main tree and are excluded from the vitest config. Do not '
        'edit them; changes there do not ship.',
        accent=colors.HexColor('#B45309'), label='Careful.')
    f.append(PageBreak())
    return f


def s3_tenancy():
    f = H1('3.  Multi-tenancy')

    f.append(P(
        'Three resolution mechanisms coexist because the upstreams identify clients '
        'in three incompatible ways. This is deliberate: collapsing them into one '
        'scheme would break at least one real client. `lib/org-type.ts` is the single '
        'classifier, and it is checked in a fixed priority order.'))

    f += TABLE(
        ['Org type', 'Keyed by', 'Resolved in', 'Notes'],
        [['`banco`', 'Email domain', '`lib/org-type.ts` + `BANCO_EMAIL_DOMAINS`',
          'Never customer_id: `banco_users` has no email column'],
         ['`pharma`', 'Email domain -> tenant key', '`resolvePharmaTenant(email)`',
          'DB map > env map > built-in aliases'],
         ['`rolplay-app`', 'Explicit login -> client_id', '`resolveRolplayAppAccess()`',
          'Domain is unusable: clients share `audioweb.com.mx`'],
         ['`analytics`', '`customer_id` from the JWT', 'Resolved at login, stamped in token',
          '`0` = authenticated but unlinked -> empty state'],
         ['`none`', '&mdash;', '&mdash;', 'Authenticated with no reachable data source']],
        [13, 24, 30, 33])

    f.append(H2('3.1  Why customer_id is re-resolved at login'))
    f.append(P(
        '`app/api/auth/login/route.ts` calls `resolveCustomerIdByEmail()` on every '
        'login and stamps the result into the JWT, **deliberately refusing** to reuse '
        'the stored `users.customer_id`. If a user is moved between clients upstream, '
        'a stored value would be stale, and a stale tenant id is a cross-tenant data '
        'leak. Re-resolving costs one bridge call per login and removes that class of '
        'bug entirely.'))

    f.append(H2('3.2  Dynamic tenants'))
    f.append(P(
        '`TENANT_CONFIG` in `lib/pharma-tenant.ts` starts as a mutable record of '
        'hand-verified static defaults, then merges rows from the `pharma_tenants` '
        'Postgres table over it. That merge is what lets an admin onboard a client '
        'through the UI with no deploy.'))
    f += BULLETS([
        '`ensureDynamicTenantsLoaded()` caches in-process for '
        '`DYNAMIC_TENANTS_TTL_MS = 30_000`, de-duplicates concurrent loads behind a '
        'single in-flight promise, and treats DB failure as non-fatal (static '
        'defaults keep serving).',
        '**Capability flags are OR-ed** with the static values, so a sparse DB row can '
        '*enable* a capability but never silently *drop* one that was verified in code.',
        '`ucids` and `coachActivityIds` fall back to the static values when the DB row '
        'omits them &mdash; an empty allowlist would widen a tenant\'s scope, not narrow it.',
        'Deactivated tenants are removed from `TENANT_CONFIG` via '
        '`previouslyLoadedDynamicKeys`, so deactivation takes effect rather than '
        'lingering until restart.',
        '`invalidateDynamicTenantsCache()` is called by every admin write, so changes '
        'are visible immediately instead of after the TTL.',
    ])
    f += NOTE(
        '`resolvePharmaTenant()` and `resolveOrgType()` are the only places that await '
        'the dynamic load. Everything downstream reads `TENANT_CONFIG` synchronously. '
        'Keep it that way: awaiting deeper in a connector would reintroduce races.',
        label='Invariant.')

    f.append(H2('3.3  Branding is keyed separately'))
    f.append(P(
        '`customer_id` collapses to `0` for every non-coach tenant, so it cannot key '
        'branding. `brandingTenantKey()` in `lib/db-branding.ts` produces '
        '`cust:<id>` when `customer_id > 0` and `domain:<email-domain>` otherwise, '
        'with a unique index on `tenant_key` (migration 004).'))
    f.append(PageBreak())
    return f


def s4_auth():
    f = H1('4.  Authentication and authorization')

    f.append(P(
        'Users live in a **separate PostgreSQL database** (`AUTH_DATABASE_URL`), '
        'reached only through `lib/db-auth.ts`. Analytics data never lands there. That '
        'separation means a client\'s analytics upstream can be swapped without '
        'touching identity, and an auth outage degrades rather than exposes.'))

    f += KV([
        ('User store', 'Postgres: `users`, `user_sessions`. Pool singleton on '
                       '`global.__authPool`; `sslmode` stripped from the URL.'),
        ('Errors', '`AuthDbError` with codes `NOT_CONFIGURED`, `CONNECTION_FAILED`, '
                   '`TABLE_MISSING`, `DUPLICATE_EMAIL`, `QUERY_FAILED`.'),
        ('Passwords', '`bcryptjs` via `lib/password.ts`.'),
        ('Tokens', '`jose`, HS256. Access 8 h (`JWT_SECRET`), refresh 7 d '
                   '(`REFRESH_SECRET`). Claims: `user_id`, `email`, `customer_id`, `jti`.'),
        ('Transport', 'HTTP-only cookies `accessToken` and `refreshToken`. No tokens '
                      'in URLs or localStorage.'),
        ('Sessions', '`user_sessions.token_jti` records refresh-token identity, so '
                     'logout can invalidate a specific refresh token.'),
    ], widths=(20, 80))

    f.append(H2('4.1  Two guards, two jobs'))
    f += TABLE(
        ['Guard', 'Applies to', 'Behaviour'],
        [['`middleware.ts`', 'Page routes only',
          'Redirects unauthenticated users to `/auth/login` and authenticated users '
          'away from login/register. Skips `/api/*`, `/_next/*`, `/`, `/privacy`, '
          '`/terms`. Injects **no** auth or tenant headers.'],
         ['`lib/server-auth.ts`', 'Every API route',
          '`getAuthContextFromRequest()` verifies the cookie and returns the context '
          '(accepting `customerId === 0`). `requireAdminFromRequest()` additionally '
          'loads the user row, because **role is not in the JWT**.']],
        [17, 17, 66])
    f += NOTE(
        'Middleware skipping `/api/*` is intentional, not an oversight: every route '
        'handler authenticates itself. The consequence is that **adding a route means '
        'adding its guard** &mdash; there is no blanket API protection to inherit. '
        'Two diagnostic routes are currently unauthenticated by design; see section 14.',
        accent=colors.HexColor('#B45309'), label='Consequence.')

    f.append(H2('4.2  Role model'))
    f.append(P(
        'Roles are `user` and `admin` (CHECK-constrained). Role deliberately lives '
        'outside the JWT so that revoking admin takes effect immediately rather than '
        'at token expiry; the cost is one extra `findUserById()` per admin request. '
        'Only the five `/api/admin/tenants*` handlers are role-gated. '
        '`/api/auth/setup` is gated by a shared secret (`SETUP_SECRET`) instead, '
        'because it must run before any admin exists.'))

    f.append(H2('4.3  Partial access'))
    f.append(P(
        'A user may legitimately have some data sources and not others, so access is '
        'not binary. `getAccessStatus()` in `lib/multi-source-auth.ts` backs '
        '`GET /api/auth/access-status`, which reports `hasCoachData`, '
        '`hasSecondBrainData`, `hasPharmaAccess`, `hasBancoAccess`, '
        '`hasRolplayAppAccess` and `hasAnyAccess`. Pages gate on these individually '
        'rather than hard-blocking a user who lacks one source.'))

    f.append(H2('4.4  Client-side session handling'))
    f.append(P(
        '`components/AuthProvider.tsx` calls `/api/auth/me` on mount. On a 401 it '
        'attempts a silent `POST /api/auth/refresh` and retries once, so an expired '
        'access token does not bounce an active user to the login screen. '
        '`/api/auth/me` falls back to JWT claims when the auth DB is unreachable, '
        'keeping a signed-in user signed in through a database blip.'))
    f.append(PageBreak())
    return f
