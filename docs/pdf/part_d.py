"""Tech stack, deployment/config, known issues and open items."""
from reportlab.lib import colors
from reportlab.platypus import PageBreak

from pdfkit import BULLETS, CAP, CODE, H1, H2, H3, KV, NOTE, NUMBERED, P, TABLE

AMBER = colors.HexColor('#B45309')
RED = colors.HexColor('#DC2626')


def s12_stack():
    f = H1('12.  Technology stack')

    f.append(H2('12.1  Next.js application'))
    f += TABLE(
        ['Concern', 'Choice', 'Version'],
        [['Framework', 'Next.js, App Router', '16.2.2'],
         ['UI runtime', 'React', '19.2.4'],
         ['Language', 'TypeScript', '5.x'],
         ['Client state', 'zustand', '5.0.12'],
         ['Styling', 'Tailwind CSS (`@tailwindcss/postcss`), shadcn 4, `@base-ui/react` 1.3', '4.x'],
         ['Charts', 'recharts', '3.8.1'],
         ['Animation / icons', 'framer-motion 12, lucide-react 1.7', '&mdash;'],
         ['Dates', 'date-fns', '4.x'],
         ['Postgres driver', 'pg', '8.20'],
         ['MySQL driver', 'mysql2 (fallback / local direct mode)', '3.22'],
         ['Auth', '`jose` (used by `lib/jwt.ts`), `bcryptjs` 3', '&mdash;'],
         ['Branding', 'colorthief (logo palette extraction)', '&mdash;'],
         ['Tests', 'vitest + jsdom, `@testing-library/react` 16, `@vitest/coverage-v8`', '4.1.5'],
         ['Lint', 'ESLint 9 + `eslint-config-next`', '9.x']],
        [22, 62, 16])
    f += NOTE(
        '`AGENTS.md` records that this Next.js major has breaking changes relative to '
        'older conventions. Read the relevant guide under `node_modules/next/dist/docs/` '
        'before writing new routing or data-fetching code rather than relying on '
        'recalled Next.js patterns.',
        accent=AMBER, label='Read before coding.')

    f.append(H3('Test suite'))
    f.append(P(
        '67 tests. `vitest.config.ts` sets the `@` alias and excludes '
        '`.claude/worktrees/` and the self-referential `dashboard/` directory, which '
        'would otherwise be collected twice.'))
    f += BULLETS([
        '`lib/__tests__/org-type.test.ts` &mdash; the tenant classifier, the highest-risk '
        'function for cross-tenant leaks.',
        '`lib/__tests__/bridge-banco-analytics.test.ts` &mdash; the `closingretro` score '
        'parsing and 0-100 normalization.',
        '`lib/__tests__/demo-scope.test.ts` &mdash; asserts real client emails never '
        'activate demo mode.',
        '`lib/__tests__/module-gating.test.ts` &mdash; capability gating, the anti-'
        'duplication rule.',
        '`lib/__tests__/trend-transform.test.ts` &mdash; time-series bucketing.',
        '`components/__tests__/` &mdash; `DashboardContent`, `Sidebar` rendering.',
    ])

    f.append(H2('12.2  Python AI service'))
    f += TABLE(
        ['Concern', 'Choice', 'Version'],
        [['API', 'FastAPI + uvicorn', '0.115.6 / 0.34'],
         ['Models', 'pydantic, pydantic-settings', '2.10.4 / 2.7.1'],
         ['HTTP client', 'httpx', '0.28.1'],
         ['Orchestration', 'langgraph', '0.2.60'],
         ['LLM', 'anthropic (**optional** &mdash; heuristic fallback)', '0.42.0'],
         ['Postgres', 'asyncpg (**optional** &mdash; in-memory fallback)', '0.30']],
        [22, 62, 16])
    f.append(CAP(
        'Entrypoints: `app/main.py` (the mounted service), `api/index.py`, and '
        '`standalone/index.py` &mdash; a reduced single-file variant (`/health`, '
        '`POST /ai/generate-sync`, `GET /`) for serverless targets. The standalone '
        'variant is not mounted by `app/main.py`.'))
    f.append(PageBreak())
    return f


def s13_deploy():
    f = H1('13.  Deployment and configuration')

    f.append(H2('13.1  Environment variables'))
    f.append(P(
        'Grouped by subsystem. Never read a server-only variable from a client '
        'component &mdash; only `NEXT_PUBLIC_*` is available in the browser.'))
    f += TABLE(
        ['Variable', 'Purpose'],
        [['`AUTH_DATABASE_URL`', 'Postgres auth DB (identity, tenant config, AI tables)'],
         ['`JWT_SECRET`, `REFRESH_SECRET`', 'Access (8 h) and refresh (7 d) token signing'],
         ['`SETUP_SECRET`', 'Gates `GET /api/auth/setup`; 503 when unset'],
         ['`BRIDGE_URL`, `BRIDGE_SECRET`', 'PHP SQL bridge endpoint and `X-Bridge-Key`'],
         ['`DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`', 'Direct MySQL, local development only'],
         ['`PHARMA_BRIDGE_BASE_URL`', 'Enables the Sanfer / Apotex static tenant entries'],
         ['`PHARMA_TENANT_DOMAINS`', '`"tenant:domain,..."` static domain map (DB rows win)'],
         ['`BANCO_EMAIL_DOMAINS`', 'Domains routed to the Banco pipeline'],
         ['`ROLPLAY_APP_SQL_URL`, `ROLPLAY_APP_LOGINS`', 'rolplay.app SQL endpoint and login map'],
         ['`SECOND_BRAIN_API_URL`, `SECOND_BRAIN_API_TOKEN`', 'Second Brain REST API'],
         ['`SB_OWNER_OVERRIDES`', 'Owner-email overrides where the `admin@domain` convention fails'],
         ['`LMS_API_URL`', 'LearnWorlds school base URL, e.g. `https://&lt;school&gt;.learnworlds.com`'],
         ['`LMS_CLIENT_ID`, `LMS_CLIENT_SECRET`', 'OAuth2 client credentials; `Lw-Client` header'],
         ['`LMS_ACCESS_TOKEN`', 'Optional static token; skips the credentials exchange'],
         ['`LMS_&lt;TENANT&gt;_*`', 'Per-tenant override of any of the four above (e.g. `LMS_APOTEX_API_URL`)'],
         ['`AI_SERVICE_URL`', 'FastAPI service, default `http://127.0.0.1:8088`'],
         ['`NEXT_PUBLIC_DEMO_MODE`, `DEMO_DOMAINS`', 'Demo mode activation and extra demo domains'],
         ['`DYNAMIC_TENANTS_TTL_MS`', 'Dynamic tenant cache TTL, default 30 000 ms']],
        [34, 66], font_size=7.6)
    f += NOTE(
        'Credentials belong in `.env.local` (git-ignored) or the platform\'s secret '
        'store &mdash; never in `.env.local.example`, which is committed and must '
        'contain placeholders only.',
        accent=RED, label='Secrets.')

    f.append(H2('13.2  Targets and bootstrap'))
    f += KV([
        ('Next.js app', 'Vercel (`vercel.json`), Render (`render.yml`), or Docker '
                        '(`docker-compose.yml`).'),
        ('AI service', 'Its own `Dockerfile`, `render.yaml`, `vercel.json`. Must not be '
                       'publicly exposed &mdash; it has no auth; reach it through '
                       '`/api/ai/*`.'),
        ('PHP bridge', '`rolplay-bridge.php` deployed alongside the MySQL upstreams. '
                       'See `MODIFY_PHP_BRIDGE.md`.'),
        ('Schema bootstrap', '`GET /api/auth/setup?secret=...` creates and upgrades the '
                             'auth schema idempotently (`CREATE TABLE IF NOT EXISTS`).'),
        ('Migrations', 'Numbered files in `migrations/` run against the auth Postgres '
                       '(001 is MySQL and reflects an earlier design). 004 and 005 must '
                       'be applied for branding keys and rolplay.app routing.'),
    ], widths=(21, 79))

    f.append(H2('13.3  Onboarding a client'))
    f.append(P('Three supported routes, in increasing order of automation:'))
    f += NUMBERED([
        '**Admin wizard** (`/admin/tenants`) &mdash; register the tenant key, bridge '
        'kind, URL, `ucids`, capability flags and login domains. Takes effect '
        'immediately: the write invalidates the dynamic tenant cache.',
        '**AI builder** (`/dashboard-builder`) &mdash; guided configuration, discovery, '
        'validation, publish. Produces a rendered dashboard at `/d/[slug]`.',
        '**Static config** &mdash; add an entry to `TENANT_CONFIG` plus a '
        '`PHARMA_TENANT_DOMAINS` mapping. Requires a deploy; used for the hand-verified '
        'built-ins.',
    ])
    f.append(CAP('Runbooks: `docs/ONBOARDING_A_CLIENT.md`, `docs/NEW_USER_ONBOARDING.md`.'))
    f.append(PageBreak())
    return f


def s14_issues():
    f = H1('14.  Known issues and open items')

    f.append(P(
        'Everything below was verified against the code at the commit on the cover '
        'page. It is recorded here rather than omitted, because each item is a real '
        'trap for the next person.'))

    f.append(H2('14.1  Verified discrepancies'))
    f += TABLE(
        ['#', 'Issue', 'Detail and impact'],
        [['1', 'Two `users` shapes',
          'Migration 002 declares `company_id VARCHAR(100)`; the live bootstrap in '
          '`app/api/auth/setup/route.ts` declares `customer_id INTEGER NOT NULL '
          'DEFAULT 0`. **All TypeScript uses `customer_id`** &mdash; the setup route is '
          'authoritative and migration 002 reflects the older design. Trust the setup '
          'route when reconciling a database by hand.'],
         ['2', 'Two `saved_reports` shapes',
          '`coach_app` has `score`, `passed_flag`, `coach_user_id`; `rolplay_pro` has '
          '`banco_user_id` and **no score columns** (scores are parsed from '
          '`closingretro` HTML). Same table name, different meaning &mdash; check which '
          'database a query targets before reusing SQL.'],
         ['3', 'Undocumented tables',
          '`branding_settings` and `tenant_integrations` have DDL only inside the setup '
          'route, with no numbered migration. A database provisioned purely from '
          '`migrations/` will lack them.'],
         ['4', 'Legacy branding key',
          '`branding_settings.customer_id` retains its `UNIQUE` constraint even though '
          '`tenant_key` (migration 004) is now the real key. Two tenants that both '
          'resolve to `customer_id = 0` can collide on insert.'],
         ['5', 'Unauthenticated routes',
          '`/api/ai/[...path]` and `/api/debug/second-brain-check` take parameters and '
          'reach upstreams without a session. `/api/debug/banco-test` requires a session '
          'but is not admin-gated. Gate all three before a public deployment.'],
         ['6', 'Stale AI prompt',
          '`lib/ai.ts` (a separate Gemini 2.5 Flash path, distinct from `ai-service/`) '
          'still carries a leftover "TCF French learning assistant" system prompt '
          'instead of a dashboard prompt.'],
         ['7', 'Duplicate trees',
          '`dashboard/` and `.claude/worktrees/*` duplicate the main tree and are '
          'excluded from vitest. Edits there do not ship.']],
        [4, 22, 74], font_size=7.5)

    f.append(H2('14.2  Open items'))
    f += TABLE(
        ['Item', 'Status', 'What is needed'],
        [['LMS capability flags in the DB',
          'In progress',
          '`hasLms` and `hasSimulator` exist on `TenantConfig` but have no `has_lms` / '
          '`has_simulator` columns yet. Needs migration 006, the `db-tenants.ts` '
          'mapping, the admin API fields, and the builder selector, so the flags are '
          'settable from the UI rather than only in code.'],
         ['LearnWorlds end-to-end verification',
          'Blocked',
          'The connector is written against the documented LearnWorlds v2 API but has '
          'not been run against a live school. The response mapping (field names, '
          'progress scale, pagination) must be confirmed with real credentials in '
          '`.env.local` before the numbers can be trusted.'],
         ['Value KPIs (approval rate, learning curve)',
          'Blocked',
          'Needs a definition for "approved divided by active training period": '
          'per-week velocity, per-day, or percentage of active users.'],
         ['Tenant isolation test with two rival logins',
          'Pending',
          'Procedure is written in `docs/tenant-isolation.md`; needs a human to run it '
          'with two real client accounts.'],
         ['Metric normalization ratification',
          'Pending',
          'The written recommendation is in `docs/tenant-isolation.md`; needs sign-off '
          'so score and pass-rate definitions are identical across clients.'],
         ['Clients not yet onboarded',
          'Blocked',
          '`lacosteAsistentes` has no confirmed email domain. Gentera and Salinas '
          'identify users by employee ID, not email, so domain-based resolution cannot '
          'work as-is. BancoPPEL and Lily run separate Flask containers, not yet wired.']],
        [24, 12, 64], font_size=7.5)

    f += NOTE(
        'The LMS pipeline was added specifically to stop Simulator data rendering under '
        'an LMS label. Until item 2 above is verified against a live LearnWorlds school, '
        '`/api/dashboard/lms` returns `configured: false` for tenants without '
        'credentials, and the page shows an empty state &mdash; which is the correct '
        'behaviour, not a bug.',
        label='Current LMS behaviour.')

    f.append(H2('14.3  Where to look first'))
    f += KV([
        ('Wrong numbers for one client', 'Read `meta.source` on the API response, then '
                                         'that connector. Check the capability flags.'),
        ('A module is missing from the nav', '`GET /api/dashboard/modules`. Remember it '
                                             'fails open to the full set on error.'),
        ('A client sees no data at all', 'Check `customer_id` in the JWT (`0` means '
                                         'unlinked) and the domain map priority: DB, '
                                         'then env, then built-in aliases.'),
        ('Cross-tenant suspicion', '`lib/org-type.ts` and `resolvePharmaTenant()`. Run '
                                   '`lib/__tests__/org-type.test.ts`.'),
        ('Demo data in production', '`useDemoData()` and `DEMO_DOMAINS`. Run '
                                    '`demo-scope.test.ts`.'),
    ], widths=(30, 70))
    return f
