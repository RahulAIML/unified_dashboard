"""Data pipelines (connectors) and data schemas."""
from reportlab.lib import colors
from reportlab.platypus import PageBreak

from pdfkit import (
    BULLETS, CAP, CODE, H1, H2, H3, KV, NOTE, NUMBERED, P, TABLE,
)

AMBER = colors.HexColor('#B45309')


def s5_pipelines():
    f = H1('5.  Data pipelines (connectors)')

    f.append(P(
        'Every connector lives in `lib/`, is server-only, and normalizes its upstream '
        'into the shared types in section 8. Each API route resolves the org type, '
        'then dispatches to exactly one connector &mdash; never two, so a payload can '
        'always be attributed to a single pipeline.'))

    f += TABLE(
        ['Connector', 'File', 'Upstream and protocol'],
        [['PHP SQL bridge', '`bridge-client.ts`, `data-provider.ts`',
          'MySQL `coach_app` / `rolplay_pro_analytics`. `POST BRIDGE_URL` with '
          '`{sql, params}`, header `X-Bridge-Key: BRIDGE_SECRET`, response '
          '`{success, data, error}`. Scoped by `customer_id` on every call.'],
         ['Generic MySQL', '`db.ts`',
          'Same MySQL. Dual-mode: uses the bridge when `BRIDGE_URL` is set, else a '
          'direct `mysql2` pool. Direct mode is for local development.'],
         ['Banco', '`bridge-banco.ts`, `bridge-banco-analytics.ts`',
          'Scoped by **email domain**, never `customer_id`. Score is parsed out of '
          '`closingretro` HTML, normalized to 0-100, pass at &gt;= 60.'],
         ['Pharma bridges', '`bridge-pharma-analytics.ts` (~1345 lines)',
          'Per-tenant containers on `serv.aux-rolplay.com`. `POST {action, ...params}`, '
          'optional `X-Tenant` header, 30 s timeout. Three sub-kinds &mdash; below.'],
         ['rolplay.app', '`bridge-rolplay-app.ts`',
          'Raw read-only SELECT endpoint (`ROLPLAY_APP_SQL_URL`) over `r_*` tables. '
          '`POST {sql}`, response `{result, data}`.'],
         ['Second Brain', '`second-brain-api.ts`, `banco-second-brain.ts`',
          'Dedicated REST API plus token. API-only by rule &mdash; never read from a '
          'SQL bridge, because the SQL schema has no knowledge-base concept.'],
         ['LMS', '`lms-learnworlds.ts`',
          'LearnWorlds API. OAuth2 client-credentials (or a static token), '
          '`Lw-Client` header on every call. Per-tenant credentials via `LMS_<TENANT>_*`.'],
         ['AI builder', '`app/api/ai/[...path]` -> `ai-service/`',
          'Reverse proxy to the FastAPI service at `AI_SERVICE_URL`, 120 s timeout.']],
        [15, 26, 59])

    f.append(H2('5.1  The three pharma bridge kinds'))
    f.append(P(
        'All three are "pharma" to the org classifier, but their wire protocols and '
        'schemas differ enough to need separate adapters. `TenantConfig.kind` selects '
        'the adapter.'))
    f += TABLE(
        ['`kind`', 'Clients', 'Shape'],
        [['`sale_exercises`', 'Sanfer, Weser, Adium',
          'Action-dispatch bridge returning raw per-session rows; the adapter '
          'aggregates in-process. Requires a fixed `ucids` allowlist matching the '
          'client\'s own dashboard scope (Sanfer pins an exact 44-ID list).'],
         ['`kpi`', 'Apotex',
          'Same action bridge, different schema. `coachActivityIds` (Apotex: 8, 9, 10) '
          'identifies the real Coach Maestro module; everything else is Simulator.'],
         ['`exceltis_rest`', 'Heineken, M8, Lacoste, Lacoste Asistentes, Chiesi, Labomed',
          'Pre-existing Flask REST endpoints (`GET /api/rol_play_sim_extractor`, '
          '`/api/dim_actividades`) &mdash; not an action bridge at all.']],
        [16, 24, 60])

    f.append(H3('Score normalization is per-client, on purpose'))
    f.append(P(
        '`normalizeSimScore()` trusts `Calificacion` when it is &lt;= 100 and otherwise '
        'falls back to `Puntos_Totales`. Clients genuinely scale scores differently; a '
        'single global formula produced visibly wrong numbers for at least one client, '
        'which is why the per-client branch exists rather than a shared constant.'))

    f.append(H2('5.2  Capability gating: the anti-duplication rule'))
    f.append(P(
        'Capability flags on `TenantConfig` decide which modules return data. The rule '
        'they enforce, stated in the code comments of '
        '`isUnsupportedModule()`, is that **a module with no distinct upstream returns '
        'empty rather than falling through to the tenant\'s default view**. Without '
        'this, a tenant lacking Coach Maestro would see its Simulator numbers a second '
        'time under a "Coach Maestro" heading &mdash; the "same data everywhere" '
        'failure the connector exists to prevent.'))
    f += TABLE(
        ['Flag', 'Gates', 'Set true when'],
        [['`hasCertification`', 'Certifier Coach',
          'A genuinely separate certification source is confirmed (Sanfer: official platform DB)'],
         ['`hasObjections`', 'Conversational / Objections',
          '`objections.demorp6` is confirmed present and working'],
         ['`hasBusinessLines`', 'Business Lines', 'A members-tag catalog (`tag1`) is confirmed'],
         ['`hasOrganization`', 'Organization', '`org.members` / `org.admins` are confirmed'],
         ['`hasTopStats`', 'All-time leaderboard', '`sim.topstats` is confirmed'],
         ['`hasLms`', 'LMS', 'The tenant has a real LearnWorlds school with credentials configured'],
         ['`hasSimulator`', 'Simulator', 'The tenant has practice-simulation sessions (default for bridge tenants)'],
         ['`coachActivityIds`', 'Master Coach', 'A verified activity-ID split exists (`kpi` kind)']],
        [20, 24, 56])
    f += NOTE(
        '`coach` is treated differently from `lms` and `second-brain`. For '
        '`sale_exercises` and `exceltis_rest` tenants there is no separate Coach data '
        'source, but coaching is a legitimate **different lens** on the same practice '
        'sessions &mdash; verified against Sanfer\'s own `CoachingPage.tsx`, which '
        'derives its insights from the same rows. So `coach` falls through to the '
        'tenant\'s data, whereas `lms` and `second-brain` are blocked outright '
        'because no course or knowledge-base data exists in a bridge at all.',
        label='Subtlety.')

    f.append(H2('5.3  Request coalescing'))
    f.append(P(
        'One dashboard page load fires roughly five concurrent requests that each need '
        'the tenant\'s full session history. `_sessionsCache` in '
        '`bridge-pharma-analytics.ts` (30 s TTL) de-duplicates them into a single '
        'upstream fetch, which is the difference between a fast page and five '
        'redundant multi-second bridge calls.'))
    f.append(PageBreak())
    return f


def s6_schemas():
    f = H1('6.  Data schemas')

    f.append(P(
        'Data lives in several databases with different owners and different degrees of '
        'writability. Only the Postgres auth DB is owned by this project; the MySQL '
        'analytics databases and the platform DB are read-only from here.'))
    f += TABLE(
        ['Database', 'Engine', 'Access', 'Contents', 'Writable?'],
        [['Auth DB (`AUTH_DATABASE_URL`)', 'PostgreSQL', '`lib/db-auth.ts`',
          'Identity, sessions, branding, tenant config, AI service tables', 'Yes'],
         ['`coach_app`', 'MySQL 8', 'PHP bridge',
          'Coach / simulator / certification analytics', 'Read-only'],
         ['`rolplay_pro`', 'MySQL', 'PHP bridge', 'Banco pipeline', 'Read-only'],
         ['rolplay.app platform', 'MySQL', 'Raw SQL endpoint', '`r_*` tables', 'Read-only'],
         ['Pharma bridges', 'n/a (HTTP)', 'Action / REST', 'No local DDL', 'Read-only'],
         ['LearnWorlds', 'n/a (HTTP)', 'REST API', 'Courses, enrollments', 'Read-only']],
        [26, 14, 17, 32, 11])

    f.append(H2('6.1  Auth DB: identity'))
    f += CODE("""
users
  id              SERIAL PRIMARY KEY
  email           VARCHAR(255) UNIQUE NOT NULL
  password_hash   VARCHAR(255) NOT NULL          -- bcrypt
  full_name       VARCHAR(255) NOT NULL DEFAULT ''
  company_domain  VARCHAR(255) NOT NULL DEFAULT ''
  customer_id     INTEGER      NOT NULL DEFAULT 0   -- live shape; see section 14
  role            VARCHAR(20)  NOT NULL DEFAULT 'user'
                  CHECK (role IN ('user','admin'))
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE
  last_login      TIMESTAMPTZ
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  INDEX idx_users_email (email), idx_users_customer_id (customer_id)

user_sessions
  id          SERIAL PRIMARY KEY
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
  token_jti   VARCHAR(255) UNIQUE NOT NULL   -- JWT ID of the refresh token
  expires_at  TIMESTAMPTZ NOT NULL
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  INDEX idx_sessions_user_id, idx_sessions_expires, idx_sessions_jti
""", title='Created by migration 002 and app/api/auth/setup/route.ts')

    f.append(H2('6.2  Auth DB: tenant configuration'))
    f.append(P(
        'These two tables are what make onboarding a client a data operation rather '
        'than a deploy. `pharma_tenants` rows are merged over the static '
        '`TENANT_CONFIG` at runtime (section 3.2).'))
    f += CODE("""
pharma_tenants                                    -- migration 003
  id                  SERIAL PRIMARY KEY
  tenant_key          VARCHAR(100) UNIQUE NOT NULL
  display_name        VARCHAR(255) NOT NULL
  kind                VARCHAR(20)  NOT NULL
                      CHECK (kind IN ('sale_exercises','kpi','exceltis_rest'))
  url                 TEXT         NOT NULL
  x_tenant            VARCHAR(100)
  ucids               JSONB        NOT NULL DEFAULT '[]'
  has_certification   BOOLEAN      NOT NULL DEFAULT FALSE
  has_objections      BOOLEAN      NOT NULL DEFAULT FALSE
  has_business_lines  BOOLEAN      NOT NULL DEFAULT FALSE
  has_organization    BOOLEAN      NOT NULL DEFAULT FALSE
  has_top_stats       BOOLEAN      NOT NULL DEFAULT FALSE
  coach_activity_ids  JSONB                        -- 'kpi' kind only
  auth_header_name    VARCHAR(100)
  auth_header_value   TEXT
  is_active           BOOLEAN      NOT NULL DEFAULT TRUE
  created_by          INTEGER REFERENCES users(id)
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  INDEX idx_pharma_tenants_key (tenant_key)

pharma_tenant_domains                             -- migration 003
  id          SERIAL PRIMARY KEY
  domain      VARCHAR(255) UNIQUE NOT NULL
  tenant_key  VARCHAR(100) NOT NULL
              REFERENCES pharma_tenants(tenant_key) ON DELETE CASCADE
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  INDEX idx_pharma_tenant_domains_domain (domain)
""")
    f.append(CAP(
        'Note: `has_lms` and `has_simulator` are new capability flags added with the '
        'LMS pipeline and are not yet in a numbered migration &mdash; see section 14.'))

    f.append(H2('6.3  Auth DB: branding and integrations'))
    f += CODE("""
branding_settings              -- setup route; tenant_key added by migration 004
  id              SERIAL PRIMARY KEY
  customer_id     INTEGER UNIQUE NOT NULL      -- legacy key, still UNIQUE
  tenant_key      TEXT UNIQUE                  -- 'cust:<id>' or 'domain:<domain>'
  logo_url        TEXT
  primary_color   TEXT NOT NULL DEFAULT '#DC2626'
  secondary_color TEXT NOT NULL DEFAULT '#1F2937'
  accent_color    TEXT NOT NULL DEFAULT '#14B8A6'
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()

tenant_integrations            -- setup route only, no numbered migration
  id                       SERIAL PRIMARY KEY
  customer_id              INTEGER UNIQUE NOT NULL
  second_brain_admin_email TEXT
  second_brain_api_token   TEXT
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()

rolplay_app_domains            -- migration 005
  domain       TEXT PRIMARY KEY         -- lowercase email domain
  client_id    INTEGER NOT NULL         -- r_client.ID on rolplay.app
  display_name TEXT
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  INDEX rolplay_app_domains_client_idx (client_id)
""")
    f += NOTE(
        'Migration 005 seeds `siigo.com -> 29`, `takeda.com -> 13`, '
        '`besins-healthcare.com -> 14`, `rowe.com.do -> 25`, `rowe.com -> 25`. '
        '`audioweb.com.mx` is **deliberately excluded**: it is a shared staff domain, '
        'so mapping it would hand one client\'s dashboard to another\'s staff.',
        label='Why one domain is missing.')
    f.append(PageBreak())

    f.append(H2('6.4  Auth DB: AI service tables'))
    f.append(P(
        'The FastAPI service reuses the same Postgres instance and creates its own '
        'tables (`ai-service/app/db.py`). If `AUTH_DATABASE_URL` is unset it runs '
        'fully in-memory, which is why the builder works in local development with no '
        'database at all.'))
    f += CODE("""
agent_memory        slug TEXT PK, company TEXT NOT NULL, payload JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
dashboard_metadata  slug TEXT PK, company TEXT NOT NULL, config JSONB NOT NULL,
                    version INT NOT NULL DEFAULT 1,
                    published BOOLEAN NOT NULL DEFAULT FALSE,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
dashboard_versions  id SERIAL PK, slug TEXT NOT NULL, version INT NOT NULL,
                    config JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL
discovery_logs      id SERIAL PK, slug TEXT NOT NULL, job_id TEXT,
                    payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL
validation_reports  id SERIAL PK, slug TEXT NOT NULL, job_id TEXT,
                    report JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL
""")

    f.append(H2('6.5  MySQL `coach_app`: the analytics core'))
    f.append(P(
        '40 tables; `DATABASE_SCHEMA.md` documents all of them. `admin_user` is the '
        'customer registry that every `customer_id` foreign-keys to, and '
        '`saved_reports` is the central fact table. These are the ones the dashboard '
        'actually queries.'))
    f += CODE("""
admin_user                       -- the tenant/customer registry
  id int unsigned PK AUTO_INCREMENT
  company_name varchar(190), email varchar(190) NOT NULL UNIQUE
  pwd varchar(255) NOT NULL
  access tinyint(1) NOT NULL DEFAULT 0     -- 0 = customer, 1 = superadmin
  enable_api tinyint unsigned NOT NULL DEFAULT 0, api_key varchar(255)
  logo varchar(100) NOT NULL DEFAULT '', homepage_content varchar(2000)
  date datetime NOT NULL

coach_users
  id int unsigned PK, customer_id int unsigned NOT NULL
  user_email varchar(190) NOT NULL, user_pass varchar(190) NOT NULL DEFAULT ''
  user_name varchar(100) NOT NULL DEFAULT ''
  signup tinyint(1) NOT NULL DEFAULT 0     -- 1 = signed up, 0 = pending
  date_added datetime NOT NULL
  FK customer_id -> admin_user(id) ON DELETE CASCADE

saved_reports                    -- the core fact table (coach_app variant)
  id int unsigned PK, uid varchar(191) NOT NULL UNIQUE
  usecase_id int unsigned, coach_user_id int unsigned
  interaction_type tinyint(1) NOT NULL
  elevator_pitch text, closingretro text
  usecase_stage_id int unsigned, eval_session_id int unsigned
  usecase_segment_id int unsigned, segment_num tinyint unsigned
  score int DEFAULT 0, passed_flag smallint DEFAULT 0
  date_created datetime NOT NULL
  FK usecase_id -> coach_usecases(id), coach_user_id -> coach_users(id)

coach_usecases   id, base_usecase_id, customer_id, usecase_name varchar(100),
                 added_instructions text, added_content longtext,
                 direct_interaction_type tinyint  -- 1 Realtime, 2 Video, 3 Audio
usecases         base templates; interaction_type 1..7, lang, ai_model_id
usecase_stages   ID, coach_usecase_id, sequence, name, content, instructions
usecase_segment  id, usecase_id, title
segment_contents id, usecase_segment_id, segment_num, min_score,
                 instruction_prompt, evaluation_prompt, template, questions
coach_teams / coach_team_user / coach_managers / coach_manager_users
coach_evaluation_sessions / _segments / _team
""")
    f.append(CAP(
        'All `coach_app` tables are InnoDB, `utf8mb4`. Migration 001 (MySQL) also '
        'defines `clients`, a MySQL `users`/`user_sessions` pair, and adds '
        '`company_id` to five analytics tables that do not exist in the production '
        'dump &mdash; that migration reflects an earlier design and is not the live '
        'multi-tenancy mechanism.'))

    f.append(H2('6.6  MySQL `rolplay_pro`: the Banco pipeline'))
    f.append(P(
        'A different schema with the same table name. This is why the Banco connector '
        'is separate code rather than a parameter.'))
    f += CODE("""
banco_users
  ID int(11) PK AUTO_INCREMENT, emp_id int(11) NOT NULL
  name varchar(50) NOT NULL, parent_emp_id int(11) DEFAULT 0
  position varchar(25) NOT NULL, hide_welcome tinyint(1) NOT NULL DEFAULT 0
  -- NO email column -> Banco must be scoped by login domain, not customer_id

saved_reports  (rolplay_pro variant -- NOTE: no score / passed_flag columns)
  id int(11) unsigned PK, uid varchar(191) NOT NULL UNIQUE
  usecase_id int(11) unsigned NOT NULL, interaction_type tinyint(1) NOT NULL
  elevator_pitch text, closingretro text        -- score is parsed out of this
  date_created datetime NOT NULL, banco_user_id int(11)

saved_reports_options
  id PK, saved_report_id int unsigned NOT NULL, seq int unsigned NOT NULL
  gen_ques text, ai_ques varchar(255), user_resp text, retro text
  FK saved_report_id -> saved_reports(id) ON DELETE CASCADE
""")
    f += NOTE(
        'The `rolplay_pro` `saved_reports` has **no `score` or `passed_flag`**. Scores '
        'are extracted from the `closingretro` HTML and normalized to 0-100 with a '
        'pass threshold of 60. That parsing is the single most fragile piece of the '
        'Banco pipeline: an upstream change to that HTML changes the numbers. It has '
        'dedicated unit tests (`lib/__tests__/bridge-banco-analytics.test.ts`).',
        accent=AMBER, label='Fragility.')

    f.append(H2('6.7  rolplay.app platform tables'))
    f.append(P(
        'Queried read-only through the raw SQL endpoint; no DDL exists in this '
        'repository. Observed tables: `r_user` (`r_id`, `r_email`, `r_name`), '
        '`r_simulator` (its `category` column drives module discovery &mdash; `COACH`, '
        '`SIM`, `SEGMENT`), `r_user_session`, `r_user_session_details`, and `r_client` '
        '(whose `ID` is the `client_id` in `rolplay_app_domains`).'))
    f.append(PageBreak())
    return f
