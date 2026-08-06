-- A short code the patient reads out across a consulting-room desk, so
-- the record can land on the doctor's own screen.
--
-- WHY THIS EXISTS
--
-- 021 solved the wrong half of the problem well. A URL forwarded in
-- WeChat is exactly right when the patient and the clinician are not in
-- the same room — and useless when they are, because there is no chat
-- window between them. What actually happens in the appointment is that
-- the patient holds their phone out and the doctor squints at it, which
-- is the failure 021 was built to end, reproduced one step later.
--
-- FSHD makes that squinting worse than it sounds. Sustained grip and a
-- raised arm are the first two things this disease takes; holding a
-- phone up at another person's reading distance for a minute is a real
-- ask, and ~20% of patients over 50 are doing it from a wheelchair, at
-- the wrong height. So: the patient reads out eight characters, the
-- doctor types them on their own machine, and the phone goes back down.
--
-- WHY IT IS NOT JUST A SHORT SHARE TOKEN
--
-- 021's token is 32 bytes of CSPRNG. This is eight characters a human
-- has to say out loud, which is about 40 bits, in a room that usually
-- contains other people. Nothing about 021's security argument survives
-- that shrink, so this table does not reuse 021's expiry column and
-- does not reuse its reasoning. It adds three bounds of its own:
--
--  * `expires_at` — its OWN, and minutes rather than days. A 30-day
--    pickup code is a password. The service sets 15 minutes, which is
--    longer than the walk from the waiting room and shorter than the
--    next patient's appointment.
--  * `redeemed_at` — single use. The code buys one page load. If the
--    doctor wants it twice the patient is standing right there and can
--    mint another in ten seconds; that is a cheaper trade than leaving
--    a spoken credential live for a second stranger.
--  * `attempts` / `burned_at` — three wrong tries and the code is dead.
--    This is the one that has to be a COLUMN and not a rate-limit
--    bucket: the public open limiter in passport-share.routes.ts keys
--    on IP, and a hospital is one IP. Counting guesses per IP there
--    would either lock out an entire outpatient department or, tuned
--    loose enough not to, stop bounding anything. Counted on the row,
--    the bound is exact and it follows the code rather than the network.
--
-- The second factor is the patient's date of birth, and it is NOT
-- stored here. Redemption joins through to patient_profiles and
-- compares against the live value, so this table never becomes a second
-- copy of a birthdate, and a patient who corrects theirs does not leave
-- stale codes behind that still match the old one. It is also not a
-- secret and is not treated as one: a birthdate is a BINDING. It stops
-- a code overheard in a waiting room, or mistyped into the next room's
-- terminal, from opening a record belonging to someone else.
--
-- WHY IT HANGS OFF passport_share_links INSTEAD OF STANDING ALONE
--
-- Because a live pickup code is a door, and 「谁现在能看我的记录」 has
-- to list every door or it is not the answer to its own question. The
-- parent row gives this one revocation, the live-share cap, the open
-- counter, and the ON DELETE CASCADE from app_users — all of which we
-- would otherwise have had to build a second, subtly different time.
--
-- The parent's `token_hash` is still populated (the column is NOT NULL
-- and unique), from bytes the service generates, hashes, and drops on
-- the floor inside the same function. No route returns it, so no holder
-- exists; the row is reachable only through the code below.

CREATE TABLE IF NOT EXISTS passport_pickup_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id     UUID NOT NULL REFERENCES passport_share_links (id) ON DELETE CASCADE,
  -- sha256 of the normalized code, never the code.
  --
  -- Read the 021 comment on token_hash and then do NOT copy its
  -- conclusion: it justifies sha256 by saying a 32-byte CSPRNG token
  -- has nothing to brute-force, and that is simply not true of eight
  -- Crockford characters. A GPU walks 32^8 in seconds.
  --
  -- The digest is here for a narrower and honest reason. The leak that
  -- actually happens is a backup, and every code in a backup is already
  -- expired, burned or redeemed — cracking one yields a string that no
  -- longer opens anything. Against someone reading the LIVE table the
  -- digest buys little, but that attacker can also read patient_profiles
  -- in the same connection and does not need a pickup code to do it.
  code_hash    TEXT NOT NULL,
  -- Minutes, not days, and independent of the parent's expiry so that
  -- widening a share link can never silently widen a spoken code.
  expires_at   TIMESTAMPTZ NOT NULL,
  -- Wrong-birthdate submissions against a code that DID exist. A wrong
  -- code increments nothing, because there is no row to increment — the
  -- bound there is the size of the code space, not this counter.
  attempts     SMALLINT NOT NULL DEFAULT 0,
  redeemed_at  TIMESTAMPTZ,
  burned_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique, and load-bearing rather than tidy: redemption is one
-- statement that finds the row by hash and updates it. Two rows sharing
-- a hash would make that statement update both, redeeming a code the
-- caller never typed. The service retries on the unique violation
-- instead of trusting 40 bits never to collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_passport_pickup_code
  ON passport_pickup_codes (code_hash);

-- One pickup per share row. Also unique for a structural reason: the
-- 「谁现在能看我的记录」 list LEFT JOINs this table onto the share
-- links, and a second row here would duplicate a share in the list the
-- patient uses to decide what to revoke.
CREATE UNIQUE INDEX IF NOT EXISTS idx_passport_pickup_share
  ON passport_pickup_codes (share_id);
