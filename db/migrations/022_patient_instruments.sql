-- 022_patient_instruments.sql
--
-- Give this disease a scale.
--
-- WHY THIS EXISTS
--
-- Until now the app asked the patient to self-rate five movements 0-5
-- and averaged them. That average is a number, and it is comparable to
-- nothing. Not to the clinic they saw last year, not to the natural
-- history literature, not to a trial screening list, not to another
-- patient in the same WeChat group. It cannot be handed to a
-- neurologist, because no neurologist has ever seen that scale. Ten
-- years of a diagnostic odyssey produce a folder of reports and no
-- trajectory, and the app was adding a sixth private number to the
-- folder instead of one shared one.
--
-- Published ordinal scales are the opposite trade: coarse, occasionally
-- irritating to answer, and universally legible. Two ship here.
--
--
-- THE DESIGN DECISION THAT HAD TO BE MADE NOW: IMMUTABILITY
--
-- A completed administration is IMMUTABLE. There is no UPDATE path,
-- and the trigger at the bottom of this file refuses one. A correction
-- is a NEW administration carrying `supersedes_id` back to the row it
-- replaces.
--
-- This is not fastidiousness, and it is not reversible later. Every
-- registry and every trial that would ever accept this data — the
-- French FSHD registry this file cites, the FSHD Society registry,
-- anything running under GCP — requires that a scored assessment, once
-- recorded, is auditable: what was answered, when, by whom, under
-- which version of the instrument. A table that permits retroactive
-- edits cannot answer any of those questions about its own history,
-- and no amount of later care fixes rows that were already silently
-- rewritten. The data is disqualified from the moment the first edit
-- lands, and nothing in the database records that it happened.
--
-- So: append-only, superseding chain, and the correction is visible as
-- a correction. The cost is a slightly more awkward UI ("修正记录"
-- creates a row rather than editing one). That cost is payable. The
-- other one is not.
--
--
-- WHAT THE THREE TABLES ARE FOR
--
--   instruments                  the catalogue: which scales exist, at
--                                which version, under what licence,
--                                citing what. Versioned rows, never
--                                edited in place (see below).
--   instrument_administrations   one completed assessment: the score,
--                                how it was scored, how complete it
--                                was, who supplied it.
--   instrument_item_responses    the individual answers behind that
--                                score. Kept even for the single-item
--                                scales shipping today, because a
--                                score without its item responses
--                                cannot be re-scored when a scoring
--                                rule is later found to be wrong, and
--                                re-scoring is the only repair that
--                                does not require asking the patient
--                                again.
--
-- `instruments` rows are versioned and immutable for the same reason
-- the administrations are: the wording of a behavioural anchor IS the
-- measurement. If 「能把一杯水举到嘴边」 is reworded next year, every
-- score recorded against the old wording answered a different
-- question. A reworded anchor is a NEW version row, and old
-- administrations keep pointing at the old one — which is why
-- `instrument_administrations` carries `instrument_version` and
-- foreign-keys the pair.


-- ---------------------------------------------------------------- catalogue

CREATE TABLE IF NOT EXISTS instruments (
  key             TEXT NOT NULL,
  version         TEXT NOT NULL,
  name_zh         TEXT NOT NULL,
  -- Whether we are allowed to put this scale in a patient's hands.
  -- Recorded per row rather than assumed, because "everyone uses it"
  -- is not a licence and the answer differs per instrument: the two
  -- shipping here are described in their original publications with no
  -- reserved rights asserted and are reproduced throughout the
  -- literature and in trial protocols, whereas several of the scales
  -- an FSHD app would obviously want next (FSHD-HI, IPA/ACTIVLIM) are
  -- licensed and would need permission before a single patient sees
  -- them. 'permission_required' rows are catalogue entries that must
  -- not be administered until the status changes.
  licence_status  TEXT NOT NULL
                  CHECK (licence_status IN (
                    'public_domain',
                    'free_with_attribution',
                    'permission_required',
                    'unknown'
                  )),
  -- The citation travels WITH the score, in the row, not in a doc
  -- somebody has to go find. A number whose provenance is a paragraph
  -- in a README is a number that will eventually be quoted without it.
  source_citation TEXT NOT NULL,
  score_min       NUMERIC(10,3) NOT NULL,
  score_max       NUMERIC(10,3) NOT NULL,
  -- Both scales shipping here count UPWARD as function is lost, which
  -- is the opposite of most patient-facing scores and exactly the kind
  -- of thing a chart renders backwards if nobody wrote it down.
  higher_is_worse BOOLEAN NOT NULL,
  -- The window the patient is asked to answer about ('current' for
  -- both scales here). Stored because "how are you" and "how have you
  -- been this month" are different measurements and a trend that mixes
  -- them is not a trend.
  recall_period   TEXT NOT NULL,
  admin_minutes   NUMERIC(5,2) NOT NULL CHECK (admin_minutes > 0),
  retired_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (key, version),
  CONSTRAINT instruments_score_range_check CHECK (score_max > score_min)
);

COMMENT ON TABLE instruments IS
  'Versioned catalogue of measurement instruments. Rows are immutable: a change to any anchor wording is a new version row, because old scores answered the old wording.';

-- Retiring a version is how a catalogue entry stops being offered.
-- Deleting it is not: administrations reference it, and a score whose
-- instrument definition has vanished is unreadable.
CREATE INDEX IF NOT EXISTS idx_instruments_live
  ON instruments (key, version)
  WHERE retired_at IS NULL;


-- ---------------------------------------------------------------- administrations

CREATE TABLE IF NOT EXISTS instrument_administrations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id          UUID NOT NULL REFERENCES patient_profiles (id) ON DELETE CASCADE,
  instrument_key      TEXT NOT NULL,
  instrument_version  TEXT NOT NULL,
  -- raw_score is what the instrument's own scoring produces before any
  -- transformation (for a single-item ordinal scale: the grade).
  -- scored_value is what a trend line and a registry export read. They
  -- are equal for both scales shipping today and deliberately kept as
  -- separate columns, because the first multi-item instrument added
  -- here (a summed scale with a published transformation to a 0-100
  -- metric) makes them differ, and back-filling a column that was
  -- never captured is not possible.
  raw_score           NUMERIC(10,3) NOT NULL,
  scored_value        NUMERIC(10,3) NOT NULL,
  -- Which pure function produced scored_value, versioned independently
  -- of the instrument. A scoring bug fixed next year must not silently
  -- reinterpret scores computed by the buggy version; this column is
  -- what makes "re-score everything written by brooke_v1_grade" a
  -- query rather than a guess.
  scoring_method      TEXT NOT NULL,
  -- Fraction of scorable items actually answered, 0..1. A score
  -- computed from half the items is not the same measurement as a
  -- complete one, and the difference must survive into the export.
  completeness        NUMERIC(4,3) NOT NULL
                      CHECK (completeness >= 0 AND completeness <= 1),
  -- Who helped. An enum, not free text: this row is patient-supplied
  -- and lands in the same export as everything else, and migration 015
  -- is the record of what one unconstrained patient-writable TEXT
  -- column cost. 'none' means the patient answered alone.
  assisted_by         TEXT NOT NULL DEFAULT 'none'
                      CHECK (assisted_by IN ('none', 'family', 'caregiver', 'clinician', 'other')),
  -- Who the answers came from. A self-report and a neurologist's grade
  -- are both legitimate and are NOT interchangeable; averaging them or
  -- plotting them on one unlabelled line would be exactly the
  -- "presenting a guess in the same register as evidence" this
  -- codebase refuses to do.
  source              TEXT NOT NULL
                      CHECK (source IN ('self', 'clinician', 'proxy')),
  -- The correction pointer. See the immutability note at the top.
  supersedes_id       UUID REFERENCES instrument_administrations (id) ON DELETE RESTRICT,
  -- When the assessment was performed, which is not when the row was
  -- written: a patient recording Sunday's answers on Tuesday must be
  -- able to say so, and a trend keyed on created_at would put the
  -- point in the wrong week.
  administered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT instrument_administrations_instrument_fk
    FOREIGN KEY (instrument_key, instrument_version)
    REFERENCES instruments (key, version),
  -- A row cannot supersede itself. Cheap to state, and the shape of
  -- bug that produces an infinite loop in a chain walker.
  CONSTRAINT instrument_administrations_no_self_supersede
    CHECK (supersedes_id IS NULL OR supersedes_id <> id)
);

COMMENT ON TABLE instrument_administrations IS
  'One completed instrument administration. IMMUTABLE once written: the trigger below rejects UPDATE. A correction is a new row whose supersedes_id points at the row it replaces.';

-- The superseding chain must stay linear. Two corrections both
-- claiming to replace the same administration leave "which one is
-- current" undecidable, and every read path would have to invent a
-- tie-break — which is a silent, per-query answer to a question the
-- data cannot answer.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_instrument_administrations_supersedes
  ON instrument_administrations (supersedes_id)
  WHERE supersedes_id IS NOT NULL;

-- 「我这半年的 Brooke 分数怎么走的」 — the trend query.
CREATE INDEX IF NOT EXISTS idx_instrument_administrations_trend
  ON instrument_administrations (profile_id, instrument_key, administered_at DESC);

-- Cross-row guard, same pattern and same reasoning as the
-- linked_document_id trigger migration 011 installs on
-- patient_followup_events: a CHECK cannot run a subquery, and without
-- this a caller (or a hand-written UPDATE, or a future import) could
-- point supersedes_id at ANOTHER patient's administration. The service
-- layer checks it too; this is the guard rail for the paths that never
-- go through the service.
--
-- Same instrument, as well as same profile: a Vignos answer cannot
-- correct a Brooke one. Instrument VERSION is deliberately allowed to
-- differ — re-answering last year's question against this year's
-- wording is a legitimate correction, and forbidding it would strand
-- every administration recorded before a re-version.
CREATE OR REPLACE FUNCTION instrument_administrations_supersede_guard()
RETURNS trigger AS $$
DECLARE
  prior RECORD;
BEGIN
  IF NEW.supersedes_id IS NOT NULL THEN
    SELECT profile_id, instrument_key
      INTO prior
      FROM instrument_administrations
     WHERE id = NEW.supersedes_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'supersedes_id % does not exist', NEW.supersedes_id;
    END IF;

    IF prior.profile_id <> NEW.profile_id THEN
      RAISE EXCEPTION
        'supersedes_id % belongs to a different profile', NEW.supersedes_id;
    END IF;

    IF prior.instrument_key <> NEW.instrument_key THEN
      RAISE EXCEPTION
        'supersedes_id % is an administration of instrument %, not %',
        NEW.supersedes_id, prior.instrument_key, NEW.instrument_key;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS instrument_administrations_supersede
  ON instrument_administrations;

CREATE TRIGGER instrument_administrations_supersede
  BEFORE INSERT ON instrument_administrations
  FOR EACH ROW
  EXECUTE FUNCTION instrument_administrations_supersede_guard();


-- ---------------------------------------------------------------- item responses

CREATE TABLE IF NOT EXISTS instrument_item_responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  administration_id UUID NOT NULL
                    REFERENCES instrument_administrations (id) ON DELETE CASCADE,
  item_code         TEXT NOT NULL,
  -- Versioned separately from the instrument. An instrument version
  -- bump caused by rewording item 3 leaves items 1 and 2 answering the
  -- same question they always did, and a re-scoring pass needs to know
  -- which is which.
  item_version      TEXT NOT NULL,
  response_value    NUMERIC(10,3),
  -- 「跳过」 and 「不适用」 are different facts, and the second is a
  -- clinical observation. This is the same distinction migration 017
  -- had to add a whole column for on patient_function_tests after
  -- NULL was made to carry both.
  skipped           BOOLEAN NOT NULL DEFAULT FALSE,
  not_applicable    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One answer per item per administration. Without this a retry that
  -- half-failed leaves two answers to the same question and the
  -- re-scoring pass picks one at random.
  CONSTRAINT uniq_instrument_item_response UNIQUE (administration_id, item_code),
  -- An answered item has a value; a skipped or N/A item does not.
  -- Both at once is the contradiction that makes a re-score
  -- unresolvable.
  CONSTRAINT instrument_item_responses_value_check
    CHECK (
      (skipped OR not_applicable) = (response_value IS NULL)
    ),
  CONSTRAINT instrument_item_responses_exclusive_check
    CHECK (NOT (skipped AND not_applicable))
);

COMMENT ON TABLE instrument_item_responses IS
  'The individual answers behind a scored administration. Kept so a score can be RE-scored if a scoring rule is later corrected; re-scoring is the only repair that does not require asking the patient again. Immutable, same as the parent.';

CREATE INDEX IF NOT EXISTS idx_instrument_item_responses_admin
  ON instrument_item_responses (administration_id);


-- ---------------------------------------------------------------- immutability

-- The enforcement half of the design decision at the top of this file.
--
-- A comment claiming rows are immutable, with nothing stopping an
-- UPDATE, is precisely the pattern this codebase has been bitten by
-- repeatedly: a documented guarantee that no code provides. So the
-- database refuses.
--
-- UPDATE only. DELETE stays permitted, and must: the account-deletion
-- purge erases a profile and these rows have to go with it (they
-- cascade), and PIPL Art. 47 erasure outranks an audit trail about a
-- person who has withdrawn. Immutability here means "a recorded score
-- is never quietly rewritten", not "a patient can never leave".
CREATE OR REPLACE FUNCTION instrument_rows_are_immutable()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    '% rows are immutable: record a new administration with supersedes_id instead of updating %',
    TG_TABLE_NAME, OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS instrument_administrations_immutable
  ON instrument_administrations;

CREATE TRIGGER instrument_administrations_immutable
  BEFORE UPDATE ON instrument_administrations
  FOR EACH ROW
  EXECUTE FUNCTION instrument_rows_are_immutable();

DROP TRIGGER IF EXISTS instrument_item_responses_immutable
  ON instrument_item_responses;

CREATE TRIGGER instrument_item_responses_immutable
  BEFORE UPDATE ON instrument_item_responses
  FOR EACH ROW
  EXECUTE FUNCTION instrument_rows_are_immutable();


-- ---------------------------------------------------------------- seed catalogue
--
-- The two instruments shipping today, as PATIENT SELF-ASSESSMENT.
--
-- That last part needs its evidence, because handing a patient a scale
-- designed for a neurologist's hands is not automatically sound. The
-- French National Registry of FSHD ran the comparison directly: a
-- clinical evaluation form completed by a neuromuscular specialist and
-- a self-report questionnaire completed by the patient, paired for 281
-- patients (131 women, 150 men; mean age 54.8 +/- 16.0), completed
-- within at most 3 months of each other and on the same day for 77.6%
-- of them. Agreement on these two scales:
--
--     Vignos   ICC 0.86 [95% CI 0.82-0.89]
--     Brooke   ICC 0.66 [95% CI 0.58-0.72]
--
-- and the registry moved both to patient entry on that basis.
--   Sanson B, Stalens C, Guien C, Villa L, Eng C, Rabarimeriarijaona S,
--   et al. Convergence of patient- and physician-reported outcomes in
--   the French National Registry of Facioscapulohumeral Dystrophy.
--   Orphanet J Rare Dis. 2022 Mar 2;17:96.
--   doi:10.1186/s13023-021-01793-6
--
-- Note the two numbers are not the same number. Vignos self-report is
-- strong; Brooke at 0.66 is moderate, and its lower CI bound (0.58)
-- sits at the edge of what anyone would call acceptable agreement.
-- Both are shipped, and the difference is carried in the catalogue and
-- shown to the patient rather than flattened into "validated".
--
-- The anchor wording and the licence status are documented in
-- apps/api/src/modules/patient-profile/instruments/brooke.ts and
-- vignos.ts, which are the source of truth for the item text. This
-- seed is the catalogue row only.

INSERT INTO instruments (
  key, version, name_zh, licence_status, source_citation,
  score_min, score_max, higher_is_worse, recall_period, admin_minutes
) VALUES
  (
    'brooke_upper_extremity', 'v1',
    'Brooke 上肢功能分级',
    'free_with_attribution',
    'Brooke MH, Griggs RC, Mendell JR, Fenichel GM, Shumate JB, Pellegrino RJ. Clinical trial in Duchenne dystrophy. I. The design of the protocol. Muscle Nerve. 1981;4(3):186-97. Grade wording reproduced from Lu Y-M, Lue Y-J. Strength and Functional Measurement for Patients with Muscular Dystrophy. In: Hegde M, editor. Muscular Dystrophy. IntechOpen; 2012. Table 1 (CC BY 3.0). Self-report reliability in FSHD: Sanson B, et al. Orphanet J Rare Dis. 2022;17:96 (ICC 0.66, 95% CI 0.58-0.72, n=281).',
    1, 6, TRUE, 'current', 2
  ),
  (
    'vignos_lower_extremity', 'v1',
    'Vignos 下肢功能分级',
    'free_with_attribution',
    'Vignos PJ Jr, Spencer GE Jr, Archibald KC. Management of progressive muscular dystrophy of childhood. JAMA. 1963;184:89-96. Grade wording reproduced from Lu Y-M, Lue Y-J. Strength and Functional Measurement for Patients with Muscular Dystrophy. In: Hegde M, editor. Muscular Dystrophy. IntechOpen; 2012. Table 2 (CC BY 3.0). Self-report reliability in FSHD: Sanson B, et al. Orphanet J Rare Dis. 2022;17:96 (ICC 0.86, 95% CI 0.82-0.89, n=281).',
    1, 10, TRUE, 'current', 2
  )
ON CONFLICT (key, version) DO NOTHING;


-- ---------------------------------------------------------------- enum gap 1: muscle groups
--
-- `face` and `abdominal` join MUSCLE_GROUPS. The reasoning is on the
-- constant in profile.constants.ts; the short version is that they are
-- two of the six regions of the FSHD Clinical Score, facial weakness
-- is the first thing this disease takes, and neither was recordable.
--
-- This is the FIRST value constraint this column has ever had — it has
-- been unconstrained TEXT NOT NULL since init_db.sql — so unlike the
-- other CHECKs in this file it is being applied to rows nobody has
-- validated.
--
-- NOT VALID, with eyes open. Migration 015's note is the reason to
-- hesitate: NOT VALID skips the scan at ADD time, but every later
-- UPDATE re-checks the whole tuple, so a row holding an out-of-set
-- value becomes un-updatable. Weighing that here:
--
--   * There is no UPDATE path on patient_measurements anywhere in the
--     API (unlike patient_function_tests, which migration 016 gave a
--     soft-delete UPDATE — that is what made 015's choice urgent).
--     Measurements are insert-and-read.
--   * A VALIDATING add would take ACCESS EXCLUSIVE and a full scan,
--     and would ABORT THE DEPLOY on the first legacy row outside the
--     set. Trading a hypothetical future UPDATE failure for a certain
--     outage now is the wrong direction.
--   * Destroying the offending values the way 015 had to is not an
--     option: muscle_group is NOT NULL and it is the entire meaning of
--     the measurement.
--
-- The DO block below reports the count instead of guessing, so the
-- question this file cannot answer is at least answered somewhere.
-- WHERE it is answered, precisely: it is RAISE WARNING, and only
-- WARNING, that lands in the POSTGRES SERVER log. Measured on PG 18
-- with the stock `log_min_messages = warning` this repo never
-- overrides (no postgresql.conf, no `command:` on the compose postgres
-- service): raising NOTICE, LOG, INFO and WARNING in one DO block
-- appends only the LOG and WARNING lines to the server log, and shows
-- only the NOTICE, INFO and WARNING lines to the psql client. NOTICE
-- is therefore the one level that reaches neither channel on the
-- documented deploy path, which is why BOTH branches below raise
-- WARNING — the clean branch is good news carrying a severity chosen
-- for delivery, not for alarm. Nothing of this reaches the output of
-- apps/api/src/db/migrate.ts either: node-postgres delivers WARNING
-- and NOTICE on the connection's 'notice' event and the runner does
-- not subscribe to it, so `npm run db:migrate` prints only
-- "Applied 022_patient_instruments.sql". Go and read the server log; a
-- silent deploy means the DO block did not run, not a clean table.
--
-- AND ON A DATABASE WHERE 022 ALREADY RAN, IT NEVER WILL. The runner
-- skips files already in schema_migrations, and a checksum change is a
-- report rather than a gate (see checksumOf in migrate.ts), so raising
-- the level here does nothing for a database that took the NOTICE
-- version — which includes dev, where the constraint is still NOT VALID.
-- There the operator has to ask directly, which costs one seq scan of
-- patient_measurements and answers the same question:
--     SELECT count(*) FROM patient_measurements
--      WHERE muscle_group NOT IN (
--        'deltoid', 'biceps', 'triceps', 'tibialis', 'quadriceps',
--        'hamstrings', 'gluteus', 'face', 'abdominal');
--
-- Either way, if the count is zero the constraint can be promoted with
--     ALTER TABLE patient_measurements
--       VALIDATE CONSTRAINT patient_measurements_muscle_group_check;
-- If it is more than zero, run
--     SELECT muscle_group, count(*) FROM patient_measurements
--      WHERE muscle_group NOT IN (...) GROUP BY 1;
-- and decide what those rows are before validating anything.
ALTER TABLE patient_measurements
  ADD CONSTRAINT patient_measurements_muscle_group_check
  CHECK (muscle_group IN (
    'deltoid',
    'biceps',
    'triceps',
    'tibialis',
    'quadriceps',
    'hamstrings',
    'gluteus',
    'face',
    'abdominal'
  ))
  NOT VALID;

DO $$
DECLARE
  offending BIGINT;
BEGIN
  SELECT count(*) INTO offending
    FROM patient_measurements
   WHERE muscle_group NOT IN (
     'deltoid', 'biceps', 'triceps', 'tibialis', 'quadriceps',
     'hamstrings', 'gluteus', 'face', 'abdominal'
   );

  IF offending = 0 THEN
    -- WARNING, not NOTICE, and the level is the whole point: NOTICE is
    -- filtered out by the stock log_min_messages, so the clean result —
    -- the one the operator is told to act on — was the one outcome that
    -- reached no log at all.
    RAISE WARNING
      'patient_measurements.muscle_group: 0 rows outside the value set; the constraint can be promoted with VALIDATE CONSTRAINT patient_measurements_muscle_group_check.';
  ELSE
    RAISE WARNING
      'patient_measurements.muscle_group: % row(s) hold a value outside the new CHECK set. They are readable and insertable-around, but any future UPDATE touching them will raise 23514. Inspect them before running VALIDATE CONSTRAINT.',
      offending;
  END IF;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------- enum gap 2: ambulation
--
-- `currentStatus.independentlyAmbulatory` stops being a boolean.
--
-- The boolean had two values for three facts. The mobile form offered
-- 「可独立行走」 and 「需要辅助」 and nothing else, so a patient who
-- cannot walk at all had to answer 「需要辅助」. Migration 017's own
-- comment walks past the wreckage without naming it: a profile that
-- "already says independentlyAmbulatory: false and lists a
-- wheelchair". `false` was carrying both 「拄拐能走」 and 「走不了」,
-- and those two people need different things from this app.
--
-- Three states now: 'independent' | 'assisted' | 'unable'.
--
-- BACK-FILL HONESTY. Every historical `true` becomes 'independent' and
-- every historical `false` becomes 'assisted'. That reproduces exactly
-- the label the patient tapped, and NOTHING MORE. A pre-022 'assisted'
-- is not evidence that the patient can walk with aid — it is evidence
-- that 'unable' was not on the screen. Anything reading this column
-- for research, cohorting or eligibility must treat pre-022 'assisted'
-- as 「非独立行走，程度未知」. The application-side note lives on
-- AMBULATION_STATES in profile.constants.ts so the warning is wherever
-- someone is reading.
--
-- The mapping is injective on the two legacy values, so 022_down can
-- reverse it exactly for rows written before this migration. It cannot
-- reverse 'unable', and says so.
--
-- 'unable' is the state FOLLOWUP_EVENT_TYPES.started_wheelchair
-- announces. Before this value existed the event could be logged and
-- the state it transitions into could not be recorded, so the timeline
-- and the profile were guaranteed to disagree. The instruments module
-- closes that loop on the Vignos path: Vignos grade 9 is literally
-- 「Is in a wheelchair」, and an administration at that grade updates
-- the baseline state and logs the event — see
-- instruments/instruments.service.ts.

UPDATE patient_profiles
   SET baseline_payload = jsonb_set(
         baseline_payload,
         '{currentStatus,independentlyAmbulatory}',
         '"independent"'::jsonb
       )
 WHERE baseline_payload #> '{currentStatus,independentlyAmbulatory}' = 'true'::jsonb;

UPDATE patient_profiles
   SET baseline_payload = jsonb_set(
         baseline_payload,
         '{currentStatus,independentlyAmbulatory}',
         '"assisted"'::jsonb
       )
 WHERE baseline_payload #> '{currentStatus,independentlyAmbulatory}' = 'false'::jsonb;

-- Validated, not NOT VALID: the two UPDATEs above have just brought
-- every existing row into the set, so the scan will pass, and there is
-- an UPDATE path on this table (every profile edit) that a NOT VALID
-- constraint would eventually trip over.
--
-- The chain of OR branches is deliberately permissive about SHAPE and
-- strict only about the value: baseline_payload is a free-form JSONB
-- document written by several screens, and a constraint that also
-- demanded currentStatus be present would reject every profile that
-- has not filled the baseline in yet.
ALTER TABLE patient_profiles
  ADD CONSTRAINT patient_profiles_ambulation_state_check
  CHECK (
    baseline_payload IS NULL
    OR jsonb_typeof(baseline_payload) <> 'object'
    OR NOT (baseline_payload ? 'currentStatus')
    OR jsonb_typeof(baseline_payload -> 'currentStatus') <> 'object'
    OR NOT (baseline_payload -> 'currentStatus' ? 'independentlyAmbulatory')
    OR jsonb_typeof(baseline_payload #> '{currentStatus,independentlyAmbulatory}') = 'null'
    OR baseline_payload #>> '{currentStatus,independentlyAmbulatory}'
       IN ('independent', 'assisted', 'unable')
  );
