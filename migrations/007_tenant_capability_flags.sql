-- 007_tenant_capability_flags.sql
--
-- Adds the two capability flags that pharma_tenants was missing, closing audit
-- finding A2.
--
-- WHY THIS EXISTS. TENANT_CONFIG carries hasLms and hasSimulator, but
-- pharma_tenants had no column for either. loadDynamicTenants() REBUILDS the
-- config object from the DB row, so for any tenant defined solely by a DB row —
-- i.e. every tenant the onboarding wizard creates — those flags could not be
-- expressed at all. hasLms read false no matter what, which is why Apotex's LMS
-- tab stayed hidden even with correct credentials.
--
-- NULLABLE ON PURPOSE, and this is the important detail. The other capability
-- columns are `BOOLEAN NOT NULL DEFAULT FALSE` because their flags mean "this
-- tenant HAS this data" and false is a safe default. hasSimulator is different:
-- its gate is `hasSimulator !== false`, so undefined means ON. A NOT NULL
-- DEFAULT FALSE column would silently switch the Simulator tab OFF for every
-- existing DB-defined tenant the moment this migration ran — a regression
-- disguised as a schema addition.
--
-- So three states are represented deliberately:
--   NULL  → "not specified", inherit the existing default (simulator on, lms off)
--   TRUE  → explicitly enabled
--   FALSE → explicitly disabled (an LMS-only client with no simulator)
--
-- ADDITIVE: adds nullable columns only. Existing rows get NULL, which resolves
-- to exactly today's behaviour, so this migration changes nothing until an
-- operator sets a value. Rollback at the bottom.

ALTER TABLE pharma_tenants
  ADD COLUMN IF NOT EXISTS has_lms BOOLEAN NULL;

ALTER TABLE pharma_tenants
  ADD COLUMN IF NOT EXISTS has_simulator BOOLEAN NULL;

COMMENT ON COLUMN pharma_tenants.has_lms IS
  'Tenant has a real LMS (LearnWorlds). NULL = unspecified (treated as no LMS). '
  'Note: the LMS TAB is gated on resolvable credentials, not on this flag — this '
  'records intent and drives onboarding UI, it is not the capability gate.';

COMMENT ON COLUMN pharma_tenants.has_simulator IS
  'Tenant has practice-simulation sessions. NULL = unspecified, which means ON '
  '(the gate tests `!== false`). Set FALSE only for an LMS-only client, so the '
  'Simulator tab is not shown with no data behind it. Do NOT make this NOT NULL '
  'DEFAULT FALSE — that would disable the tab for every existing tenant.';

-- ROLLBACK
--   ALTER TABLE pharma_tenants DROP COLUMN IF EXISTS has_lms;
--   ALTER TABLE pharma_tenants DROP COLUMN IF EXISTS has_simulator;
-- Safe: the resolver treats a missing column the same as NULL (see
-- lib/db-tenants.ts, which selects defensively), so dropping these returns the
-- system to pre-migration behaviour. Any explicitly-disabled simulator would
-- revert to enabled, so re-check LMS-only tenants if you roll back.
