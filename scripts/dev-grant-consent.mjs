#!/usr/bin/env node
/**
 * Grant or revoke a user's AI consent flags from the command line.
 *
 * The mobile consent UI (Phase 3a, PR #27/#28) is the right path for
 * production users, but during dev / QA / smoke tests it's much
 * faster to flip the flags directly:
 *
 *   - Toggle a flag without going through OTP login + consent UI
 *   - Reset a test user back to consent=none to retest the 403 path
 *   - Bring up a freshly-migrated DB with one consenting user so
 *     `curl /api/ai/ask` works immediately
 *
 * The script reuses the same precise-coercion rules as the backend's
 * `updateConsent` helper:
 *   - Setting personal/thirdParty=false coerces precise to false
 *   - Requesting precise=true without the base pair throws an error
 *
 * Required env:
 *   DATABASE_URL    Same shape as the backend uses; loaded from .env
 *                   via `node --env-file-if-exists=.env`.
 *
 * Examples:
 *   npm run dev:grant-consent -- --phone +8613900000000 --level basic
 *   npm run dev:grant-consent -- --user-id <uuid> --level precise
 *   npm run dev:grant-consent -- --phone +8613900000000 --level none
 *   npm run dev:grant-consent -- --phone +8613900000000        # read-only status
 */

import { pathToFileURL } from 'node:url';
import process from 'node:process';

import { Client } from 'pg';

const VALID_LEVELS = new Set(['none', 'basic', 'precise']);

const usage = `Usage:
  node scripts/dev-grant-consent.mjs [--user-id <uuid> | --phone <+86...>] [--level <none|basic|precise>] [--json]

Without --level the script prints the current consent state and exits.
With --level it mutates the row + per-flag _at timestamps, then prints
the resulting state. --json swaps the human-readable output for a
single JSON object (handy for piping into jq).

Examples:
  npm run dev:grant-consent -- --phone +8613900000000 --level basic
  npm run dev:grant-consent -- --user-id <uuid> --level precise
  npm run dev:grant-consent -- --phone +8613900000000          # status only
`;

const fail = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

const parseArgs = (argv) => {
  const out = { phone: null, userId: null, level: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(usage);
      process.exit(0);
    }
    if (arg === '--json') {
      out.json = true;
      continue;
    }
    if (arg === '--phone') {
      out.phone = argv[++i];
      continue;
    }
    if (arg === '--user-id') {
      out.userId = argv[++i];
      continue;
    }
    if (arg === '--level') {
      out.level = argv[++i];
      continue;
    }
    fail(`unknown argument: ${arg}\n\n${usage}`);
  }
  if (out.userId && out.phone) {
    fail('--user-id and --phone are mutually exclusive');
  }
  if (!out.userId && !out.phone) {
    fail('one of --user-id or --phone is required\n\n' + usage);
  }
  if (out.level !== null && !VALID_LEVELS.has(out.level)) {
    fail(
      `--level must be one of ${[...VALID_LEVELS].join(', ')}; got ${JSON.stringify(out.level)}`,
    );
  }
  return out;
};

const resolveUserId = async (client, { userId, phone }) => {
  if (userId) {
    const r = await client.query('SELECT id, phone_number FROM app_users WHERE id = $1', [userId]);
    if (r.rowCount === 0) fail(`no app_users row for id=${userId}`);
    return r.rows[0];
  }
  const r = await client.query('SELECT id, phone_number FROM app_users WHERE phone_number = $1', [phone]);
  if (r.rowCount === 0) fail(`no app_users row for phone=${phone}`);
  return r.rows[0];
};

const readState = async (client, userId) => {
  const r = await client.query(
    `SELECT ai_consent_personal AS personal,
            ai_consent_third_party AS third_party,
            ai_consent_precise_values AS precise_values,
            ai_consent_personal_at AS personal_at,
            ai_consent_third_party_at AS third_party_at,
            ai_consent_precise_values_at AS precise_values_at
       FROM patient_profiles
      WHERE user_id = $1`,
    [userId],
  );
  if (r.rowCount === 0) return null;
  const row = r.rows[0];
  const level =
    row.personal && row.third_party
      ? row.precise_values
        ? 'precise'
        : 'basic'
      : 'none';
  return {
    level,
    flags: {
      personal: row.personal,
      thirdParty: row.third_party,
      preciseValues: row.precise_values,
    },
    timestamps: {
      personalAt: row.personal_at?.toISOString() ?? null,
      thirdPartyAt: row.third_party_at?.toISOString() ?? null,
      preciseValuesAt: row.precise_values_at?.toISOString() ?? null,
    },
  };
};

/** Resolve a target level into the three flag values. Mirrors the
 *  backend `updateConsent` semantics: precise requires both base
 *  flags; revoking either base flag forces precise=false. */
const targetFlagsForLevel = (level) => {
  switch (level) {
    case 'none':
      return { personal: false, thirdParty: false, preciseValues: false };
    case 'basic':
      return { personal: true, thirdParty: true, preciseValues: false };
    case 'precise':
      return { personal: true, thirdParty: true, preciseValues: true };
    default:
      throw new Error(`unreachable level=${level}`);
  }
};

const applyLevel = async (client, userId, level) => {
  const current = await readState(client, userId);
  if (!current) {
    fail(`no patient_profiles row for user_id=${userId} -- the user has not finished onboarding yet`);
  }
  const target = targetFlagsForLevel(level);

  // Only bump `_at` for flags whose value actually changes.
  // Per migration 009, every flag transition the in-app updateConsent
  // helper makes also writes a row into ai_consent_events. Mirror
  // that contract here with source='admin' so a "did this user
  // consent during week X?" compliance look-up against
  // ai_consent_events captures CLI-driven overrides instead of
  // having a hole next to the in-app history. Wrap UPDATE + events
  // INSERTs in one transaction so a crash mid-loop doesn't leave
  // the table half-mutated.
  const transitions = [];
  const sets = [];
  const values = [];
  for (const [flag, flagName, sqlColumn, atColumn] of [
    ['personal', 'personal', 'ai_consent_personal', 'ai_consent_personal_at'],
    ['thirdParty', 'third_party', 'ai_consent_third_party', 'ai_consent_third_party_at'],
    ['preciseValues', 'precise_values', 'ai_consent_precise_values', 'ai_consent_precise_values_at'],
  ]) {
    if (current.flags[flag] !== target[flag]) {
      values.push(target[flag]);
      sets.push(`${sqlColumn} = $${values.length}`);
      sets.push(`${atColumn} = NOW()`);
      transitions.push({
        flag_name: flagName,
        from_value: current.flags[flag],
        to_value: target[flag],
      });
    }
  }
  if (sets.length === 0) return current;
  sets.push('updated_at = NOW()');
  values.push(userId);

  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE patient_profiles SET ${sets.join(', ')} WHERE user_id = $${values.length}`,
      values,
    );
    for (const t of transitions) {
      await client.query(
        `INSERT INTO ai_consent_events
           (user_id, flag_name, from_value, to_value, source, note)
         VALUES ($1, $2, $3, $4, 'admin', 'dev-grant-consent CLI')`,
        [userId, t.flag_name, t.from_value, t.to_value],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  return readState(client, userId);
};

const printHuman = ({ user, before, after }) => {
  console.log(`user: ${user.id}  phone=${user.phone_number}`);
  if (after && before) {
    console.log(`before: level=${before.level}  personal=${before.flags.personal}  thirdParty=${before.flags.thirdParty}  precise=${before.flags.preciseValues}`);
    console.log(`after:  level=${after.level}  personal=${after.flags.personal}  thirdParty=${after.flags.thirdParty}  precise=${after.flags.preciseValues}`);
  } else {
    const state = after ?? before;
    if (!state) {
      console.log('  no patient_profiles row');
      return;
    }
    console.log(`level=${state.level}  personal=${state.flags.personal}  thirdParty=${state.flags.thirdParty}  precise=${state.flags.preciseValues}`);
    if (state.timestamps.personalAt) console.log(`  personal_at: ${state.timestamps.personalAt}`);
    if (state.timestamps.thirdPartyAt) console.log(`  thirdParty_at: ${state.timestamps.thirdPartyAt}`);
    if (state.timestamps.preciseValuesAt) console.log(`  preciseValues_at: ${state.timestamps.preciseValuesAt}`);
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  // Refuse to run against a production-shaped env. The mobile
  // consent UI is the audited path for production users; a CLI
  // override here would bypass the OTP login + UI confirmation
  // step that compliance assumes happened. If a real support need
  // arises (e.g. user phones in to revoke), build a proper
  // back-office workflow that captures who issued the override
  // and why. Operators who deliberately need to run this against
  // a staging DB can set DEV_GRANT_CONSENT_FORCE=1 to acknowledge
  // they're not pointed at prod.
  if (process.env.NODE_ENV === 'production' && process.env.DEV_GRANT_CONSENT_FORCE !== '1') {
    fail(
      'refusing to run with NODE_ENV=production. Use the in-app consent flow ' +
        'or build a proper back-office tool. Set DEV_GRANT_CONSENT_FORCE=1 ' +
        'only if you are 100% sure the DATABASE_URL is not pointing at prod.',
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail('DATABASE_URL not set (load via `node --env-file-if-exists=.env`).');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const user = await resolveUserId(client, args);
    const before = await readState(client, user.id);
    let after = null;
    if (args.level !== null) {
      after = await applyLevel(client, user.id, args.level);
    }
    if (args.json) {
      process.stdout.write(
        JSON.stringify({ user, before, after: after ?? before }, null, 2) + '\n',
      );
    } else {
      printHuman({ user, before, after });
    }
  } finally {
    await client.end();
  }
};

const entry = pathToFileURL(process.argv[1] ?? '').href;
if (import.meta.url === entry) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
