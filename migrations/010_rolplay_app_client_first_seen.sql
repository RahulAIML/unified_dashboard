-- "Nuevo" badge tracking for rolplay_app_sql clients (Siigo, M8, Takeda, …).
--
-- r_client (rolplay.app's own table) has no creation-date column -- it's a
-- third-party production table we don't own and can't ALTER. So "new" for
-- this source is derived from OUR OWN record of the first time we ever
-- observed each client_id, not from their data. A client already carrying
-- real activity the first time it's observed is backdated instead of
-- stamped NOW -- see lib/rolplay-app-first-seen.ts for why (otherwise every
-- pre-existing client would be falsely flagged "Nuevo" for two weeks the
-- moment this feature ships). That file also creates this table lazily on
-- first use (CREATE TABLE IF NOT EXISTS) so the feature works even in an
-- environment where this migration file was never run by hand.

CREATE TABLE IF NOT EXISTS rolplay_app_client_first_seen (
  client_id  INTEGER PRIMARY KEY,
  first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
