import fs from 'fs';
import path from 'path';
import { GENETIC_EVIDENCE_GRADES } from '../api';

// api.ts reaches AsyncStorage through session-storage, which has no
// native module under jest. The same stub api-transport.test.ts uses.
jest.mock('../session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

/**
 * GENETIC_EVIDENCE_GRADES against the union the server actually sends.
 *
 * WHY THIS FILE EXISTS
 *
 * `readPassportGeneticEvidence` validates the wire's `grade` against
 * this list and falls anything it does not recognise to 'unknown'. That
 * fall-through is written for a garbage string, and it cannot tell one
 * from a grade the server added while this bundle was not looking — so
 * a member missing from the list is silently renamed to the one grade
 * that promises nothing, with no error anywhere.
 *
 * It had two missing. `transcribed_only` is what the server sends when
 * the reading came off a 病历摘要 rather than the laboratory's report,
 * and `non_permissive_haplotype` is what it sends when the laboratory
 * determined the 4q haplotype and it is 4qB. 未知's own copy opens
 * 「还没有上传过基因报告，或者报告里没有能明确认出检测方法的字样」, which
 * is false of both: each is reached with a reading printed on the same
 * screen. Nothing branches on `grade` today — the screen renders
 * `gradeLabel`, which comes off the wire whole — so nothing was
 * misdrawn, and nothing would have been until somebody wrote
 * `grade === 'trial_ready'` and got a quiet no for a state the server
 * had a real answer for.
 *
 * WHY IT READS THE SOURCE INSTEAD OF IMPORTING IT
 *
 * The same reason admin-filled-fields-parity.test.ts does: this package
 * cannot resolve the API package's ESM-extension specifiers, and this
 * is a check on two lists of strings rather than on behaviour.
 */

const API_SOURCE = path.resolve(
  __dirname,
  '../../../api/src/modules/patient-profile/profile.passport.ts',
);

const DECLARATION = 'export type GeneticEvidenceGrade =';

/** The union's members, in the order the server declares them. Throws
 *  rather than returning nothing: a rename on the server side must fail
 *  this file loudly, not quietly stop checking anything. */
const serverGrades = (): string[] => {
  const source = fs.readFileSync(API_SOURCE, 'utf8');
  const start = source.indexOf(DECLARATION);
  if (start < 0) {
    throw new Error(
      `${DECLARATION} is gone from ${API_SOURCE} — this test's parser, not the app, is what broke.`,
    );
  }
  // Comments come out first: the members carry doc blocks between them,
  // and a quoted symbol inside one is prose rather than a member.
  const declared = source
    .slice(start + DECLARATION.length)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')[0];
  const grades = [...declared.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  if (grades.length === 0) throw new Error(`read no grades out of the union in ${API_SOURCE}`);
  return grades;
};

describe('基因证据分级：手机端认的那几档，就是服务端会发的那几档', () => {
  it('两边是同一批分级', () => {
    expect([...GENETIC_EVIDENCE_GRADES].sort()).toEqual(serverGrades().sort());
  });

  it('兜底落到的那一档，本身是服务端真的会发的一档', () => {
    // `readPassportGeneticEvidence` sends an unrecognised grade to
    // 'unknown'. If that stopped being a member of the server's union,
    // the reader would be minting a grade of its own out of a value the
    // server never sent.
    expect(serverGrades()).toContain('unknown');
  });
});
