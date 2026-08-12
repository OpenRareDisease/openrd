import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The golden export fixtures must be invisible to Prettier from BOTH working
 * directories this repo runs it from, and this file is the thing that notices
 * when only one of them is covered.
 *
 * The two invocations:
 *
 *   repo root   .husky/pre-commit -> npx lint-staged, whose second entry runs
 *               `prettier --write` over every staged ts/tsx/js/jsx/json/md/
 *               yml/yaml file. CWD is the repo root.
 *   apps/api    `npm run format` / `npm run format:write`. npm runs a
 *               workspace script inside the workspace, and CI's api job also
 *               declares `defaults.run.working-directory: apps/api`
 *               (.github/workflows/ci.yml), so its Format step lands here too.
 *
 * Prettier 3 resolves .prettierignore against its CWD and does not walk up, so
 * one file at the root covered the hook and left the CI step red: `cd apps/api
 * && npm run format` listed golden.treat-nmd.json and
 * golden.treat-nmd.local-only.json and exited 1. Hence two ignore files, and
 * hence this test, which drives the real binary rather than reading the lists.
 *
 * Formatting the fixtures is wrong rather than merely noisy: golden.test.ts
 * renders with JSON.stringify(x, null, 2) and compares byte-for-byte, and
 * printWidth:100 collapses `["手杖", "踝足矫形器"]` onto one line, which
 * JSON.stringify cannot emit. Measured: `prettier --write` over the four
 * fixtures rewrites golden.treat-nmd.json and golden.treat-nmd.local-only.json
 * (the other two are untouched today) and takes golden.test.ts from 4 passed to
 * 2 failed | 2 passed.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(API_DIR, '../..');
const PRETTIER = path.join(REPO_ROOT, 'node_modules', 'prettier', 'bin', 'prettier.cjs');

const FIXTURE_GLOB_FROM_API = 'src/modules/patient-profile/export/__fixtures__/golden.*.json';
const FIXTURE_GLOB_FROM_ROOT = `apps/api/${FIXTURE_GLOB_FROM_API}`;

function prettier(args: string[], cwd: string) {
  const run = spawnSync(process.execPath, [PRETTIER, ...args], {
    cwd,
    encoding: 'utf8',
  });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

describe('golden fixtures are ignored by prettier from every directory it runs in', () => {
  it('the fixtures really would be reformatted, so the ignore is load-bearing', () => {
    // With ignore resolution disabled, prettier must still object to these two
    // files. If it ever stops objecting, the guards below become vacuous and
    // would keep passing after someone deletes both ignore files.
    const { status, out } = prettier(
      [
        FIXTURE_GLOB_FROM_API,
        '--check',
        '--ignore-path',
        path.join(API_DIR, 'no-such-ignore-file'),
      ],
      API_DIR,
    );
    expect(status).toBe(1);
    expect(out).toContain('golden.treat-nmd.json');
    expect(out).toContain('golden.treat-nmd.local-only.json');
  });

  it('the fixtures survive the CI glob run from the api workspace', () => {
    // The exact glob in apps/api/package.json's `format` script, from the
    // exact directory CI's api job runs it in — so the fixtures are matched
    // by the glob and then dropped by apps/api/.prettierignore, which is the
    // step that was missing.
    //
    // Deliberately NOT asserting exit 0. The whole tree being formatted is
    // CI's Format step's own claim; asserting it here as well would turn any
    // unformatted source file anywhere in apps/api into a failure of the
    // golden-fixture guard, which reports the wrong defect to the wrong
    // person. What this file owns is the ignore lists, and the ignore lists
    // are exactly what `not.toContain('golden.')` measures.
    const { out } = prettier(['src/**/*.{ts,tsx,js,json}', '--check'], API_DIR);
    expect(out, out).not.toContain('golden.');
  });

  it('the fixtures are clean from the repo root — the pre-commit hook', () => {
    // lint-staged hands prettier absolute paths from the root; the glob here
    // stands in for the files the hook would pass. Covered by /.prettierignore.
    const { status, out } = prettier([FIXTURE_GLOB_FROM_ROOT, '--check'], REPO_ROOT);
    expect(out, out).not.toContain('golden.');
    expect(status, out).toBe(0);
  });

  it('both ignore files exist and name the fixture directory', () => {
    // The two runs above would also pass if someone reformatted the fixtures
    // instead of ignoring them. This pins the intended mechanism, and fails
    // loudly if one of the pair is deleted while the other is kept.
    for (const ignoreFile of [
      path.join(REPO_ROOT, '.prettierignore'),
      path.join(API_DIR, '.prettierignore'),
    ]) {
      expect(existsSync(ignoreFile), ignoreFile).toBe(true);
      expect(readFileSync(ignoreFile, 'utf8'), ignoreFile).toContain(
        'src/modules/patient-profile/export/__fixtures__/golden.*.json',
      );
    }
  });
});
