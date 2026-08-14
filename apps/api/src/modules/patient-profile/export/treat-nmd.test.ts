import { describe, expect, it } from 'vitest';

import { EXPORT_FIXTURE_PROFILE, FIXTURE_GENERATED_AT } from './__fixtures__/profile.fixture.js';
import { locatorsIn } from './__fixtures__/reason-claims.js';
import { classifyDiagnosisType, normaliseSource } from './export-source.js';
import { applyAdminBaselineWrite } from '../baseline-provenance.js';
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

describe('TREAT-NMD alignment — held-but-unemitted instruments are declared', () => {
  it('lists Brooke and Vignos in omissions, not just nowhere', () => {
    // 运动功能 is one of the six mandatory areas, and Brooke / Vignos
    // are the only cross-patient-comparable measures in the record.
    // Shipping without them AND without saying so is what envelope.ts
    // says `omissions` exists to prevent.
    const omission = build().omissions.find(
      (entry) => entry.field === 'sections.motorFunction.instruments',
    );
    expect(omission?.reasonZh).toContain('Brooke');
    expect(omission?.reasonZh).toContain('Vignos');
    expect(omission?.reasonZh).toContain('不表示患者没有做过分级');
  });

  it('points at it from the section a reader is actually looking at', () => {
    expect(sectionOf(build(), 'motorFunction').noteZh).toContain('Vignos');
  });

  it('every section the reason sends a reader to exists and carries the walking state', () => {
    // This is the only one of the three formats that carries a walking
    // state, so it is the only one whose omission may point at a
    // section — and it has to point at every section that has one.
    // Two sections do; the wording named one and was shared with two
    // formats that have neither.
    const result = build();
    const reason =
      result.omissions.find((entry) => entry.field === 'sections.motorFunction.instruments')
        ?.reasonZh ?? '';
    const locators = locatorsIn(reason);
    expect(locators.length).toBeGreaterThan(0);

    // Forward: nothing the reason points at is imaginary. Item keys are
    // literal strings in the payload, so a missing one fails here. A
    // `sections.X` locator is resolved segment by segment rather than
    // by its first two — `sections.motorFunction.nothingLikeThis` must
    // not pass because `motorFunction` exists.
    //
    // Scoped to what `locatorsIn` returns, which is not every pointer a
    // sentence could contain: a dotted path with a segment under three
    // characters (`sections.motorFunction.q1`, `subject.id`) is not
    // returned at all, so this loop never sees it. That bound is stated
    // and pinned at DOTTED_LOCATOR and in reason-claims.test.ts; do not
    // read this test as 「every pointer in the reason resolves」.
    const serialised = JSON.stringify(result.document);
    locators.forEach((locator) => {
      const [head, sectionKey, ...within] = locator.split('.');
      if (head !== 'sections') {
        expect(serialised, locator).toContain(locator);
        return;
      }
      const section = result.document.sections.find((entry) => entry.key === sectionKey);
      expect(section, locator).toBeDefined();
      if (within.length > 0) expect(JSON.stringify(section), locator).toContain(within.join('.'));
    });

    const ambulation = (
      (EXPORT_FIXTURE_PROFILE.baseline as { currentStatus: Record<string, unknown> })
        .currentStatus as { independentlyAmbulatory: string }
    ).independentlyAmbulatory;
    const named = [
      ...new Set(
        locators
          .filter((locator) => locator.startsWith('sections.'))
          .map((locator) => locator.split('.')[1]),
      ),
    ];

    // Reverse, which is the half a hardcoded expected list cannot
    // check: every section that ACTUALLY holds the walking state must
    // be named. Verified against the mutation the audit used — adding a
    // third section carrying `currentStatus.ambulation` while leaving
    // the reason alone left the old `toEqual(['motorFunction',
    // 'wheelchairUse'])` green, which is exactly the undercount the
    // 「只有…运动功能一节」 wording committed.
    //
    // Searched over the whole serialised section rather than over
    // `item.value === ambulation`: an equality check only sees the bare
    // enum, and the sections next to these already carry object and
    // array values (`motor.functionTests`, `motor.assistiveDevices`),
    // so the next item to hold the state plausibly wraps it — and a
    // wrapped state is just as much a reason to name the section. The
    // token is safe to search for: `assisted` is not a substring of any
    // other key, label or value these sections serialise.
    const carrying = result.document.sections
      .filter((section) => JSON.stringify(section).includes(ambulation))
      .map((section) => section.key);
    expect(carrying.length).toBeGreaterThan(0);
    expect(named.sort()).toEqual([...carrying].sort());

    // The local-only block is not in `sections` and so cannot be
    // reached by a `sections.X` locator. It must therefore not carry
    // the walking state at all, in either variant — again in any shape,
    // not only as a bare value.
    [build(), build({}, true)].forEach((variant) => {
      expect(JSON.stringify(variant.document.localOnly ?? null)).not.toContain(ambulation);
    });
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

/**
 * Contract §B3 in this format.
 *
 * TREAT-NMD is the one of the three with a per-item provenance slot, so
 * it gets both: the item's own `provenanceZh` says who typed the value,
 * and the envelope carries the full list for a receiver that reads the
 * envelope rather than the items.
 */
describe('管理员代填的字段不能在导出里抹平（§B3）', () => {
  const ADMIN_ID = '11111111-2222-3333-4444-555555555555';
  const AT = new Date('2026-08-13T04:11:07.912Z');

  /** Built with the real write helper rather than a hand-rolled block,
   *  so a reshape of the provenance record breaks this test instead of
   *  sliding past it. */
  const adminEditedProfile = (): PatientProfileDTO => {
    const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
    const disease = stored.diseaseBackground as Record<string, unknown>;
    return {
      ...EXPORT_FIXTURE_PROFILE,
      baseline: applyAdminBaselineWrite(
        stored,
        {
          ...stored,
          diseaseBackground: { ...disease, diagnosisType: 'FSHD2', d4z4: '9 个重复单元' },
        },
        { adminUserId: ADMIN_ID, at: AT },
      ),
    } as PatientProfileDTO;
  };

  it('把来源写进条目自己的 provenanceZh 里', () => {
    const diagnosis = sectionOf(build(adminEditedProfile()), 'diagnosis');

    expect(itemOf(diagnosis, 'diagnosis.type')?.provenanceZh).toContain('不是患者本人填写');
    expect(itemOf(diagnosis, 'diagnosis.d4z4')?.provenanceZh).toContain('管理员');
    // The fields the administrator did NOT touch keep their old string
    // exactly — a blanket disclaimer would be the same lie in reverse.
    expect(itemOf(diagnosis, 'diagnosis.haplotype')?.provenanceZh).toBe(
      '基线问卷或基因报告结构化解析',
    );
  });

  it('信封上逐条列出，带管理员账号和时间', () => {
    expect(build(adminEditedProfile()).fieldOrigins).toEqual([
      {
        path: 'diseaseBackground.d4z4',
        labelZh: 'D4Z4 重复数',
        state: 'admin_entered',
        adminUserId: ADMIN_ID,
        at: '2026-08-13T04:11:07.912Z',
        detail: null,
      },
      {
        path: 'diseaseBackground.diagnosisType',
        labelZh: 'FSHD 分型',
        state: 'admin_entered',
        adminUserId: ADMIN_ID,
        at: '2026-08-13T04:11:07.912Z',
        detail: null,
      },
    ]);
  });

  it('数据性质那一句不再笼统说「都是患者自述」', () => {
    const marked = build(adminEditedProfile());
    expect(marked.notes.数据性质).toContain('不是患者本人填写的');
    // And it says something, explicitly, when nothing is marked — an
    // empty list is a claim, not a shrug. The whole sentence is pinned,
    // not just its tail: it may claim only that no administrator write
    // is on record, because an unmarked field is not thereby the
    // patient's own. The three formats say this in the same words
    // (export-source.ts).
    expect(build().notes.数据性质).toContain('本次导出的基线字段没有本平台工作人员代填的记录。');
    expect(build().fieldOrigins).toEqual([]);
  });

  it('姓名也标出来 —— upsertBaseline 会把它写进 full_name 列', () => {
    const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
    const foundation = stored.foundation as Record<string, unknown>;
    const profile = {
      ...EXPORT_FIXTURE_PROFILE,
      baseline: applyAdminBaselineWrite(
        stored,
        { ...stored, foundation: { ...foundation, fullName: '张雨' } },
        { adminUserId: ADMIN_ID, at: AT },
      ),
    } as PatientProfileDTO;

    const local = build(profile, true).document.localOnly;
    const provenance = local?.items.find((item) => item.key === 'local.fullName')?.provenanceZh;
    expect(provenance).toContain('不是患者本人填写');
    // And it does not ALSO claim the patient typed it. The marker used
    // to be appended to 「患者本人填写」, so one field asserted both.
    expect(provenance).not.toContain('患者本人填写；');
    expect(provenance?.startsWith('患者本人填写')).toBe(false);
  });

  it('读不出来的标记按「不是本人填写」处理，不退回成本人填写', () => {
    const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
    const result = build({
      ...EXPORT_FIXTURE_PROFILE,
      baseline: {
        ...stored,
        fieldProvenance: { 'diseaseBackground.diagnosisType': { source: '?' } },
      },
    } as PatientProfileDTO);

    expect(result.fieldOrigins[0]).toMatchObject({ state: 'unreadable', adminUserId: null });
    expect(itemOf(sectionOf(result, 'diagnosis'), 'diagnosis.type')?.provenanceZh).toContain(
      '不是患者本人填写',
    );
  });
});
