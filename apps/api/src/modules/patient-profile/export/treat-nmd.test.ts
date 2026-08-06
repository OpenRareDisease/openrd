import { describe, expect, it } from 'vitest';

import { EXPORT_FIXTURE_PROFILE, FIXTURE_GENERATED_AT } from './__fixtures__/profile.fixture.js';
import { classifyDiagnosisType, normaliseSource } from './export-source.js';
import { buildTreatNmdExport, type TreatNmdSection } from './treat-nmd.js';
import type { PatientProfileDTO } from '../profile.service.js';

const build = (overrides: Partial<PatientProfileDTO> = {}, includeLocalOnly = false) =>
  buildTreatNmdExport(
    normaliseSource(
      { ...EXPORT_FIXTURE_PROFILE, ...overrides },
      { includeLocalOnly, generatedAt: FIXTURE_GENERATED_AT },
    ),
  );

const sectionOf = (result: ReturnType<typeof build>, key: string): TreatNmdSection => {
  const found = result.document.sections.find((section) => section.key === key);
  if (!found) throw new Error(`no section ${key}`);
  return found;
};

const itemOf = (section: TreatNmdSection, key: string) =>
  section.items.find((item) => item.key === key);

describe('TREAT-NMD alignment — the six mandatory content areas', () => {
  it('emits the six areas plus the optional ethnicity item, in order', () => {
    const result = build();
    expect(result.document.sections.map((section) => section.key)).toEqual([
      'diagnosis',
      'familyHistory',
      'symptoms',
      'motorFunction',
      'wheelchairUse',
      'milestones',
      'followupEvents',
      'pregnancyHistory',
      'ethnicity',
    ]);
  });

  it('每一个不属于该数据集的 section 都自己说出来', () => {
    // This document is titled with a named standard, so a receiving
    // registry is entitled to assume every section in it belongs to
    // that standard. `followupEvents` and `milestones` do not — they
    // are here because leaving them out would make the exported course
    // of the disease look like a straight line from diagnosis to
    // wheelchair. That is worth carrying, but only if the section says
    // so where the reader is, not only in a source comment.
    const MANDATORY = new Set([
      'diagnosis',
      'familyHistory',
      'symptoms',
      'motorFunction',
      'wheelchairUse',
      'pregnancyHistory',
      'ethnicity',
    ]);
    const extras = build().document.sections.filter((section) => !MANDATORY.has(section.key));
    expect(extras.length).toBeGreaterThan(0);
    extras.forEach((section) => {
      expect(section.noteZh ?? '').toContain('不属于该核心数据集');
    });
  });

  it('cites the in-repo source for the dataset it is aligning to', () => {
    const result = build();
    expect(result.document.datasetSourceZh).toContain('content/medical-kb/source/');
  });

  it('does not claim a version number or a section count it cannot support', () => {
    // The lane brief said 「v2 — the sixteen sections」. No source in
    // this repository says either of those things, so neither may
    // appear in a document a registry will read as authoritative.
    const serialised = JSON.stringify(build());
    expect(serialised).not.toMatch(/v2|version\s*2|十六|sixteen/i);
    expect(build().conformanceZh).toContain('不是一致性声明');
  });
});

describe('TREAT-NMD alignment — 记不清了 survives to the section', () => {
  it('carries a remembered year as a known answer', () => {
    const item = itemOf(sectionOf(build(), 'diagnosis'), 'diagnosis.year');
    expect(item?.value).toEqual({ answer: 'known', answerZh: '已知', year: 2014 });
  });

  it('carries 记不清了 as its own answer rather than as a blank', () => {
    const result = build({
      baseline: {
        ...(EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>),
        foundation: { diagnosisYear: '记不清了' },
      },
      diagnosisDate: null,
    });
    expect(itemOf(sectionOf(result, 'diagnosis'), 'diagnosis.year')?.value).toEqual({
      answer: 'not_remembered',
      answerZh: '记不清了',
      year: null,
    });
  });

  it('distinguishes 未采集 from 记不清了', () => {
    const result = build({
      baseline: {
        ...(EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>),
        foundation: {},
      },
      diagnosisDate: null,
    });
    expect(itemOf(sectionOf(result, 'diagnosis'), 'diagnosis.year')?.value).toEqual({
      answer: 'not_collected',
      answerZh: '未采集',
      year: null,
    });
  });
});

describe('TREAT-NMD alignment — family history is a second data subject', () => {
  it('withholds family history by default and says so as an omission', () => {
    const result = build();
    const family = sectionOf(result, 'familyHistory');
    expect(family.collected).toBe(false);
    expect(family.items).toEqual([]);
    // Absent must not read as negative.
    expect(family.noteZh).toContain('不表示「无家族史」');
    expect(result.omissions.map((entry) => entry.field)).toContain('sections.familyHistory');
    // The statement itself must not leak anywhere else in the payload.
    expect(JSON.stringify(result)).not.toContain('姑姑');
  });

  it('labels it as the patient’s own account when the local-only variant is asked for', () => {
    const result = build({}, true);
    const family = sectionOf(result, 'familyHistory');
    expect(family.collected).toBe(true);
    const item = itemOf(family, 'familyHistory.statement');
    expect(item?.labelZh).toBe('患者对自身家族史的陈述');
    expect(item?.provenanceZh).toContain('不是亲属本人的病历');
  });
});

describe('TREAT-NMD alignment — local-only identifiers', () => {
  it('omits name / preferred name / diagnosing physician by default', () => {
    const result = build();
    expect(result.document.localOnly).toBeNull();
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('张小雨');
    expect(serialised).not.toContain('李医生');
    expect(result.omissions.map((entry) => entry.field)).toContain('localOnly');
  });

  it('renders them only in the local-only variant', () => {
    const result = build({}, true);
    const items = result.document.localOnly?.items.map((item) => item.key);
    expect(items).toEqual(['local.fullName', 'local.preferredName', 'local.diagnosingPhysician']);
  });
});

describe('TREAT-NMD alignment — absent is not negative', () => {
  it('marks pregnancy history as never collected and lists it as an omission', () => {
    const result = build();
    const pregnancy = sectionOf(result, 'pregnancyHistory');
    expect(pregnancy.collected).toBe(false);
    expect(pregnancy.noteZh).toContain('不表示「没有妊娠史」');
    expect(result.omissions.map((entry) => entry.field)).toContain('sections.pregnancyHistory');
  });
});

describe('TREAT-NMD alignment — milestones carry their precision limit', () => {
  it('never turns a year-pinned wheelchair date into a January observation', () => {
    const result = build();
    const milestone = itemOf(sectionOf(result, 'wheelchairUse'), 'milestone.wheelchair');
    expect(milestone?.value).toMatchObject({
      timestamp: '2019-01-01T00:00:00.000Z',
      precision: 'unrecorded',
      pinnedToYearStart: true,
      storedYear: 2019,
    });
  });

  it('keeps NIV and AFO out of the wheelchair section', () => {
    const result = build();
    expect(sectionOf(result, 'milestones').items.map((item) => item.key)).toEqual([
      'milestone.niv',
    ]);
  });

  it('carries the pre-022 warning on an `assisted` ambulation value', () => {
    // 「需要辅助」 was, before migration 022, the only answer available
    // to someone who cannot walk at all. A registry must not read it
    // as evidence of preserved ambulation.
    const item = itemOf(sectionOf(build(), 'wheelchairUse'), 'wheelchair.currentState');
    expect(item?.provenanceZh).toContain('022');
  });
});

describe('classifyDiagnosisType', () => {
  it('reads both types out of the shapes patients and reports actually use', () => {
    expect(classifyDiagnosisType('FSHD1')).toBe('FSHD1');
    expect(classifyDiagnosisType('fshd-1')).toBe('FSHD1');
    expect(classifyDiagnosisType('1型')).toBe('FSHD1');
    expect(classifyDiagnosisType('FSHD2')).toBe('FSHD2');
    expect(classifyDiagnosisType('FSHD 2型')).toBe('FSHD2');
  });

  it('does not default an unknown answer to the common type', () => {
    // Defaulting to FSHD1 would be the plausible-looking wrong answer:
    // it is the common form, so nobody would notice.
    expect(classifyDiagnosisType(null)).toBe('unspecified');
    expect(classifyDiagnosisType('临床诊断，未做基因')).toBe('unspecified');
    expect(classifyDiagnosisType('FSHD')).toBe('unspecified');
  });

  it('is not order-dependent between FSHD1 and FSHD2', () => {
    // 「FSHD2」 contains 「FSHD」; a naive FSHD1-first test would have
    // to be right by luck.
    expect(classifyDiagnosisType('FSHD2 型')).toBe('FSHD2');
  });
});
