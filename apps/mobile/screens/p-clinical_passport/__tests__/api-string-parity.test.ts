/**
 * The strings this screen matches on, against the strings the API
 * writes: the hero metric labels, and the diagnosis evidence grade.
 *
 * WHY THIS FILE EXISTS
 *
 * `PassportMetricDTO` is `{ label: string; value: string; hint: string }`
 * and nothing more. There is no key, no discriminant, no union — so the
 * only way this screen can single out one tile is to match the Chinese
 * label the server wrote, and both sides of that match are `string`.
 * tsc sees nothing. eslint sees nothing. The label is prose, and prose
 * gets edited.
 *
 * It was edited. The server renamed 肌力组数 to 肌力项数 once the number
 * became a count of measured (muscle group, side) pairs rather than of
 * muscle groups. The screen kept filtering by 肌力组数, so:
 *
 *   - the tile the screen deliberately suppresses rendered again, and
 *   - `splice(2, 0, …)`, written for the three-element array that
 *     filter used to leave, inserted 最近记录 into the middle of a
 *     four-element one. Rendered order became
 *     完整度 / 报告数 / 最近记录 / 肌力项数 / 最近更新.
 *
 * Nothing failed. Nothing warned. A patient exporting the passport for
 * a clinic visit got a hero grid the screen had not been asked to draw
 * for two commits.
 *
 * WHY IT READS THE SOURCE INSTEAD OF IMPORTING IT
 *
 * The same reason genetic-evidence-grade-parity.test.ts and
 * admin-filled-fields-parity.test.ts do: this package cannot resolve
 * the API package's ESM-extension specifiers, and this is a check on
 * two lists of strings rather than on behaviour.
 *
 * WHAT IT DOES NOT CHECK
 *
 * `value` and `hint`. Nothing in this app branches on those, and the
 * day something does, it belongs in this file too.
 */

import fs from 'fs';
import path from 'path';

// The screen reaches AsyncStorage through lib/api → lib/session-storage,
// which has no native module under jest. The same stub the other parity
// tests use; nothing here calls it.
jest.mock('../../../lib/session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

import { PASSPORT_METRIC_LABELS } from '../index';

const API_SOURCE = path.resolve(
  __dirname,
  '../../../../api/src/modules/patient-profile/profile.passport.ts',
);

/** The opening of the metrics array literal inside the object
 *  `buildClinicalPassportSummary` returns. */
const OPENING = '\n    metrics: [\n';
const CLOSING = '\n    ],\n';

/**
 * Every `label:` in that literal, in the order the server writes them.
 *
 * Throws rather than returning nothing. A restructure on the server
 * side must fail this file loudly — a parser that quietly finds zero
 * labels would "pass" forever while checking nothing, which is the
 * exact failure mode this file was written to end.
 */
const serverMetricLabels = (): string[] => {
  const source = fs.readFileSync(API_SOURCE, 'utf8');
  const start = source.indexOf(OPENING);
  if (start < 0) {
    throw new Error(
      `The metrics array literal is gone from ${API_SOURCE} — this test's parser, not the app, is what broke. Re-point it at wherever buildClinicalPassportSummary builds \`metrics\` now.`,
    );
  }
  const end = source.indexOf(CLOSING, start);
  if (end < 0) {
    throw new Error(`The metrics array literal in ${API_SOURCE} is not closed where expected.`);
  }
  const block = source.slice(start + OPENING.length, end);
  // `label:` at the property's own indentation, so a label named inside
  // one of the explanatory comments in that block is not collected. The
  // block has one today, and it names the OLD spelling.
  const labels = [...block.matchAll(/^ {8}label: '([^']+)',$/gm)].map((match) => match[1]);
  if (labels.length === 0) {
    throw new Error(
      `Found the metrics literal in ${API_SOURCE} but no \`label:\` lines in it — this test's parser is what broke.`,
    );
  }
  return labels;
};

describe('hero 指标标签：和服务端拼的是同一串字', () => {
  it('这个屏幕认识的标签，就是服务端发的那几个，顺序也一样', () => {
    // Order matters and is asserted: the insert of 最近记录 anchors to
    // 报告数, and the suppression of 肌力项数 is what decides how many
    // tiles the grid has.
    expect(serverMetricLabels()).toEqual([
      PASSPORT_METRIC_LABELS.completion,
      PASSPORT_METRIC_LABELS.documentCount,
      PASSPORT_METRIC_LABELS.strengthItemCount,
      PASSPORT_METRIC_LABELS.latestUpdate,
    ]);
  });

  it('服务端没有再发那个旧拼法 —— 一个匹配不上任何东西的过滤器是死代码', () => {
    // The specific string this screen was still filtering by after the
    // rename. Kept as a literal on purpose: if it ever comes back, the
    // two spellings are live at once and somebody has to decide which
    // one the filter means.
    expect(serverMetricLabels()).not.toContain('肌力组数');
  });

  it('服务端不发一个叫「最近记录」的指标 —— 那一格是这个屏幕自己插的', () => {
    // If the server ever adds one, the grid would show two 最近记录
    // tiles with the same React key, and `heroMetrics` would be
    // inserting a tile the wire already answered.
    expect(serverMetricLabels()).not.toContain('最近记录');
  });
});

/**
 * The other string join on this screen that decides a clinical sentence.
 *
 * `diagnosis.confirmation` is a union on both sides, so the compiler
 * looks satisfied — but the mobile copy is declared by hand in
 * lib/api.ts and filled by `apiRequest<T>`, an unchecked assertion. A
 * member added on the server reaches a bundle whose union has never
 * heard of it, and this screen's notice is written as
 * 「genetic → nothing, genetic_non_permissive → 4qB sentence, everything
 * else → 未经基因确诊」. So an unrecognised member is not an unstyled
 * chip: it prints「这份护照里没有从基因报告里读出来的、可作确诊依据的基因
 * 结果」on a page the patient hands to a clinician.
 *
 * That is not hypothetical here. `genetic_non_permissive` was added for
 * exactly this reason — a report WAS read, and the sentence denying one
 * was false of it — and it needed a branch of its own to stop saying so.
 * The next member added will land in the same else.
 *
 * This does not fix that; the notice would have to grow a real
 * fall-through, and doing that needs the server's copy for the new
 * state. It fails when the two lists diverge, which is the moment
 * somebody has to decide.
 */
const CONFIRMATION_DECLARATION = 'export type PassportDiagnosisConfirmation =';

const serverConfirmations = (): string[] => {
  const source = fs.readFileSync(API_SOURCE, 'utf8');
  const start = source.indexOf(CONFIRMATION_DECLARATION);
  if (start < 0) {
    throw new Error(
      `${CONFIRMATION_DECLARATION} is gone from ${API_SOURCE} — this test's parser, not the app, is what broke.`,
    );
  }
  const end = source.indexOf(';', start);
  const members = [
    ...source.slice(start + CONFIRMATION_DECLARATION.length, end).matchAll(/'([a-z_]+)'/g),
  ].map((match) => match[1]);
  if (members.length === 0) {
    throw new Error(`Found ${CONFIRMATION_DECLARATION} but no members — the parser is what broke.`);
  }
  return members;
};

describe('诊断证据等级：这个屏幕认得服务端的每一种取值', () => {
  it('两边的成员一字不差，顺序也一样', () => {
    // The mobile copy, spelled out rather than derived: a test that
    // read the same union it is checking would agree with itself.
    expect(serverConfirmations()).toEqual([
      'genetic',
      'genetic_non_permissive',
      'self_reported',
      'admin_entered',
      'none',
    ]);
  });
});
