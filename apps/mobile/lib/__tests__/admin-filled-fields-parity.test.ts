import fs from 'fs';
import path from 'path';
import { ADMIN_FILLED_BASELINE_FIELDS } from '../legal-updates';

/**
 * ADMIN_FILLED_BASELINE_FIELDS against the allowlist that is enforced.
 *
 * WHY THIS FILE EXISTS
 *
 * The list in lib/legal-updates.ts is what four pieces of patient-facing
 * copy are built out of: the re-consent screen's 「这一版改了什么」, the
 * same summary for the guardian rules, 隐私政策 §10（四）and 儿童规则 §4.
 * All four make the same promise in the patient's own words — an
 * administrator may fill in THESE fields, everything else about your
 * body is yours. What actually decides that is
 * `ADMIN_WRITABLE_BASELINE_FIELDS` in
 * apps/api/src/modules/patient-profile/baseline-provenance.ts, which
 * `applyAdminBaselineWrite` answers 400 against.
 *
 * A path in one and not the other is not a formatting slip. In one
 * direction the policy promises a back office may write a field the
 * server refuses, and an administrator on the phone with a patient
 * finds out by being rejected. In the other, a field an administrator
 * can really write is missing from the paragraph a patient re-consented
 * to — the disclosure that made the re-consent honest is then
 * incomplete, and nothing on any screen would say so.
 *
 * WHY IT READS THE SOURCE INSTEAD OF IMPORTING IT
 *
 * baseline-provenance.ts imports '../../utils/app-error.js', an
 * ESM-extension specifier this package's jest cannot resolve: the
 * import fails with 「Cannot find module '../../utils/app-error.js'」
 * before a single assertion runs. This test is about two lists of
 * strings, not about behaviour, so it reads them.
 * screens/p-referral/__tests__/question-sheet-parity.test.ts holds the
 * referral questions to the server's copy the same way and for the same
 * reason.
 */

const API_SOURCE = path.resolve(
  __dirname,
  '../../../api/src/modules/patient-profile/baseline-provenance.ts',
);

const apiSource = (): string => fs.readFileSync(API_SOURCE, 'utf8');

/** The block a named `export const` opens, up to its closing bracket.
 *  Throws rather than returning nothing: a rename on the server side
 *  must fail this file loudly, not quietly stop checking anything. */
const declarationBlock = (source: string, declaration: string, close: string): string => {
  const start = source.indexOf(declaration);
  if (start < 0) {
    throw new Error(
      `${declaration} is gone from ${API_SOURCE} — this test's parser, not the app, is what broke.`,
    );
  }
  const end = source.indexOf(close, start);
  if (end < 0) throw new Error(`${declaration} in ${API_SOURCE} has no ${close.trim()}`);
  return source.slice(start + declaration.length, end);
};

/** The leaf paths the server admits, in the order it declares them. */
const serverWritablePaths = (): string[] => {
  const block = declarationBlock(apiSource(), 'export const ADMIN_WRITABLE_BASELINE_FIELDS', '\n]');
  const paths = [...block.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  if (paths.length === 0) throw new Error(`read no paths out of the allowlist in ${API_SOURCE}`);
  return paths;
};

/** path → the Chinese name the server keeps for it. */
const serverLabels = (): Map<string, string> => {
  const block = declarationBlock(apiSource(), 'export const BASELINE_FIELD_LABELS_ZH', '\n}');
  const labels = new Map<string, string>();
  // A dotted path has to be quoted; `notes` is a bare identifier and is
  // written as one. Both are keys of the same map.
  for (const match of block.matchAll(/(?:'([^']+)'|([A-Za-z_$][\w$]*))\s*:\s*'([^']+)'/g)) {
    labels.set(match[1] ?? match[2], match[3]);
  }
  if (labels.size === 0) throw new Error(`read no labels out of ${API_SOURCE}`);
  return labels;
};

describe('文案说的那份名单，就是服务端拒绝时用的那一份', () => {
  it('两边收的是同一批字段路径', () => {
    expect(ADMIN_FILLED_BASELINE_FIELDS.map((field) => field.path).sort()).toEqual(
      serverWritablePaths().sort(),
    );
  });

  it('文案给每个字段的名字，就是服务端给它的名字', () => {
    // The server keeps its own naming table for these paths, and a
    // patient who reads the enumeration goes looking for that name in
    // the app. A second spelling, invented in the document that is
    // supposed to be the answer, makes one field look like two.
    const labels = serverLabels();
    for (const field of ADMIN_FILLED_BASELINE_FIELDS) {
      expect({ [field.path]: field.label }).toEqual({ [field.path]: labels.get(field.path) });
    }
  });
});
