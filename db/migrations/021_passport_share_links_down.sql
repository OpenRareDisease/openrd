-- Drops the table and both its indexes with it.
--
-- Rolling this back revokes every live share by making the resolve
-- lookup fail — which is the safe direction, and worth stating because
-- the reverse would not be: a rollback that left links resolvable
-- against a schema the service no longer understands is how a share
-- outlives the feature that was supposed to bound it.

DROP TABLE IF EXISTS passport_share_links;
