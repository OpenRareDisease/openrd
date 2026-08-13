/**
 * The palette table in AuthorityChip's doc block has to be the palette.
 *
 * That block is the only prose in the app describing what a citation
 * grade looks like, and it is what the next author reads before adding a
 * tier. It said「病友经验 carries `warn` rather than the neutral tone the
 * other three share」— a binary palette — while TONES ten lines below it
 * gave 指南/共识 the accent tone. Three tones, four labels, and the one
 * sentence describing the shape got it wrong.
 *
 * A comment ten lines above the map it describes is the pair that
 * drifts, so it is read back out of the source here and compared with
 * the map, in both directions: a row the map contradicts fails, and a
 * label the map carries that the table never mentions fails too.
 */

import fs from 'node:fs';
import path from 'node:path';

import { COLOR } from '../../../lib/design';
import { authorityToneFor } from '../AuthorityChip';

const SOURCE_PATH = path.join(__dirname, '..', 'AuthorityChip.tsx');
const source = fs.readFileSync(SOURCE_PATH, 'utf8');

/** The three tone names the doc block is allowed to use, resolved to
 *  what `authorityToneFor` must return. `neutral` is the file's own
 *  NEUTRAL constant; the other two are the wash pairs from design.ts. */
const TONE_BY_NAME: Record<string, { color: string; backgroundColor: string }> = {
  accent: { color: COLOR.accent, backgroundColor: COLOR.accentWash },
  neutral: { color: COLOR.inkSoft, backgroundColor: COLOR.well },
  warn: { color: COLOR.warn, backgroundColor: COLOR.warnWash },
};

/** The rows of the「label  tone」table inside the doc block. */
const documentedRows = (): Array<[string, string]> => {
  const block =
    /Three tones over the four labels[\s\S]*?\n \*\n([\s\S]*?)\n \*\n/.exec(source)?.[1] ?? '';
  return Array.from(block.matchAll(/^ \*\s{2,}(\S+)\s{2,}(accent|neutral|warn)\s*$/gm)).map(
    (m) => [m[1], m[2]] as [string, string],
  );
};

/** The keys of the TONES map, read out of the same file. Parsed rather
 *  than exported: exporting it for the test would let the map and the
 *  comment agree on a shape neither the screen nor knowledge.py has. */
const mappedLabels = (): string[] => {
  const block = /const TONES: Record<string, AuthorityTone> = \{([\s\S]*?)\n\};/.exec(source)?.[1];
  if (!block) throw new Error('TONES map not found in AuthorityChip.tsx');
  return Array.from(block.matchAll(/^\s{2}'?([^':\s]+)'?:/gm)).map((m) => m[1]);
};

describe('AuthorityChip 的调色说明必须和 TONES 对得上', () => {
  it('doc block 里那张表还在，而且四行都在', () => {
    // Without this the two tests below would pass vacuously on an empty
    // table — which is how a claim gets retired instead of checked.
    expect(documentedRows().map(([label]) => label)).toEqual([
      '指南/共识',
      '文献',
      '资料',
      '病友经验',
    ]);
  });

  it('表里写的每一种色调，就是 authorityToneFor 给的那一种', () => {
    // Compared as two whole maps rather than row by row: jest's diff
    // then names which label disagreed, which a bare per-row assertion
    // inside a loop does not.
    const documented = Object.fromEntries(
      documentedRows().map(([label, toneName]) => [label, TONE_BY_NAME[toneName]]),
    );
    const actual = Object.fromEntries(
      documentedRows().map(([label]) => [label, authorityToneFor(label)]),
    );
    expect(actual).toEqual(documented);
  });

  it('TONES 里的每一个 label 都在表里出现过', () => {
    // The direction the old sentence failed in: the map grew a third
    // tone and the prose still described two.
    expect([...mappedLabels()].sort()).toEqual(
      documentedRows()
        .map(([label]) => label)
        .sort(),
    );
  });

  it('服务端新加的等级仍然落到 neutral —— 表说的就是这四行，不是五行', () => {
    expect(authorityToneFor('注册研究')).toEqual(TONE_BY_NAME.neutral);
  });
});
