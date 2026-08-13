-- 009_pass_threshold.sql
--
-- Configurable per-tenant pass-rate threshold (ticket: "Configurable
-- pass-rate threshold with visible legend").
--
-- WHY THIS EXISTS. bridge-pharma-analytics.ts hardcoded a single PASS_THRESHOLD
-- (70) for every tenant, but real contracts differ: some clients pass at 70,
-- some at 80, and some (e.g. Sanfer's certification module, which already
-- certifies by completion via a wholly separate data source) have no
-- score-based passing criteria at all. A single constant cannot represent
-- that, and there was no way to say "this client has no such criteria"
-- without the pass-rate section rendering a number the client never agreed to.
--
-- Two columns, same tri-state reasoning as migration 007's has_lms/
-- has_simulator:
--   pass_threshold          INTEGER NULL             -- NULL = not configured
--   has_no_passing_criteria BOOLEAN NOT NULL DEFAULT FALSE
--
-- pass_threshold is NULLABLE ON PURPOSE: NULL means "not explicitly
-- configured", which lib/kpi-builder.ts's resolvePassThreshold() resolves to
-- LEGACY_PASS_THRESHOLD (70) -- i.e. exactly today's behaviour, so no
-- already-live tenant's numbers move just because this migration ran. A new
-- tenant configured through the admin UI defaults to 80 (the ticket's own
-- "80 as the default"), but that default lives in application code
-- (app/api/admin/tenants), not as a column DEFAULT here -- a column DEFAULT
-- would apply to every EXISTING row on migration, silently changing live
-- numbers for tenants that never asked for 80.
--
-- has_no_passing_criteria takes priority over pass_threshold when both are
-- set (see resolvePassThreshold) -- it is a deliberate "this concept doesn't
-- apply here" override, not merely an absence of configuration, so unlike
-- pass_threshold it is safe to default FALSE (an override must be turned on
-- explicitly; it can never apply silently).
--
-- ADDITIVE: adds nullable/defaulted columns only. Existing rows get NULL /
-- FALSE, which resolves to exactly today's behaviour.

ALTER TABLE pharma_tenants
  ADD COLUMN IF NOT EXISTS pass_threshold INTEGER NULL;

ALTER TABLE pharma_tenants
  ADD COLUMN IF NOT EXISTS has_no_passing_criteria BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN pharma_tenants.pass_threshold IS
  'Score-based pass threshold for this tenant (e.g. 70 or 80). NULL = not '
  'configured -- resolvePassThreshold() falls back to LEGACY_PASS_THRESHOLD '
  '(70) so an already-live tenant''s numbers never move on their own. '
  'Ignored when has_no_passing_criteria is TRUE.';

COMMENT ON COLUMN pharma_tenants.has_no_passing_criteria IS
  'TRUE = this tenant has no score-based passing criteria at all (e.g. '
  'certification by completion). The pass-rate section is hidden entirely '
  'for these rather than showing a number computed against a threshold the '
  'client never agreed to. Takes priority over pass_threshold.';

-- ROLLBACK
--   ALTER TABLE pharma_tenants DROP COLUMN IF EXISTS pass_threshold;
--   ALTER TABLE pharma_tenants DROP COLUMN IF EXISTS has_no_passing_criteria;
-- Safe: the resolver treats a missing column the same as NULL/FALSE (see
-- lib/db-tenants.ts, which selects defensively), so dropping these returns
-- the system to pre-migration behaviour (LEGACY_PASS_THRESHOLD for everyone).
