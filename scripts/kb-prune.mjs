#!/usr/bin/env node
/**
 * Prune the knowledge-base corpus.
 *
 * Three things accumulated in `kb_chunks` that retrieval has to work
 * around on every single query:
 *
 *  1. **Duplicate rows.** Repeated ingests left 12,352 rows holding
 *     9,596 distinct texts — 22% redundancy. One observed query
 *     returned 12 chunks that were 9 distinct paragraphs, so a quarter
 *     of both the context budget and the citation list went on
 *     restating the same thing.
 *
 *  2. **Citation apparatus.** The corpus is mostly academic PDFs, and
 *     their bibliography and title pages match short queries as well as
 *     content does — they are dense in the disease name, the topic, and
 *     a lot of author surnames. Six of eight citations for a question
 *     about exercise were reference lists, after which the model quoted
 *    「据 Voet 等人 2014 年随机对照试验」, an author-year it had read off
 *     a numbered reference list and handed to a patient as evidence.
 *
 *  3. **Damaged extractions.** `(cid:N)` is what a PDF text layer
 *     leaves behind when the font has no usable encoding. Those chunks
 *     are unreadable to a person and to a model alike.
 *
 * `medical-kb.ts` already filters (2) and (3) at read time and dedupes
 * (1) per query. This removes them from the index instead, so the work
 * is done once rather than on every request — and, more importantly, so
 * that `fetch_k` spends its budget on candidates that can actually be
 * used. The retrieval-side filters stay as defence for anything a
 * future ingest reintroduces.
 *
 * Deliberately imports the SAME predicate the retriever uses rather
 * than restating it here. A corpus pruned by one rule and searched
 * under another would drift the moment either changed.
 *
 * Dry by default. Pass --apply to delete.
 *
 *   npm run kb:prune          # report only
 *   npm run kb:prune -- --apply
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// tsx is a repo dev dependency; it lets this reuse the retriever's
// predicate directly instead of maintaining a second copy.
require('tsx/cjs');
const { apparatusScore, isDamagedExtraction } = require(
  path.join(root, 'apps/api/src/modules/ai-agents/retrievers/medical-kb.ts'),
);

const APPARATUS_LIMIT = 2;
const MIN_CHARS = 30;
const TITLE_FRAGMENT_MAX = 120;
/** Mirrors `isTitleFragment` in medical-kb.ts: short, and closing no
 *  sentence, is a heading rather than something to read. */
const isTitleFragment = (text) =>
  text.trim().length < TITLE_FRAGMENT_MAX && !/[。．.！!？?；;]/.test(text);

const classify = (content) => {
  const text = content ?? '';
  if (text.trim().length < MIN_CHARS) return 'too_short';
  if (isDamagedExtraction(text)) return 'damaged_extraction';
  if (isTitleFragment(text)) return 'title_fragment';
  if (apparatusScore(text) >= APPARATUS_LIMIT) return 'citation_apparatus';
  return null;
};

const apply = process.argv.includes('--apply');
/**
 * Duplicates only.
 *
 * The two halves of this script carry very different risk. A duplicate
 * is provably safe to remove: the identical text stays in the index
 * under the copy we keep, so nothing becomes unfindable. The apparatus
 * and title-fragment rules are a heuristic, and a heuristic applied to
 * a medical corpus deletes on a judgement call — in research papers
 * especially, where a real paragraph can carry a dense cluster of
 * in-text citations. Retrieval already filters those at query time and
 * produces clean citations without this, so pruning them from the index
 * is an optimisation, not a fix.
 *
 * Hence the split: `--duplicates-only --apply` is the part that needs
 * no judgement. The rest stays reportable until someone decides, and
 * the better answer for it is filtering at ingest and re-ingesting
 * from content/medical-kb/source — which would also collapse the
 * same-document-under-two-filenames pairs at the root.
 */
const duplicatesOnly = process.argv.includes('--duplicates-only');
const databaseUrl =
  process.env.KB_SERVICE_DATABASE_URL?.replace('host.docker.internal', 'localhost') ??
  process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('Set KB_SERVICE_DATABASE_URL or DATABASE_URL.');
  process.exit(1);
}

const { Client } = require('pg');
const client = new Client({ connectionString: databaseUrl });

const main = async () => {
  await client.connect();

  const { rows } = await client.query(
    "SELECT id, content, coalesce(metadata->>'source_file', metadata->>'source', '(unknown)') AS src FROM kb_chunks",
  );
  console.log(`corpus: ${rows.length} rows`);

  /**
   * Which of two identical chunks to keep.
   *
   * The same document is often ingested twice under different names —
   * `FSHD_Care_Guidelines_for_Clinicians.pdf` also exists as
   * `A.指南摘要：FSHD_Care_Guidelines_for_Clinicians.pdf`. Keeping
   * whichever row the query happened to return first means the citation
   * a patient reads is decided by row order, so prefer the name that
   * reads better: no filing prefix, then shorter.
   */
  const prefer = (a, b) => {
    const prefixed = (s) => /^[A-Z][.、]|^\d+\s*[、.]/.test(s);
    if (prefixed(a) !== prefixed(b)) return prefixed(a) ? b : a;
    return a.length <= b.length ? a : b;
  };

  const bestSource = new Map();
  for (const row of rows) {
    const key = (row.content ?? '').replace(/\s+/g, ' ').trim();
    const current = bestSource.get(key);
    bestSource.set(key, current ? prefer(current, row.src) : row.src);
  }

  const kept = new Set();
  const duplicates = [];
  for (const row of rows) {
    const key = (row.content ?? '').replace(/\s+/g, ' ').trim();
    if (!kept.has(key) && row.src === bestSource.get(key)) {
      kept.add(key);
      continue;
    }
    duplicates.push(row.id);
  }

  const reasons = new Map();
  const junk = [];
  for (const row of rows) {
    if (duplicates.includes(row.id)) continue;
    const reason = classify(row.content);
    if (!reason) continue;
    junk.push(row.id);
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  const removable = duplicates.length + junk.length;
  console.log(`  duplicate rows       ${duplicates.length}`);
  for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason.padEnd(20)} ${n}`);
  }
  console.log(
    `  ---\n  removable            ${removable} (${Math.round((removable / rows.length) * 100)}%)`,
  );
  console.log(`  remaining            ${rows.length - removable}`);

  // A source whose every chunk is apparatus disappears from the KB
  // entirely. Usually that is correct — a scanned cover sheet has
  // nothing to retrieve — but it is the one outcome worth seeing before
  // deleting, because it is the difference between pruning a document
  // and losing it.
  // Two very different outcomes hide behind "this source loses every
  // chunk", and conflating them makes the alarm useless: a source whose
  // rows were all DUPLICATES keeps its text under the other filename,
  // while a source whose rows were all JUNK really does leave the KB.
  // Only the second is worth stopping for.
  const junkSet = new Set(junk);
  const dupSet = new Set(duplicates);
  const survivingText = new Set(
    rows.filter((r) => !junkSet.has(r.id) && !dupSet.has(r.id))
        .map((r) => (r.content ?? '').replace(/\s+/g, ' ').trim()),
  );

  const bySource = new Map();
  for (const row of rows) {
    const e = bySource.get(row.src) ?? { total: 0, gone: 0, textLost: 0 };
    e.total += 1;
    if (junkSet.has(row.id) || dupSet.has(row.id)) {
      e.gone += 1;
      if (!survivingText.has((row.content ?? '').replace(/\s+/g, ' ').trim())) e.textLost += 1;
    }
    bySource.set(row.src, e);
  }

  const renamed = [...bySource].filter(([, v]) => v.total === v.gone && v.textLost === 0);
  const emptied = [...bySource].filter(([, v]) => v.total === v.gone && v.textLost > 0);

  if (renamed.length) {
    console.log(
      `\n  ${renamed.length} sources are fully deduped away — their text survives under another filename`,
    );
  }
  if (emptied.length) {
    console.log(`\n  !! ${emptied.length} sources lose text that exists nowhere else:`);
    for (const [src, v] of emptied.slice(0, 15)) {
      console.log(`    ${v.textLost.toString().padStart(3)} chunks  ${src.slice(0, 68)}`);
    }
    if (emptied.length > 15) console.log(`    …and ${emptied.length - 15} more`);
  } else {
    console.log('\n  no source loses text that exists nowhere else');
  }

  if (!apply) {
    console.log(
      '\nDry run.\n' +
        '  --duplicates-only --apply   remove exact duplicates (provably safe)\n' +
        '  --apply                     also remove apparatus and title fragments',
    );
    await client.end();
    return;
  }

  const doomed = duplicatesOnly ? duplicates : [...duplicates, ...junk];
  await client.query('BEGIN');
  try {
    // Chunked so a large corpus does not build one enormous statement.
    for (let i = 0; i < doomed.length; i += 500) {
      await client.query('DELETE FROM kb_chunks WHERE id = ANY($1::uuid[])', [
        doomed.slice(i, i + 500),
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }

  const { rows: after } = await client.query('SELECT count(*)::int AS n FROM kb_chunks');
  console.log(`\ndeleted ${doomed.length}; ${after[0].n} rows remain`);
  await client.end();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
