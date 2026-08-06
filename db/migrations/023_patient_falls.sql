-- 023_patient_falls.sql
--
-- A structured falls diary.
--
-- WHY THIS EXISTS
--
-- Falls are a mobility outcome in FSHD, not an incident report. The
-- population numbers this product is built around — roughly 65% of
-- adults with FSHD fall at least once a year and about 30% at least
-- monthly — mean that「我最近跌倒是不是更频繁了」is one of the few
-- questions a patient can answer from their own record without a
-- clinic visit, IF the record can be counted.
--
-- Until now it could not be. A fall was one row in
-- patient_followup_events: `event_type = 'fall'`, a timestamp, an
-- optional severity, and everything the patient actually knew about it
-- typed into `description` as free text.
--
-- Free text is where that record dies. The AI retriever that answers
-- the question above
-- (apps/api/src/modules/ai-agents/retrievers/patient-followups.ts)
-- runs an explicit field allowlist and deliberately refuses every
-- patient-typed column — `notes` on tests and scores, `description` on
-- events — because nothing static can prove a box a patient types into
-- is free of names and places. That refusal is correct and is not
-- being relaxed. The consequence was that「在厨房差点摔了，手里端着
-- 汤」 reached the database and reached nothing else: the model saw a
-- count and a severity band, and the six facts that make a fall
-- clinically legible were invisible to the one feature meant to help
-- the patient think about them.
--
-- Structured columns can join that allowlist safely. A closed value
-- set is a value set this file chose, not one the patient typed, so
-- what reaches a prompt is auditable in a diff. That is the whole
-- reason this is a table with columns rather than another JSONB blob
-- hanging off the event row.
--
--
-- WHAT IS RECORDED, AND WHY ONLY THESE SIX THINGS
--
--   occurred_on      when
--   activity         what they were doing
--   location         indoor / outdoor
--   hands_full       were their hands full
--   got_up_unaided   could they get up on their own
--   injured          were they hurt
--
-- Every one of them except the date is NULLABLE, and that is a design
-- constraint rather than laxity. FSHD takes reaching, sustained grip
-- and arm elevation first. A patient recording a fall an hour after it
-- happened, one-handed, possibly sore, must be able to save after a
-- single tap and come back to the rest — or they will not record it at
-- all, and an unrecorded fall is worth less than a fall with five
-- blank fields.
--
-- NULL therefore means「没填」and nothing else. It does NOT mean
-- 「没有」. Every read path in falls.summary.ts states the denominator
-- it counted over for exactly this reason: reporting「2 次受伤」out of
-- five falls when only three rows answered the question would tell the
-- patient three of their falls were injury-free when the record says
-- nothing at all about them.
--
-- `activity` and `location` both carry an explicit 'unknown' member,
-- which is NOT the same as NULL. 「我不记得当时在干什么」is an answer;
-- 「我还没填」is not. This is the distinction migration 017 had to add
-- an entire column (`not_applicable`) to recover after NULL was made
-- to carry two different facts, and it is cheaper to keep than to
-- retro-fit.
--
--
-- WHY DATE AND NOT TIMESTAMPTZ
--
-- Every other followup table here stores TIMESTAMPTZ, and this one
-- deliberately does not. A fall is remembered as a day —「上周三」—
-- and the app is a web export opened most often inside WeChat's
-- browser, where there is no reliable way to ask for a time the
-- patient does not have. Storing a synthesised midnight would be a
-- fabricated precision, and worse than useless: rendered in another
-- timezone a Wednesday-evening fall moves to Tuesday, which silently
-- rewrites which quarter it counted in.
--
-- A DATE cannot do that. The cost is that this column cannot be
-- compared directly against occurred_at on the event table, so both
-- the back-fill below and the read paths convert through
-- Asia/Shanghai — see the note on that conversion at the back-fill.
--
-- There is no CHECK forbidding a future date. CURRENT_DATE is not
-- IMMUTABLE and Postgres refuses it inside a CHECK. The bound lives in
-- fallEntrySchema (falls.schema.ts) instead, with a deliberate one-day
-- forward tolerance so a Beijing-evening fall is not rejected by a
-- server whose clock reads UTC.
--
--
-- WHY THE ROW STILL HAS A FOLLOWUP EVENT BEHIND IT
--
-- `origin_event_id` links a diary entry to the patient_followup_events
-- row for the same fall, and falls.service.ts writes BOTH inside one
-- transaction on every new entry.
--
-- Two reasons, and the first is the important one:
--
--  1. The 病程时间线 renders followup events. Moving falls to a
--     private table and leaving the timeline behind would delete falls
--     from a screen the patient already uses. Nothing this release
--     demotes a surface.
--  2. One number. A fall that exists in both tables must be COUNTED
--     once, and the only way to know two rows are the same fall is to
--     say so. The retriever's event query dedupes on exactly this
--     column; without it, a diary entry and its timeline twin are two
--     falls, and the answer to「我最近跌倒是不是更频繁了」would
--     double as soon as the feature shipped.
--
-- The link also carries retraction in both directions. Soft-deleting
-- the diary entry is handled here; soft-deleting the underlying event
-- through the existing /me/records/followup_event/:id path is handled
-- by every read path requiring the origin event to still be live.
--
--
-- DEPLOY ORDER — READ THIS BEFORE ROLLING BACK
--
-- The API that ships with this migration references patient_falls from
-- the followup retriever's event query, which is the query behind
-- EVERY「我最近怎么样」answer, not only the falls part of it. Applying
-- the code before the migration, or rolling this migration back under
-- a live new API, makes that whole query fail with 42P01 and takes the
-- entire followups retrieval down with it. Migrate first; if you must
-- roll back, roll back the API first. The down migration says the same
-- thing where it can actually be seen.

CREATE TABLE IF NOT EXISTS patient_falls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      UUID NOT NULL REFERENCES patient_profiles (id) ON DELETE CASCADE,

  -- The one required field. See the header for why it is a DATE.
  occurred_on     DATE NOT NULL,

  -- What they were doing. A closed set, mirrored by FALL_ACTIVITIES in
  -- apps/api/src/modules/patient-profile/profile.constants.ts — a
  -- TWO-PLACE edit, the discipline MUSCLE_GROUPS documents. This array
  -- is what rejects a bad write through Zod; this CHECK is the guard
  -- rail for the paths Zod never sees (a direct UPDATE, an import, a
  -- support tool). The values are chosen so that the two mechanisms
  -- that actually drop people with FSHD are separable: catching a foot
  -- (walking, uneven_or_slippery) and a proximal give-way under load
  -- (stairs, standing_up, turning, reaching).
  activity        TEXT
                  CHECK (activity IN (
                    'walking',
                    'stairs',
                    'standing_up',
                    'turning',
                    'reaching',
                    'dressing_or_washing',
                    'uneven_or_slippery',
                    'other',
                    'unknown'
                  )),

  -- Indoor / outdoor. 'unknown' is「记不清」, distinct from NULL
  -- 「没填」.
  location        TEXT
                  CHECK (location IN ('indoor', 'outdoor', 'unknown')),

  -- Were both hands occupied. Carrying is how a hand that cannot grip
  -- and an arm that cannot catch you end up in the same fall.
  hands_full      BOOLEAN,

  -- Could they get back up without help. This is the single answer
  -- that changes what a patient needs — someone who cannot rise alone
  -- has a different risk from someone who fell and stood back up —
  -- and it is not derivable from any other column.
  got_up_unaided  BOOLEAN,

  -- Were they hurt. Kept as a plain yes/no rather than a graded injury
  -- scale: this app has no way to verify an injury grade, and inventing
  -- anchors for one would put a fabricated scale next to two published
  -- ones (migration 022) in the same record.
  injured         BOOLEAN,

  -- The timeline twin. ON DELETE SET NULL rather than CASCADE: if the
  -- event row is ever hard-deleted, the patient's own diary entry is
  -- not collateral. Account deletion (migration 014) drops the profile
  -- and takes this table with it regardless.
  origin_event_id UUID REFERENCES patient_followup_events (id) ON DELETE SET NULL,

  -- Soft delete, for the reasons migration 016 sets out for the other
  -- three followup tables and one more that is specific here: this is a
  -- one-tap form for people with impaired fine motor control, so
  -- mis-taps are expected rather than exceptional, and a tombstone is
  -- recoverable by an operator where a DELETE is not.
  deleted_at      TIMESTAMPTZ,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE patient_falls IS
  'One fall, recorded by the patient. Every column but occurred_on is optional and NULL means "not filled in", never "no". Linked to its patient_followup_events twin by origin_event_id so the same fall is counted once.';

-- 「我这半年摔了几次」 — the only shape of query this table has. Partial
-- so tombstones never enter it, matching the *_live indexes 016 added.
CREATE INDEX IF NOT EXISTS idx_patient_falls_profile_live
  ON patient_falls (profile_id, occurred_on DESC)
  WHERE deleted_at IS NULL;

-- One diary entry per event, enforced rather than assumed. The dedupe
-- in the retriever's event query is a NOT EXISTS against this column;
-- if two rows could mirror the same event, that dedupe would hide one
-- real fall and the count would be wrong in the direction that
-- reassures the patient. Partial because origin_event_id is NULL for
-- every entry created directly in the diary.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_patient_falls_origin_event
  ON patient_falls (origin_event_id)
  WHERE origin_event_id IS NOT NULL;

-- ---------------------------------------------------------------- back-fill
--
-- Every live fall already logged as a followup event becomes a diary
-- entry carrying its date and NOTHING ELSE. The five detail columns
-- stay NULL because they were never asked — reconstructing「大概是在
-- 楼梯上吧」from a timestamp is precisely the fabrication this repo
-- refuses, and NULL already means「没填」, which is the truth.
--
-- This is not cosmetic. Without it a patient who has been logging
-- falls for a year opens the new diary to an empty screen and is
-- implicitly told they have no fall history, which is the same class
-- of lie as「你还没有记录过这项」.
--
-- Retracted events are skipped. A retraction is the patient saying the
-- record was wrong; copying it into a new table would resurrect it in
-- the one place they cannot see to retract it again.
--
-- TIMEZONE: occurred_at is a TIMESTAMPTZ written from the patient's
-- device; the date they meant is the date in their own timezone. This
-- product's users are in mainland China, so the conversion is pinned to
-- Asia/Shanghai — a bare `::date` resolves in the server's zone and
-- would move every fall logged after 20:00 Beijing (12:00 UTC) to the
-- previous day. A patient living abroad may see one of their older
-- falls dated a day off; that is a known and stated limitation, and it
-- is strictly less wrong than shifting every domestic evening fall.
--
-- NOT EXISTS rather than ON CONFLICT: idempotent on re-run, and it
-- reads as what it is.

INSERT INTO patient_falls (profile_id, occurred_on, origin_event_id, created_at)
SELECT fe.profile_id,
       (fe.occurred_at AT TIME ZONE 'Asia/Shanghai')::date,
       fe.id,
       fe.created_at
  FROM patient_followup_events fe
 WHERE fe.event_type = 'fall'
   AND fe.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM patient_falls existing WHERE existing.origin_event_id = fe.id
   );
