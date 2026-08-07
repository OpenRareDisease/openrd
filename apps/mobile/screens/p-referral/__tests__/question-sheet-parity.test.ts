/**
 * The local 我想问的问题 list against the server's.
 *
 * Both copies reach the same patient on the same screen: the server's
 * `REFERRAL_QUESTION_PROMPTS` arrives inside `pack.markdown` above, and
 * this list is the checklist below it. A patient who reads one wording
 * in the document they are about to hand over and then ticks a
 * differently-worded one further down has been given two sheets. The
 * duplication is unavoidable (question-sheet.ts explains why); silent
 * drift is not, and nothing else in the tree would catch it.
 *
 * Reading the API source rather than importing it: `referral-pack.ts`
 * pulls in `profile.service.js` and the rest of the API module graph
 * through ESM-extension specifiers this package's jest cannot resolve,
 * and this assertion is about a list of strings, not about behaviour.
 * (`app/__tests__/route-registry.test.ts` reads `_layout.tsx` the same
 * way and for the same reason.)
 *
 * `hint` and the conditional `confirm-diagnosis` entry are excluded on
 * purpose — see question-sheet.ts for why each difference is real.
 */

import fs from 'fs';
import path from 'path';
import { REFERRAL_QUESTIONS } from '../question-sheet';

const API_SOURCE = path.resolve(
  __dirname,
  '../../../../api/src/modules/patient-profile/referral-pack.ts',
);

/** id → { prompt, source } as the server literally declares them. */
const serverPrompts = (): Map<string, { prompt: string; source: string }> => {
  const source = fs.readFileSync(API_SOURCE, 'utf8');
  const start = source.indexOf('export const REFERRAL_QUESTION_PROMPTS');
  if (start < 0) {
    throw new Error(
      `REFERRAL_QUESTION_PROMPTS is gone from ${API_SOURCE} — this test's parser, not the app, is what broke.`,
    );
  }
  const end = source.indexOf('\n];', start);
  const block = source.slice(start, end);

  const entries = new Map<string, { prompt: string; source: string }>();
  // Entries are object literals whose string values never contain a
  // straight quote, so the field regexes stay this simple.
  for (const chunk of block.split(/\n {2}\{\n/).slice(1)) {
    const id = /\bid: '([^']*)'/.exec(chunk)?.[1];
    const prompt = /\bprompt: '([^']*)'/.exec(chunk)?.[1];
    const src = /\bsource:\s*\n?\s*'([^']*)'/.exec(chunk)?.[1];
    if (!id || !prompt || !src) {
      throw new Error(`could not read an entry out of REFERRAL_QUESTION_PROMPTS:\n${chunk}`);
    }
    entries.set(id, { prompt, source: src });
  }
  return entries;
};

describe('两份问题清单必须对得上', () => {
  const server = serverPrompts();

  it('服务器那份解析出来不是空的', () => {
    expect(server.size).toBeGreaterThan(5);
  });

  it('服务器有的问题，本地一条都不少', () => {
    const local = new Set(REFERRAL_QUESTIONS.map((question) => question.id));
    for (const id of server.keys()) {
      expect(local).toContain(id);
    }
  });

  it('本地多出来的，只有服务器按条件才发的那一条', () => {
    const extra = REFERRAL_QUESTIONS.map((question) => question.id).filter((id) => !server.has(id));
    expect(extra).toEqual(['confirm-diagnosis']);
  });

  it('同一个 id 的提问和出处逐字相同', () => {
    for (const question of REFERRAL_QUESTIONS) {
      const counterpart = server.get(question.id);
      if (!counterpart) continue;
      expect({ id: question.id, prompt: question.prompt, source: question.source }).toEqual({
        id: question.id,
        prompt: counterpart.prompt,
        source: counterpart.source,
      });
    }
  });
});
