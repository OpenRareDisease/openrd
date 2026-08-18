/**
 * humanize.ts against the two lists it claims to mirror.
 *
 * WHY THIS FILE EXISTS
 *
 * `humanize.ts` translates the answer metadata's engineering vocabulary
 * into what the rest of the app says, and its fallbacks are deliberately
 * loud-in-theory: an unmapped field key is printed to the patient
 * verbatim, an unmapped tool id renders as its raw id. The docblock
 * calls that a to-do that shows up in the UI. It does not show up
 * anywhere a maintainer looks — nothing throws, no test failed, and the
 * screen renders.
 *
 * So it drifted. The backend allowlist grew a whole third scope,
 * `followups` — thirteen keys, everything `get_my_records` contributes
 * — and this screen had a label for none of them, which put the
 * patient's own 随访记录 on screen as 「其他数据（metricKey、metricLabel、
 * count、countAtCap…）」. `uploadYear` shipped on the reports side in the
 * same state while its sibling `reportDate_year` had a label.
 * `get_my_records` and `list_clinical_trials` are both registered on the
 * live route and both printed their raw ids in the tool chips.
 *
 * WHAT IT PINS
 *
 * Three things, all of them about the boundary rather than the wording:
 *   1. every key on PROMPT_ALLOWLIST resolves to a label;
 *   2. every key lands in the group its scope names, so no scope can be
 *      swallowed by 其他数据 again;
 *   3. every tool the live route registers resolves to a label.
 *
 * The labels themselves are not asserted here — humanize.test.ts owns
 * those. This file only fails when the mobile side falls behind the API.
 *
 * WHY IT READS THE SOURCE INSTEAD OF IMPORTING IT
 *
 * Same reason genetic-evidence-grade-parity.test.ts and
 * admin-filled-fields-parity.test.ts do: this package cannot resolve the
 * API package's ESM-extension specifiers, and this is a check on lists
 * of strings rather than on behaviour. Every parser below throws rather
 * than returning nothing — a rename on the server side has to fail this
 * file loudly, not quietly stop checking anything.
 */

import fs from 'fs';
import path from 'path';

import { buildCitationSummary, humanizeFieldKeys, humanizeToolName } from '../humanize';

const API_SRC = path.resolve(__dirname, '../../../../api/src');
const ALLOWLIST_SOURCE = path.join(API_SRC, 'modules/ai-agents/security/allowlist.ts');
const ROUTE_SOURCE = path.join(API_SRC, 'routes/ai-chat.routes.ts');
const TOOLS_DIR = path.join(API_SRC, 'modules/ai-agents/tools');

/** Comments carry quoted key names in prose (「listing `ageGroup` was
 *  enough to put an age band into a sentence」), so they come out before
 *  anything is read as a member. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const quoted = (block: string): string[] => [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);

/**
 * PROMPT_ALLOWLIST as `{ scope: keys }`, both modes merged — this
 * screen renders whatever arrives and does not branch on the mode, so
 * a key reachable in either mode needs a label.
 */
const serverAllowlist = (): Record<string, string[]> => {
  const source = fs.readFileSync(ALLOWLIST_SOURCE, 'utf8');
  const start = source.indexOf('export const PROMPT_ALLOWLIST');
  if (start < 0) {
    throw new Error(
      `PROMPT_ALLOWLIST is gone from ${ALLOWLIST_SOURCE} — this test's parser, not the app, is what broke.`,
    );
  }
  const body = stripComments(source.slice(start));
  const scopes: Record<string, string[]> = {};
  // Each scope is `name: { strict: [...], precise: [...] }`, and no key
  // contains a bracket, so the arrays are matched non-greedily on `]`.
  const pattern = /(\w+):\s*\{\s*strict:\s*\[([^\]]*)\]\s*,\s*precise:\s*\[([^\]]*)\]\s*,?\s*\}/g;
  for (const match of body.matchAll(pattern)) {
    scopes[match[1]] = [...new Set([...quoted(match[2]), ...quoted(match[3])])];
  }
  const found = Object.keys(scopes).sort();
  // The scope names are half the contract: a fourth scope must fail
  // here rather than be skipped, because a scope with no bucket in
  // humanize.ts is exactly the defect this file was written for.
  if (found.join(',') !== 'followups,profile,reports') {
    throw new Error(
      `read scopes [${found.join(', ')}] out of ${ALLOWLIST_SOURCE}; expected profile, followups, reports. ` +
        'If the API really added or renamed a scope, humanize.ts needs a bucket for it and this list needs updating.',
    );
  }
  for (const [scope, keys] of Object.entries(scopes)) {
    if (keys.length === 0) throw new Error(`read no keys for scope ${scope}`);
  }
  return scopes;
};

/**
 * The tool ids the live route actually registers.
 *
 * Two hops on purpose: the route names classes, and the id a tool call
 * arrives under is the class's own `name`. Reading only one of them
 * would either miss a tool that exists but is not registered, or miss a
 * rename of the id behind a registered class.
 */
const registeredToolIds = (): string[] => {
  const route = stripComments(fs.readFileSync(ROUTE_SOURCE, 'utf8'));
  const chainStart = route.indexOf('new ToolRegistry()');
  if (chainStart < 0) {
    throw new Error(
      `no 「new ToolRegistry()」 in ${ROUTE_SOURCE} — this test's parser, not the app, is what broke.`,
    );
  }
  const chain = route.slice(chainStart, route.indexOf(';', chainStart));
  const classes = [...chain.matchAll(/\.register\(\s*new\s+(\w+)/g)].map((m) => m[1]);
  if (classes.length === 0)
    throw new Error(`read no registered tool classes out of ${ROUTE_SOURCE}`);

  const byClass = new Map<string, string>();
  for (const file of fs.readdirSync(TOOLS_DIR)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const source = stripComments(fs.readFileSync(path.join(TOOLS_DIR, file), 'utf8'));
    for (const match of source.matchAll(
      /export class (\w+)[^{]*\{[\s\S]*?readonly name = '([^']+)'/g,
    )) {
      byClass.set(match[1], match[2]);
    }
  }
  return classes.map((className) => {
    const id = byClass.get(className);
    if (!id) {
      throw new Error(
        `${ROUTE_SOURCE} registers ${className}, but no 「readonly name」 for it was found under ${TOOLS_DIR}.`,
      );
    }
    return id;
  });
};

/** Which group heading a scope's keys must appear under. A scope with
 *  no entry here cannot be checked, which is why `serverAllowlist`
 *  refuses to return an unknown one. */
const GROUP_FOR_SCOPE: Record<string, string> = {
  profile: '健康档案',
  reports: '检查报告',
  followups: '随访记录',
};

const allowlist = serverAllowlist();
const scopedKeys: Array<[string, string]> = Object.entries(allowlist).flatMap(([scope, keys]) =>
  keys.map((key): [string, string] => [scope, key]),
);

describe('字段标签：后端 allowlist 上的每一个 key，这里都得有话可说', () => {
  it('三个 scope 都读到了 key，解析器本身没有静默失效', () => {
    expect(Object.keys(allowlist).sort()).toEqual(['followups', 'profile', 'reports']);
    // The scope that had zero labels. If this number collapses, the
    // parser stopped reading it rather than the API stopped sending it.
    expect(allowlist.followups.length).toBeGreaterThanOrEqual(10);
  });

  it.each(scopedKeys)('%s.%s 有中文标签，不会原样印给患者', (_scope, key) => {
    expect(humanizeFieldKeys([key])).not.toEqual([key]);
  });

  it.each(scopedKeys)('%s.%s 归到它自己那一组，不掉进「其他数据」', (scope, key) => {
    const line = buildCitationSummary({ usedPersonalData: true, fieldsUsed: [key] });
    expect(line).toContain(GROUP_FOR_SCOPE[scope]);
    expect(line).not.toContain('其他数据');
  });

  it('真正认不出来的 key 仍然原样保留，并且归到「其他数据」', () => {
    // The fallback is not what broke; swallowing a whole scope into it
    // was. It has to keep working.
    const line = buildCitationSummary({
      usedPersonalData: true,
      fieldsUsed: ['someKeyTheApiHasNotShippedYet'],
    });
    expect(line).toBe('本次引用了你的：其他数据（someKeyTheApiHasNotShippedYet）');
  });
});

describe('工具标签：线上路由注册的每一个工具，这里都得有名字', () => {
  const ids = registeredToolIds();

  it('读到的就是路由上那五个工具', () => {
    expect(ids).toEqual([
      'search_medical_kb',
      'get_my_profile',
      'get_my_reports',
      'get_my_records',
      'list_clinical_trials',
    ]);
  });

  it.each(ids.map((id) => [id]))('%s 有中文名，不会把工具 id 印到界面上', (id) => {
    expect(humanizeToolName(id)).not.toBe(id);
  });

  it('没见过的工具 id 仍然原样显示，不会消失', () => {
    expect(humanizeToolName('future_tool')).toBe('future_tool');
  });
});
