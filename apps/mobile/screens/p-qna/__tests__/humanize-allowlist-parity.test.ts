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
 * Five things, all of them about the boundary rather than the wording,
 * and the boundary is checked in BOTH directions:
 *   1. every key on PROMPT_ALLOWLIST resolves to a label;
 *   2. every key lands in the group its scope names, so no scope can be
 *      swallowed by 其他数据 again;
 *   3. every tool the live route registers resolves to a label;
 *   4. every label in humanize.ts names a key the API can actually
 *      send, and every tool label names a registered tool;
 *   5. every labelled key sits in exactly one scope bucket, so the
 *      buckets cannot drift out of step with the label table.
 *
 * 4 AND 5 ARE NEW, AND THE OTHER DIRECTION WAS KEPT BY HAND UNTIL NOW.
 * humanize.ts carries a note that it has no 年龄段 and no 症状类型 label
 * because both are off the API's allowlists — a true claim about
 * somebody else's file, maintained by remembering to. That is the same
 * arrangement that let the whole `followups` scope arrive unlabelled;
 * it just fails the other way round, as a label for a key that can
 * never arrive, read by the next maintainer as evidence the key is
 * still live.
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

import {
  buildCitationSummary,
  humanizeFieldKeys,
  humanizeToolName,
  labelledFieldKeys,
  labelledToolIds,
} from '../humanize';

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
 * THE REPORT-IMPRESSION CHANNEL IS SHIPPED BEHIND A SWITCH, AND THAT
 * MAKES ITS KEYS A THIRD STATE THIS FILE DID NOT HAVE A WORD FOR.
 *
 * Direction 4 asks whether a label names a key the API can send, and it
 * exists because a label for a key that can never arrive reads to the
 * next maintainer as evidence the key is still live. A switched-off
 * channel is the opposite case: the keys are STAGED, not stale. The
 * channel is built, its tests run on every CI run, and the constant is
 * the one thing standing between it and the prompt — so deleting the
 * labels would mean a mobile release is required before the API may
 * flip a boolean, and re-adding them later is exactly the hand-kept
 * arrangement this file was written to end.
 *
 * So direction 4 exempts them WHILE THE SWITCH READS FALSE, and a new
 * assertion below holds the exemption honest: the moment the switch
 * reads true, every staged key must be on the allowlist for real. The
 * exemption can therefore never hide the drift it looks like.
 *
 * Both are read out of the API source, and both throw rather than
 * returning nothing, for the same reason every other parser here does.
 */
const reportImpressionChannelEnabled = (): boolean => {
  const source = fs.readFileSync(ALLOWLIST_SOURCE, 'utf8');
  const match = /REPORT_IMPRESSION_CHANNEL_ENABLED:\s*boolean\s*=\s*(true|false)\b/.exec(source);
  if (!match) {
    throw new Error(
      `REPORT_IMPRESSION_CHANNEL_ENABLED is gone from ${ALLOWLIST_SOURCE} — this test's parser, not the app, is what broke.`,
    );
  }
  return match[1] === 'true';
};

const stagedImpressionKeys = (): string[] => {
  const source = stripComments(fs.readFileSync(ALLOWLIST_SOURCE, 'utf8'));
  const start = source.indexOf('export const REPORT_IMPRESSION_KEYS');
  if (start < 0) {
    throw new Error(
      `REPORT_IMPRESSION_KEYS is gone from ${ALLOWLIST_SOURCE} — this test's parser, not the app, is what broke.`,
    );
  }
  const end = source.indexOf('}', start);
  const keys = quoted(source.slice(start, end));
  if (keys.length === 0) throw new Error('read no keys off REPORT_IMPRESSION_KEYS');
  return keys;
};

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
  // The report-impression keys reach the reports scope through a spread
  // of REPORT_IMPRESSION_ALLOWLIST rather than as quoted literals, so
  // the array parser above cannot see them. Read them from their own
  // export instead, and only when the switch says they are live —
  // otherwise this file would assert a label for keys the API is not
  // sending, which is the defect direction 4 exists to catch.
  if (reportImpressionChannelEnabled()) {
    scopes.reports = [...new Set([...scopes.reports, ...stagedImpressionKeys()])];
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

  // --- the other direction ------------------------------------------
  //
  // A label here has to name a key the API can send. Suffixed forms
  // count: `fields` is reached as `fields_clinical`, `methylation` as
  // `methylation_withheld` / `methylation_origin`. The suffix list is
  // NOT copied here — the match is 「some allowlist key starts with this
  // key plus an underscore AND humanize.ts collapses the two onto one
  // label」, which asks the module itself which suffixes it honours.
  const allKeys = Object.values(allowlist).flat();
  const reaches = (key: string): boolean =>
    allKeys.some(
      (candidate) =>
        candidate === key ||
        (candidate.startsWith(`${key}_`) &&
          humanizeFieldKeys([candidate])[0] === humanizeFieldKeys([key])[0]),
    );

  const staged = new Set(stagedImpressionKeys());
  const channelOn = reportImpressionChannelEnabled();

  it.each(labelledFieldKeys().map((key) => [key]))(
    '%s 是 API 真能发过来的 key，不是一条永远印不出来的标签',
    (key) => {
      // Staged, not stale — see the note above `stagedImpressionKeys`.
      if (!channelOn && staged.has(key)) return;
      expect(reaches(key)).toBe(true);
    },
  );

  it('开关一旦打开，被豁免的那几个 key 必须真的在 allowlist 上', () => {
    // The exemption above is only honest while it cannot hide drift.
    if (!channelOn) {
      expect(staged.size).toBeGreaterThan(0);
      return;
    }
    for (const key of staged) expect(reaches(key)).toBe(true);
  });

  it('被豁免的每一个 key 在 humanize.ts 里都有标签，开关打开时不用改 App', () => {
    // The point of staging rather than deleting: flipping the API
    // constant must not require a mobile release.
    const labelled = new Set(labelledFieldKeys());
    for (const key of staged) expect(labelled.has(key)).toBe(true);
  });

  it.each(labelledFieldKeys().map((key) => [key]))('%s 落在某一个 scope 分组里', (key) => {
    const line = buildCitationSummary({ usedPersonalData: true, fieldsUsed: [key] });
    const groups = Object.values(GROUP_FOR_SCOPE).filter((group) => line?.includes(group));
    expect(groups).toHaveLength(1);
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

  it.each(labelledToolIds().map((id) => [id]))(
    '%s 是路由真注册了的工具，不是一条永远印不出来的标签',
    (id) => {
      expect(ids).toContain(id);
    },
  );

  it('没见过的工具 id 仍然原样显示，不会消失', () => {
    expect(humanizeToolName('future_tool')).toBe('future_tool');
  });
});
