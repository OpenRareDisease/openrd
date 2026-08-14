#!/usr/bin/env node
/**
 * Grant or revoke the `admin` role, from the host, by a human.
 *
 *   npm run admin:grant  -- +8613900000000
 *   npm run admin:revoke -- +8613900000000
 *
 * WHY THIS IS A SCRIPT AND NOT A SCREEN
 *
 * `admin` is the role that can read any patient's whole record. There
 * is deliberately no endpoint that grants it and no field in the
 * registration form that requests it — `registerSchema` in
 * apps/api/src/modules/auth/auth.schema.ts accepts only
 * ('patient','caregiver'), and it must stay that way; the comment above
 * it explains why for the `clinician` case and the reasoning is the
 * same here, only louder. Requiring DATABASE_URL means requiring
 * somebody to be on the host with the database credentials, which is
 * the smallest set of people who could grant themselves this access
 * anyway. Making it a script does not add a barrier so much as it
 * refuses to remove one.
 *
 * WHAT IT DOES
 *
 *   - resolves the phone number to exactly one app_users row, and
 *     refuses if there is no such account
 *   - prints the exact transition and asks the operator to type the
 *     phone number back before anything is written
 *   - writes the role change and an audit_logs row in ONE transaction,
 *     so there is no state in which the role changed and the trail did
 *     not
 *
 * Required env:
 *   DATABASE_URL   Same shape the API uses; loaded from .env by the
 *                  npm script's `--env-file-if-exists=.env`.
 */

import { createInterface } from 'node:readline/promises';
import { hostname, userInfo } from 'node:os';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { Client } from 'pg';

/**
 * These two strings are members of ADMIN_AUDIT_EVENTS in
 * apps/api/src/middleware/require-admin.ts. They are repeated rather
 * than imported because this is a .mjs file and that is a TypeScript
 * constant; require-admin.test.ts reads this file and asserts the
 * strings still match, so a typo here fails the API test suite instead
 * of silently dropping the grant trail out of every
 * `event_type LIKE 'admin.%'` query.
 */
const AUDIT_EVENT = { grant: 'admin.grant', revoke: 'admin.revoke' };

const usage = `Usage:
  npm run admin:grant  -- <phone>
  npm run admin:revoke -- <phone>

  <phone>   The account's phone number, with or without the +86 prefix.
            Both forms are looked up; the account must already exist.

Both commands ask for confirmation on a terminal and write an
audit_logs row in the same transaction as the role change.

On a production stack, run it inside the api container, which has this
file (apps/api/Dockerfile copies it), the pg dependency, and the
database credentials already in its environment:

  docker compose exec api node /app/scripts/admin-role.mjs grant <phone>

Note 「exec」 and not 「exec -T」: -T takes the terminal away, and
this refuses to run without one — it checks before opening a
transaction, so a -T invocation changes nothing.
`;

const fail = (message, code = 1) => {
  console.error(message);
  process.exit(code);
};

/**
 * Mirrors normalizePhone in apps/api/src/utils/phone.ts. Both forms are
 * used in the lookup rather than trusting either one: the column has
 * held both shapes historically (see the note on `phoneNumber` in
 * auth.schema.ts), and a normalisation rule that drifts from the API's
 * would silently look up an account that is not the one the operator
 * means.
 */
const withCountryCode = (phone) => (phone.startsWith('+') ? phone : `+86${phone}`);

const parseArgs = (argv) => {
  const positional = [];
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(usage);
      process.exit(0);
    }
    if (arg.startsWith('-')) fail(`unknown argument: ${arg}\n\n${usage}`);
    positional.push(arg);
  }
  const [mode, phone, ...rest] = positional;
  if (mode !== 'grant' && mode !== 'revoke') {
    fail(`first argument must be 'grant' or 'revoke'; got ${JSON.stringify(mode)}\n\n${usage}`);
  }
  if (!phone) fail(`a phone number is required\n\n${usage}`);
  if (rest.length > 0) {
    // Refuse rather than ignore: `npm run admin:grant -- +86139... +86138...`
    // silently granting only the first is the shape of mistake that
    // ends with somebody believing two people have access.
    fail(`only one phone number at a time; got ${positional.length - 1}\n\n${usage}`);
  }
  return { mode, phone: phone.trim() };
};

const resolveAccount = async (client, phone) => {
  const candidates = [...new Set([phone, withCountryCode(phone)])];
  const result = await client.query(
    'SELECT id, phone_number, role, is_active FROM app_users WHERE phone_number = ANY($1::citext[])',
    [candidates],
  );

  if (result.rowCount === 0) {
    fail(
      `no app_users row for ${phone} (tried ${candidates.join(' and ')}). ` +
        'This script never creates an account: the person has to register in the app first.',
    );
  }
  if (result.rowCount > 1) {
    // The split-account failure auth.schema.ts describes, seen from the
    // other side. Guessing which half of a person's record to hand the
    // admin role to is not a decision this script gets to make.
    fail(
      `${result.rowCount} accounts match ${phone}: ${result.rows
        .map((row) => `${row.phone_number} (${row.id})`)
        .join(', ')}. Merge them before granting anything.`,
    );
  }
  return result.rows[0];
};

/**
 * What `revoke` should put back.
 *
 * The honest inverse of a grant is the role the account held before
 * that grant, and the grant's own audit row is the only place that is
 * written down. When it is there, use it. When it is not — the account
 * was granted by hand, or the row aged out of the 180-day window in
 * apps/api/src/services/audit/retention.ts — 'patient' is an ASSUMPTION,
 * and the caller says so in the confirmation prompt rather than
 * quietly demoting someone who was a clinician.
 */
const resolveRevokeTarget = async (client, userId) => {
  const result = await client.query(
    `SELECT event_payload ->> 'previousRole' AS previous_role
       FROM audit_logs
      WHERE event_type = $1
        AND event_payload ->> 'targetUserId' = $2
      ORDER BY occurred_at DESC
      LIMIT 1`,
    [AUDIT_EVENT.grant, userId],
  );
  const recorded = result.rows[0]?.previous_role;
  return recorded ? { role: recorded, known: true } : { role: 'patient', known: false };
};

/** Ask on a terminal, or refuse. */
const confirm = async (question, expected) => {
  if (!process.stdin.isTTY) {
    // No `--yes`, on purpose. A role that can read every patient record
    // should not be grantable by something that is not a person, and a
    // flag that skips the prompt is how it ends up in a deploy script.
    fail(
      'stdin is not a terminal, so the confirmation cannot be asked for. ' +
        'Run it from an interactive shell — on a production stack that is ' +
        'docker compose exec api (no -T).',
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return answer.trim() === expected;
  } finally {
    rl.close();
  }
};

const apply = async (client, { mode, account, newRole }) => {
  const operator = `${userInfo().username}@${hostname()}`;

  await client.query('BEGIN');
  try {
    const updated = await client.query(
      // Guarded on the role we showed the operator. Between the SELECT
      // and here, another operator on another shell may have changed
      // it; without this, one of the two confirmations silently loses
      // and the audit row claims a transition that did not happen.
      'UPDATE app_users SET role = $1, updated_at = NOW() WHERE id = $2 AND role = $3',
      [newRole, account.id, account.role],
    );
    if (updated.rowCount !== 1) {
      throw new Error(
        `the account's role is no longer ${account.role}; nothing was changed. Re-run to see the current state.`,
      );
    }

    // The phone number is deliberately NOT in this payload. audit_logs
    // is the table services/audit/identity-masking.ts exists to keep
    // dialable numbers out of, and `targetUserId` already identifies
    // the account for anyone reading the trail.
    //
    // `adminUserId` is null because the actor here is a shell user
    // holding the database credentials, not an app account. `operator`
    // records who that shell user claimed to be — it is the process's
    // own username, which anybody with DATABASE_URL can set to
    // anything, so read it as a helpful label and not as an
    // authenticated identity.
    //
    // `path` / `method` keep the shape uniform with the rows
    // requireAdmin writes, so one `event_type LIKE 'admin.%'` query
    // returns the whole back-office trail rather than two shapes that
    // have to be unioned.
    await client.query(
      `INSERT INTO audit_logs (event_type, event_payload)
       VALUES ($1, $2::jsonb)`,
      [
        mode === 'grant' ? AUDIT_EVENT.grant : AUDIT_EVENT.revoke,
        JSON.stringify({
          adminUserId: null,
          targetUserId: account.id,
          path: 'scripts/admin-role.mjs',
          method: 'CLI',
          operator,
          previousRole: account.role,
          newRole,
        }),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error?.code === '23514') {
      // Promised by db/migrations/026_trials_and_admin.sql: the role
      // CHECK is NOT VALID, so a row still holding a pre-011 role value
      // cannot be UPDATEd at all.
      fail(
        `Postgres rejected the new role (${error.constraint ?? 'check constraint'}). ` +
          "The account's current role is outside the CHECK set on app_users.role, which makes " +
          'the row un-updatable until it is corrected. Inspect it with: ' +
          `SELECT id, role FROM app_users WHERE id = '${account.id}';`,
      );
    }
    throw error;
  }
};

const main = async () => {
  const { mode, phone } = parseArgs(process.argv.slice(2));

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail('DATABASE_URL not set (the npm script loads it from .env; run this on the host).');
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const account = await resolveAccount(client, phone);

    if (mode === 'grant' && account.role === 'admin') {
      console.log(`${account.phone_number} (${account.id}) is already admin. Nothing to do.`);
      return;
    }
    if (mode === 'revoke' && account.role !== 'admin') {
      console.log(
        `${account.phone_number} (${account.id}) is ${account.role}, not admin. Nothing to do.`,
      );
      return;
    }

    let newRole = 'admin';
    let assumption = null;
    if (mode === 'revoke') {
      const target = await resolveRevokeTarget(client, account.id);
      newRole = target.role;
      if (!target.known) {
        assumption =
          '  NOTE: no admin.grant row records what this account was before it became admin\n' +
          "        (granted by hand, or older than the 180-day audit window), so 'patient'\n" +
          '        is an assumption. Set the role by hand if it should be something else.';
      }
    }

    console.log('');
    console.log(`  account   ${account.phone_number}`);
    console.log(`  user id   ${account.id}`);
    console.log(`  active    ${account.is_active}`);
    console.log(`  role      ${account.role}  ->  ${newRole}`);
    if (assumption) console.log(assumption);
    if (mode === 'grant') {
      console.log('');
      console.log('  An admin can read every patient record in this database. Every request');
      console.log('  they make, reads included, is written to audit_logs.');
    }
    console.log('');

    // Typing the number back, rather than 'y'. The mistake this is
    // aimed at is granting to the wrong account after copying the wrong
    // line out of a support thread — a prompt that accepts one keystroke
    // does not make anybody re-read the number.
    const ok = await confirm(
      `Type the account's phone number (${account.phone_number}) to confirm, anything else to abort: `,
      account.phone_number,
    );
    if (!ok) {
      console.log('Aborted. Nothing was changed.');
      process.exitCode = 1;
      return;
    }

    await apply(client, { mode, account, newRole });

    const after = await client.query('SELECT role FROM app_users WHERE id = $1', [account.id]);
    console.log(`Done. ${account.phone_number} is now ${after.rows[0].role}.`);
    if (mode === 'revoke') {
      // Say the thing that is not true, before somebody assumes it is.
      console.log(
        'Their existing session token still says admin, but it no longer grants anything: ' +
          'requireAdmin reads the role from the database on every request.',
      );
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
