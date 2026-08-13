-- Drops the table and both its indexes with it.
--
-- Safe direction, for the same reason 021's rollback is: without this
-- table every pickup code stops resolving, which is the failure mode we
-- would choose. The dangerous direction would be a rollback that left
-- codes redeemable against a service that no longer counts attempts.
--
-- The parent passport_share_links rows minted for pickups are left
-- behind deliberately. They are ordinary 021 rows with a 15-minute
-- expiry and a token nobody was ever given, so they open nothing, and
-- deleting them here would erase the record that the patient handed
-- their file to someone — which is the one thing the revoke list is
-- supposed to be able to show them.

DROP TABLE IF EXISTS passport_pickup_codes;
