#!/usr/bin/env node
/**
 * kb-doctor — report the drift between what the corpus contains and
 * what the knowledge base contains.
 *
 * Why this exists: nothing showed the gap. 《中国康复辅助器具目录
 * （2023年版）》 — 2,303,041 bytes, 110 pages of the national
 * assistive-device catalogue — is an OLE2 file with a .docx extension.
 * Every ingest detected that, logged one line among hundreds, and moved
 * on; the file was outside the index for months and the only symptom
 * was the KB failing to answer 「踝足矫形器在国家目录里是哪一类」 for a
 * patient assembling a subsidy claim. Nobody could see it because
 * nothing compared the two sides.
 *
 * `npm run kb:ingest` prints per-file actions for the run it just did.
 * This asks a different question: given everything on disk and
 * everything in kb_chunks right now, what disagrees?
 *
 *   A. on disk, absent from the index
 *   B. in the index, gone from disk
 *   C. on disk in a format no parser claims (never eligible)
 *   D. chunk count and language mix per top-level category
 *   E. indexed far thinner than the file's extractable text
 *   F. stored category disagreeing with the category its path implies
 *
 * A and E accuse specific files, so by default the accused ones (and
 * only those — see `chooseExtractionCandidates`) get re-parsed to
 * confirm or clear the charge. That costs a few seconds per large PDF,
 * which is why the candidate set is bounded rather than the corpus.
 *
 * Runs without a database: the disk half is reported and the report
 * says plainly that the index half was not checked, so CI can use it
 * before a DB exists.
 *
 *   npm run kb:doctor
 *   npm run kb:doctor -- --no-extract          # fast, skips the re-parse
 *   npm run kb:doctor -- --json report.json
 *   npm run kb:doctor -- --source content/medical-kb/source
 *
 * Exit status: 0 clean, 1 drift found, 2 the doctor could not complete
 * a check it was asked to run.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPTS_DIR, '..');

// --------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const hasFlag = (name) => argv.includes(name);
const flagValue = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

if (hasFlag('--help') || hasFlag('-h')) {
  console.log(
    [
      'kb-doctor — disk corpus vs kb_chunks drift report',
      '',
      '  --source <dir>     corpus root (default content/medical-kb/source)',
      '  --no-extract       skip re-parsing the accused files',
      '  --max-extract <n>  cap on files re-parsed (default 80)',
      '  --json <path>      also write the full report as JSON',
      '',
      'exit 0 clean, 1 drift found, 2 a requested check could not run',
    ].join('\n'),
  );
  process.exit(0);
}

const OPTIONS = {
  source: flagValue('--source', path.join(ROOT, 'content', 'medical-kb', 'source')),
  extract: !hasFlag('--no-extract'),
  maxExtract: Number.parseInt(flagValue('--max-extract', '80'), 10),
  json: flagValue('--json', null),
};

if (!Number.isFinite(OPTIONS.maxExtract) || OPTIONS.maxExtract < 0) {
  console.error('--max-extract needs a non-negative integer');
  process.exit(2);
}

// ------------------------------------------------------------- corpus root

/**
 * Mirror of `resolve_effective_root` in scripts/kb-ingest.py.
 *
 * Unzipping FSHD_知识库.zip leaves the real category folders one level
 * below the content root. The ingester descends through that wrapper,
 * so every source_file in the DB is relative to the *inner* directory.
 * A doctor that walked the outer one would report all 235 files as
 * missing and all 206 rows as orphans — the loudest possible way to
 * say nothing at all.
 *
 * Kept deliberately identical (one subdir, no files, no dot-entries) so
 * the two agree. If kb-ingest.py's rule changes, this must follow.
 */
const resolveEffectiveRoot = (root) => {
  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    return root;
  }
  if (!stat.isDirectory()) return root;
  const visible = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => !e.name.startsWith('.') && e.name !== '__MACOSX');
  if (visible.length === 1 && visible[0].isDirectory()) {
    return path.join(root, visible[0].name);
  }
  return root;
};

/**
 * NFC, matching `relative_source_key`. macOS hands back decomposed CJK
 * filenames and Postgres holds the composed form; without this every
 * accented or CJK path would look like drift in both directions.
 */
const sourceKey = (abs, root) => path.relative(root, abs).normalize('NFC');

const categoryOf = (key) => {
  const parts = key.split(path.sep);
  // Matches `_derive_metadata_from_path`: files sitting at the corpus
  // root get an empty category, which is stored as '' in the DB.
  return parts.length > 1 ? parts[0] : '';
};
const categoryLabel = (category) => category || '(corpus root)';

// ------------------------------------------------------------ python probe

/**
 * The parsers are Python and there is exactly one copy of them. Rather
 * than restate their extension list — and their idea of how much text a
 * file yields — in JavaScript, shell out. A second copy of "which
 * formats count" is how a doctor ends up certifying a corpus it is
 * mis-reading.
 */
const PYTHON_PROBE = String.raw`
import json, logging, re, sys
from pathlib import Path

scripts_dir = sys.argv[1]
sys.path.insert(0, scripts_dir)
# pdfminer logs a FontBBox warning per page of nearly every paper in the
# corpus; on stderr it would bury the real output.
logging.getLogger("pdfminer").setLevel(logging.ERROR)

from kb_parsers import ALL_PARSERS, get_parser_for  # noqa: E402

mode = sys.argv[2]
if mode == "extensions":
    exts = sorted({e for p in ALL_PARSERS for e in p.extensions})
    print(json.dumps({"extensions": exts}))
    raise SystemExit(0)

PROBE_WIDTH = 80
PROBE_COUNT = 6
# Titles, author lists and boilerplate headers repeat across a corpus of
# papers, so a probe taken from the first couple of hundred characters
# would match some other document and report a lost file as deduplicated.
PROBE_SKIP_HEAD = 200


def probes(text):
    flat = re.sub(r"\s+", " ", text).strip()
    if not flat:
        return []
    if len(flat) <= PROBE_WIDTH:
        return [flat]
    start = PROBE_SKIP_HEAD if len(flat) > PROBE_SKIP_HEAD + PROBE_WIDTH else 0
    span = len(flat) - PROBE_WIDTH - start
    step = max(1, span // max(1, PROBE_COUNT - 1))
    out = []
    for i in range(PROBE_COUNT):
        at = start + i * step
        if at + PROBE_WIDTH > len(flat):
            break
        out.append(flat[at : at + PROBE_WIDTH])
    return out


payload = json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"))
root = Path(payload["root"])
results = []
for rel in payload["files"]:
    record = {"rel": rel}
    target = root / rel
    parser = get_parser_for(target)
    if parser is None:
        record["error"] = "no parser handles this extension"
    else:
        record["parser"] = parser.parser_name
        try:
            parsed = parser.parse(target)
            text = "\n".join(s.text for s in parsed.sections)
            record["chars"] = len(text)
            record["sections"] = len(parsed.sections)
            record["parse_error"] = parsed.metadata.get("parse_error")
            record["format_hint"] = parsed.metadata.get("format_hint")
            record["converted_via"] = parsed.metadata.get("converted_via")
            record["probes"] = probes(text)
        except Exception as exc:
            record["error"] = repr(exc)
    results.append(record)

print(json.dumps({"files": results}, ensure_ascii=False))
`;

const PYTHON_CANDIDATES = [
  process.env.KB_DOCTOR_PYTHON,
  path.join(ROOT, '.venv', 'bin', 'python'),
  'python3',
].filter(Boolean);

const runProbe = (python, args) =>
  spawnSync(python, ['-c', PYTHON_PROBE, SCRIPTS_DIR, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

/** Resolve an interpreter that can import kb_parsers, or null. */
const findPython = () => {
  for (const python of PYTHON_CANDIDATES) {
    const proc = runProbe(python, ['extensions']);
    if (proc.status === 0 && proc.stdout) {
      try {
        return { python, extensions: JSON.parse(proc.stdout).extensions };
      } catch {
        /* fall through to the next candidate */
      }
    }
  }
  return null;
};

/**
 * Last-resort extension list, used only when no interpreter can import
 * kb_parsers. Reported as a mirror in the output rather than passed off
 * as authoritative, because a stale mirror would silently reclassify
 * real files as "no parser claims this".
 */
const MIRRORED_EXTENSIONS = [
  '.bmp', '.docx', '.htm', '.html', '.jpeg', '.jpg', '.markdown',
  '.md', '.pdf', '.png', '.pptx', '.tif', '.tiff', '.webp',
];

// --------------------------------------------------------------- disk walk

const walk = (dir, acc = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // Same skips as `_gather_files`: dot-files never ingest, and
    // __MACOSX is zip debris.
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
};

// ------------------------------------------------------------------- report

const findings = [];
const addFinding = (line) => findings.push(line);

const heading = (text) => `\n${text}\n${'-'.repeat(Math.min(text.length, 72))}`;
const truncate = (text, width) =>
  text.length <= width ? text : `…${text.slice(text.length - width + 1)}`;
const num = (value, width) => String(value).padStart(width);
/** Repo-relative when that is shorter to read, absolute otherwise — a
 *  corpus outside the repo would otherwise print as a wall of `../`. */
const displayPath = (target) => {
  const rel = path.relative(ROOT, target);
  return !rel ? '.' : rel.startsWith('..') ? target : rel;
};

// ------------------------------------------------------------------- thresholds

/**
 * When is an ingested file "far below" its extractable text?
 *
 * Not a clean equality even when everything works, because three
 * legitimate things move the number: the ingester prefixes each chunk
 * with its section label, so the DB can hold *more* characters than the
 * parser produced; the chunker drops whitespace-only fragments; and
 * `npm run kb:prune --duplicates-only` deletes chunks whose exact text
 * survives under another filename. Requiring both a factor and an
 * absolute gap keeps those three out of the report.
 */
const THIN_FACTOR = 2;
const THIN_ABSOLUTE_CHARS = 2000;

/** A file that produced almost nothing is worth re-parsing whatever its
 *  size — this is the floor below which we always look. */
const NEARLY_EMPTY_CHARS = 800;

/** …and this is how far off its own format's median a file has to sit
 *  (bytes on disk per ingested character) before we look. Per-format
 *  because the medians differ by an order of magnitude: .docx sits near
 *  7 bytes/char while an image-heavy PDF of a WeChat article legitimately
 *  sits in the hundreds. */
const THIN_RATIO_FACTOR = 8;

// ------------------------------------------------------------------- main

const main = async () => {
  const rawRoot = path.resolve(OPTIONS.source);
  if (!fs.existsSync(rawRoot)) {
    console.error(`corpus root does not exist: ${rawRoot}`);
    process.exit(2);
  }
  const root = resolveEffectiveRoot(rawRoot);

  const py = findPython();
  const extensions = new Set(py ? py.extensions : MIRRORED_EXTENSIONS);

  console.log('kb-doctor');
  console.log(`  corpus root : ${displayPath(rawRoot)}`);
  if (root !== rawRoot) {
    console.log(`  effective   : ${displayPath(root)}  (stripped single-dir wrapper)`);
  }
  if (py) {
    console.log(`  parsers     : ${py.python} (${extensions.size} extensions)`);
  } else {
    console.log(
      '  parsers     : !! no interpreter could import kb_parsers; using a ' +
        'hardcoded extension mirror and skipping re-parse',
    );
  }

  // ---- disk half -----------------------------------------------------
  const onDisk = new Map(); // sourceKey -> { bytes }
  const unsupported = [];
  for (const abs of walk(root)) {
    const key = sourceKey(abs, root);
    const ext = path.extname(abs).toLowerCase();
    const bytes = fs.statSync(abs).size;
    if (extensions.has(ext)) onDisk.set(key, { bytes, ext });
    else unsupported.push({ key, ext, bytes });
  }
  console.log(`  on disk     : ${onDisk.size} ingestable files, ${unsupported.length} not`);

  // ---- index half ----------------------------------------------------
  const databaseUrl = (
    process.env.KB_SERVICE_DATABASE_URL ?? process.env.DATABASE_URL ?? ''
  ).replace('host.docker.internal', 'localhost');

  let client = null;
  let dbError = null;
  if (databaseUrl) {
    try {
      const { Client } = require('pg');
      client = new Client({ connectionString: databaseUrl });
      await client.connect();
    } catch (error) {
      dbError = error.message;
      client = null;
    }
  } else {
    dbError = 'neither KB_SERVICE_DATABASE_URL nor DATABASE_URL is set';
  }

  const report = {
    corpusRoot: displayPath(root),
    filesOnDisk: onDisk.size,
    indexChecked: Boolean(client),
    dbError,
  };

  if (!client) {
    console.log(`  index       : NOT CHECKED — ${dbError}`);
  }

  const inIndex = new Map(); // sourceKey -> { chunks, chars, zh, en, other, categories }
  if (client) {
    const { rows } = await client.query(
      `SELECT source_file,
              count(*)::int AS chunks,
              sum(length(content))::int AS chars,
              count(*) FILTER (WHERE metadata->>'language' = 'zh')::int AS zh,
              count(*) FILTER (WHERE metadata->>'language' = 'en')::int AS en,
              array_agg(DISTINCT coalesce(metadata->>'category', '')) AS categories
         FROM kb_chunks
        GROUP BY source_file`,
    );
    for (const row of rows) {
      inIndex.set(String(row.source_file).normalize('NFC'), {
        chunks: row.chunks,
        chars: row.chars ?? 0,
        zh: row.zh,
        en: row.en,
        other: row.chunks - row.zh - row.en,
        categories: row.categories ?? [],
      });
    }
    const total = [...inIndex.values()].reduce((a, b) => a + b.chunks, 0);
    console.log(`  index       : ${inIndex.size} source files, ${total} chunks`);
    report.filesInIndex = inIndex.size;
    report.chunksInIndex = total;
  }

  // ---- A. on disk, absent from the index ------------------------------
  const missing = client ? [...onDisk.keys()].filter((k) => !inIndex.has(k)) : [];

  // ---- B. in the index, gone from disk --------------------------------
  const orphans = client ? [...inIndex.keys()].filter((k) => !onDisk.has(k)) : [];

  // ---- pick what to re-parse ------------------------------------------
  /**
   * Only files this report is about to accuse. Re-parsing the whole
   * corpus means pdfminer over every paper in it (184 here, ~2 minutes)
   * plus a tesseract pass over every image, on every run — too much for
   * something meant to be run casually. The accused set is small and
   * bounded, and every file in it is one whose number the report would
   * otherwise be stating without having checked.
   */
  const chooseExtractionCandidates = () => {
    if (!client || !OPTIONS.extract || !py) return { files: [], skipped: 0 };

    // Per-extension median bytes-per-ingested-character, so "thin" is
    // judged against files of the same format rather than a global
    // number that .docx and scanned .pdf could never share.
    const ratiosByExt = new Map();
    for (const [key, disk] of onDisk) {
      const row = inIndex.get(key);
      if (!row || row.chars <= 0) continue;
      const list = ratiosByExt.get(disk.ext) ?? [];
      list.push(disk.bytes / row.chars);
      ratiosByExt.set(disk.ext, list);
    }
    const medianByExt = new Map();
    for (const [ext, list] of ratiosByExt) {
      list.sort((a, b) => a - b);
      medianByExt.set(ext, list[Math.floor(list.length / 2)]);
    }

    const suspicious = [];
    for (const [key, disk] of onDisk) {
      const row = inIndex.get(key);
      if (!row) continue;
      if (row.chars < NEARLY_EMPTY_CHARS) {
        suspicious.push(key);
        continue;
      }
      const median = medianByExt.get(disk.ext);
      if (median && disk.bytes / row.chars > median * THIN_RATIO_FACTOR) {
        suspicious.push(key);
      }
    }

    // Missing files first: an absent file is the stronger accusation, so
    // it should not be the thing the cap drops.
    const ordered = [...missing, ...suspicious];
    return {
      files: ordered.slice(0, OPTIONS.maxExtract),
      skipped: Math.max(0, ordered.length - OPTIONS.maxExtract),
    };
  };

  const { files: toExtract, skipped: extractionSkipped } = chooseExtractionCandidates();
  const extracted = new Map(); // sourceKey -> probe record

  if (toExtract.length) {
    console.log(
      `  re-parsing  : ${toExtract.length} accused files` +
        (extractionSkipped ? ` (${extractionSkipped} over --max-extract)` : ''),
    );
    const payloadPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'kb-doctor-')),
      'payload.json',
    );
    fs.writeFileSync(
      payloadPath,
      JSON.stringify({ root, files: toExtract }),
      'utf8',
    );
    const proc = runProbe(py.python, ['parse', payloadPath]);
    fs.rmSync(path.dirname(payloadPath), { recursive: true, force: true });
    if (proc.status !== 0 || !proc.stdout) {
      console.error(
        '  !! re-parse failed; the thin-extraction and lost-file checks ' +
          'below are unresolved:\n' +
          (proc.stderr || '').trim().split('\n').slice(-8).join('\n'),
      );
      addFinding('re-parse of the accused files did not complete');
    } else {
      for (const record of JSON.parse(proc.stdout).files) {
        extracted.set(record.rel.normalize('NFC'), record);
      }
    }
  }

  // Corpus text, for deciding whether text absent from a file's own rows
  // survives under a different filename. `npm run kb:prune` deletes
  // chunks whose exact text exists under another source, so both「file
  // has no rows」and「file has far fewer characters than it extracts」
  // have a benign explanation and a serious one. Separating them is the
  // whole value of these two checks.
  let corpusFlat = null;
  const ownFlat = new Map();
  if (client && extracted.size) {
    const { rows } = await client.query('SELECT source_file, content FROM kb_chunks');
    const flat = (text) => (text ?? '').replace(/\s+/g, ' ').trim();
    corpusFlat = rows.map((r) => flat(r.content)).join('\n');
    for (const row of rows) {
      const key = String(row.source_file).normalize('NFC');
      if (!extracted.has(key)) continue;
      ownFlat.set(key, (ownFlat.get(key) ?? '') + '\n' + flat(row.content));
    }
  }

  /**
   * Heuristic, and labelled as one everywhere it is printed: sample
   * fixed-width windows of the file's text and see how many appear
   * verbatim somewhere in the index *other than under this file's own
   * source_file*. Without that exclusion a file whose 3% surviving
   * chunks happen to contain a probe would clear itself.
   *
   * Chunk boundaries can cut a window in half, so this is a majority
   * vote and not a proof. It can only ever say「found elsewhere」or
   *「not found」, and both the hit count and the total are printed so a
   * borderline call is visible rather than hidden behind the verdict.
   */
  const survivesElsewhere = (key, record) => {
    if (!corpusFlat || !record?.probes?.length) return null;
    const own = ownFlat.get(key) ?? '';
    const hits = record.probes.filter(
      (p) => corpusFlat.includes(p) && !own.includes(p),
    ).length;
    return { hits, total: record.probes.length, likely: hits * 2 > record.probes.length };
  };

  // ---- print ----------------------------------------------------------

  if (client) {
    console.log(heading('A. on disk, absent from the index'));
    if (!missing.length) {
      console.log('  none');
    } else {
      const lost = [];
      const deduped = [];
      const empty = [];
      const unresolved = [];
      for (const key of missing) {
        const record = extracted.get(key);
        const survival = survivesElsewhere(key, record);
        const entry = { key, record, survival };
        if (record?.parse_error || record?.error) lost.push(entry);
        else if (!record) unresolved.push(entry);
        // Parsed cleanly and yielded nothing: a cover-sheet scan or an
        // all-images document. The ingester counts these as `empty`, not
        // as errors, and its behaviour is correct — but the file should
        // not be filed alongside 74,000 characters of catalogue that
        // genuinely went missing.
        else if (!record.chars) empty.push(entry);
        else if (survival?.likely) deduped.push(entry);
        else lost.push(entry);
      }

      // A file that only yields text after a legacy-.doc conversion is
      // worth naming: it says the bytes on disk are not a .docx at all,
      // and that the ingester needs a converter installed wherever it
      // runs or this file goes back to being invisible.
      const via = (record) =>
        record?.converted_via ? ` [via ${record.converted_via} conversion]` : '';

      for (const { key, record, survival } of lost) {
        const why = record?.parse_error
          ? `parse error: ${record.parse_error}`
          : record?.error
            ? `parser raised: ${record.error}`
            : `${record.chars} extractable chars${via(record)}, ` +
              `${survival?.hits ?? 0}/${survival?.total ?? 0} text probes found elsewhere`;
        console.log(`  LOST   ${truncate(key, 66)}\n           ${why}`);
      }
      for (const { key, record, survival } of deduped) {
        console.log(
          `  dedup? ${truncate(key, 66)}\n           ` +
            `${record.chars} chars${via(record)}, ` +
            `${survival.hits}/${survival.total} probes ` +
            'found elsewhere in the index — likely removed by kb:prune',
        );
      }
      for (const { key, record } of empty) {
        console.log(
          `  empty  ${truncate(key, 66)}\n           ` +
            `parses cleanly (${record.parser}) but yields no text — nothing to index`,
        );
      }
      for (const { key } of unresolved) {
        console.log(`  ?      ${truncate(key, 66)}  (not re-parsed)`);
      }

      if (lost.length) {
        addFinding(
          `${lost.length} file(s) on disk are absent from the index and their ` +
            'text was not found under any other source',
        );
      }
      if (unresolved.length) {
        addFinding(
          `${unresolved.length} absent file(s) were not re-parsed, so whether ` +
            'their text is in the index at all is unknown',
        );
      }
      if (deduped.length || empty.length) {
        console.log(
          `\n  (${deduped.length} classified as duplicates, ${empty.length} as ` +
            'text-free — reported, not counted as drift)',
        );
      }
      report.missing = {
        lost: lost.map((e) => e.key),
        deduped: deduped.map((e) => e.key),
        empty: empty.map((e) => e.key),
        unresolved: unresolved.map((e) => e.key),
      };
    }

    console.log(heading('B. in the index, gone from disk'));
    if (!orphans.length) {
      console.log('  none');
    } else {
      for (const key of orphans) {
        console.log(`  ORPHAN ${truncate(key, 66)}  (${inIndex.get(key).chunks} chunks)`);
      }
      addFinding(
        `${orphans.length} source(s) in the index no longer exist on disk; ` +
          'run `npm run kb:ingest -- --prune`',
      );
      report.orphans = orphans;
    }
  }

  console.log(heading('C. on disk in a format no parser claims'));
  if (!unsupported.length) {
    console.log('  none');
  } else {
    for (const { key, ext, bytes } of unsupported) {
      console.log(`  ${(ext || '(no ext)').padEnd(8)} ${num(bytes, 10)}B  ${truncate(key, 55)}`);
    }
    addFinding(
      `${unsupported.length} file(s) on disk are in a format no parser ` +
        'handles; ingest skips them without an error',
    );
    report.unsupported = unsupported;
  }

  if (client) {
    console.log(heading('D. per top-level category'));
    const categories = new Map();
    const bump = (name, field, by = 1) => {
      const entry =
        categories.get(name) ?? { disk: 0, indexed: 0, chunks: 0, zh: 0, en: 0, other: 0 };
      entry[field] += by;
      categories.set(name, entry);
    };
    for (const key of onDisk.keys()) bump(categoryOf(key), 'disk');
    for (const [key, row] of inIndex) {
      const name = categoryOf(key);
      bump(name, 'indexed');
      bump(name, 'chunks', row.chunks);
      bump(name, 'zh', row.zh);
      bump(name, 'en', row.en);
      bump(name, 'other', row.other);
    }
    console.log('   files(disk) files(idx)   chunks     zh     en  other  category');
    for (const [name, e] of [...categories].sort((a, b) => b[1].chunks - a[1].chunks)) {
      console.log(
        `  ${num(e.disk, 10)} ${num(e.indexed, 10)} ${num(e.chunks, 8)} ` +
          `${num(e.zh, 6)} ${num(e.en, 6)} ${num(e.other, 6)}  ${categoryLabel(name)}`,
      );
    }
    report.categories = Object.fromEntries(
      [...categories].map(([name, e]) => [categoryLabel(name), e]),
    );

    console.log(heading('E. indexed far thinner than the file extracts'));
    const thinLost = [];
    const thinDeduped = [];
    for (const [key, record] of extracted) {
      const row = inIndex.get(key);
      if (!row || record.chars == null) continue;
      const gap = record.chars - row.chars;
      if (record.chars <= row.chars * THIN_FACTOR || gap < THIN_ABSOLUTE_CHARS) continue;
      // Same fork as check A. A file can be 97% thinner than it extracts
      // because its text lives under another filename and kb:prune
      // deleted the copy — which is the tool working, not drift. Saying
      //「holds far less text than it extracts」without checking that
      // would be an accusation this script never verified.
      const survival = survivesElsewhere(key, record);
      const entry = {
        key,
        indexed: row.chars,
        extractable: record.chars,
        gap,
        survival,
      };
      if (survival?.likely) thinDeduped.push(entry);
      else thinLost.push(entry);
    }

    const describeThin = (t) =>
      `  ${num(t.indexed, 8)} indexed vs ${num(t.extractable, 8)} extractable  ` +
      truncate(t.key, 48);

    if (!thinLost.length && !thinDeduped.length) {
      const checked = [...extracted.keys()].filter((k) => inIndex.has(k)).length;
      console.log(
        checked
          ? `  none (${checked} suspicious file(s) re-parsed and cleared)`
          : '  no indexed file looked thin enough to re-parse',
      );
    }
    for (const t of thinLost.sort((a, b) => b.gap - a.gap)) {
      console.log(
        `${describeThin(t)}\n           ` +
          `${t.survival?.hits ?? 0}/${t.survival?.total ?? 0} probes of the ` +
          'missing text found elsewhere — LOST',
      );
    }
    for (const t of thinDeduped.sort((a, b) => b.gap - a.gap)) {
      console.log(
        `${describeThin(t)}\n           ` +
          `${t.survival.hits}/${t.survival.total} probes found under another ` +
          'source — deduplicated, not lost',
      );
    }
    if (thinLost.length) {
      addFinding(
        `${thinLost.length} indexed file(s) hold far less text than they ` +
          'extract, and the missing text was not found elsewhere',
      );
    }
    report.thin = { lost: thinLost, deduped: thinDeduped };

    console.log(heading('F. stored category vs the category its path implies'));
    const mismatched = [];
    for (const [key, row] of inIndex) {
      const derived = categoryOf(key);
      const stored = row.categories.filter((c) => c !== derived);
      if (stored.length) mismatched.push({ key, derived, stored });
    }
    if (!mismatched.length) {
      console.log('  none');
    } else {
      for (const m of mismatched) {
        console.log(
          `  ${truncate(m.key, 54)}\n           stored ${JSON.stringify(m.stored)} ` +
            `vs derived ${JSON.stringify(m.derived)}`,
        );
      }
      addFinding(
        `${mismatched.length} source(s) carry a category that disagrees with ` +
          'their path — usually a scoped `--source` run; re-ingest from the corpus root',
      );
      report.categoryMismatch = mismatched;
    }
  }

  // ---- verdict --------------------------------------------------------

  console.log(heading('verdict'));
  const caveats = [];
  if (!client) {
    caveats.push('the index was not checked at all (no database reachable)');
  }
  if (!py) {
    caveats.push('no Python interpreter could import kb_parsers, so nothing was re-parsed');
  } else if (!OPTIONS.extract) {
    caveats.push('--no-extract: nothing was re-parsed, so A and E are unresolved');
  }
  if (extractionSkipped) {
    caveats.push(`${extractionSkipped} accused file(s) exceeded --max-extract and were not re-parsed`);
  }
  for (const caveat of caveats) console.log(`  note: ${caveat}`);

  if (!findings.length) {
    console.log(
      caveats.length
        ? '  no drift found in what was checked'
        : '  no drift found',
    );
  } else {
    for (const finding of findings) console.log(`  DRIFT: ${finding}`);
  }

  report.findings = findings;
  report.caveats = caveats;
  if (OPTIONS.json) {
    fs.writeFileSync(OPTIONS.json, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n  wrote ${OPTIONS.json}`);
  }

  if (client) await client.end();
  return findings.length ? 1 : 0;
};

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error);
    process.exit(2);
  });
