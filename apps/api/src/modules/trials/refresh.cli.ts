#!/usr/bin/env node
/**
 * The entry point behind `npm run trials:refresh`.
 *
 * TWO WAYS TO RUN IT, AND THE PRODUCTION ONE IS NOT THE npm SCRIPT.
 *
 *   npm run trials:refresh
 *     Development, and any host that has run a full `npm ci`. The root
 *     script drives this file through tsx.
 *
 *   docker compose exec -T api node dist/modules/trials/refresh.cli.js
 *     Production. The runtime image installs with `npm ci --omit=dev`
 *     (apps/api/Dockerfile), so tsx — a devDependency — is NOT in it and
 *     the npm script above cannot run there. The compiled file is,
 *     because tsconfig.json includes all of src, and the image's
 *     WORKDIR is /app/apps/api. Verified by building dist and running
 *     the emitted file directly.
 *
 * Meant for host cron. A sane crontab line, with flock so a slow scrape
 * cannot overlap the next tick:
 *
 *   17 * * * * cd /srv/openrd && flock -n /tmp/openrd-trials.lock docker compose exec -T api node dist/modules/trials/refresh.cli.js >> /var/log/openrd/trials.log 2>&1
 *
 * Exit code is 0 only when EVERY source succeeded. A partial refresh
 * exits 1 with the reason on stderr and in `trial_fetch_runs.error`, so
 * cron mail and the ops page say the same thing.
 *
 * A `pg.Client`, not the API's pool: this is a one-shot process, and
 * `refreshTrials` issues BEGIN/COMMIT as statements, which needs one
 * connection that stays put (see TrialsDb in trials.repository.ts).
 *
 * Overlapping runs are not corrupting even without the flock — each
 * source's delete, upsert and success flag are one transaction, so the
 * later one simply wins and stamps its own `fetched_at`. The lock is
 * there to keep two scrapes off 药物临床试验登记与信息公示平台 at once.
 *
 * Required env: DATABASE_URL, from the same .env the API reads
 * (`--env-file-if-exists=.env` in the root package.json script).
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

import { refreshTrials } from './refresh.js';
import type { TrialsDb } from './trials.repository.js';
import { loadAppEnv } from '../../config/env.js';
import { createLogger } from '../../config/logger.js';
import { resolvePgSsl } from '../../db/pool.js';

/** `pg.Client.query` is overloaded and does not structurally satisfy
 *  `TrialsDb`; adapt once here, exactly as migrate.ts does for its own
 *  narrowed client. */
const asTrialsDb = (client: Client): TrialsDb => ({
  query: async (sql, values) => {
    const result = values === undefined ? await client.query(sql) : await client.query(sql, values);
    return { rows: result.rows as Array<Record<string, unknown>>, rowCount: result.rowCount };
  },
});

export const main = async (): Promise<void> => {
  const env = loadAppEnv();
  const logger = createLogger(env);

  const client = new Client({
    connectionString: env.DATABASE_URL,
    ssl: resolvePgSsl(env),
  });
  await client.connect();

  try {
    const outcomes = await refreshTrials({ db: asTrialsDb(client), logger });

    for (const outcome of outcomes) {
      if (outcome.ok) {
        // The registry's own count is in the line, not just ours. This
        // output is what cron mails to an operator, and
        // 「0 record(s) written」 on its own reads as a broken scraper;
        // 「the registry reported 0 matching」 is the registry
        // answering. They are the two sentences the whole feature is
        // built to keep apart — see refresh.ts's header and migration
        // 027.
        process.stdout.write(
          `trials:refresh ${outcome.source}: ok, registry reported ${outcome.sourceReportedTotal} matching, ${outcome.recordsUpserted} record(s) written, ${outcome.recordsDeleted} removed\n`,
        );
      } else {
        process.stderr.write(`trials:refresh ${outcome.source}: FAILED — ${outcome.error}\n`);
      }
    }

    const failed = outcomes.filter((outcome) => !outcome.ok);
    if (failed.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
};

/**
 * Only refresh when this file IS the program — the same guard, and for
 * the same reason, as apps/api/src/db/migrate.ts: importing a module
 * must not connect to DATABASE_URL and start writing.
 */
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
})();

if (invokedDirectly) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
