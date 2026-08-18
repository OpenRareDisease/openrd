import { describe, expect, it } from 'vitest';

import { EXPORT_FIXTURE_PROFILE, FIXTURE_GENERATED_AT } from './__fixtures__/profile.fixture.js';
import { locatorsIn } from './__fixtures__/reason-claims.js';
import { classifyDiagnosisType, normaliseSource } from './export-source.js';
import { applyAdminBaselineWrite, BASELINE_PROVENANCE_KEY } from '../baseline-provenance.js';
import { applyGeneticReportAutofill } from '../profile.autofill.js';
import { buildClinicalPassportSummary } from '../profile.passport.js';
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

/**
 * 运动功能 counted the muscle grades and emitted none of them.
 *
 * `collected` on that section has always included
 * `profile.measurements.length > 0`, so the section reported itself
 * collected on the strength of a series it had no item for — and no
 * omission mentioned it either. The FHIR bundle carries every grade as
 * an `exam` Observation and the Phenopacket declares them by count, so
 * this document, the one whose 运动功能 area a registry actually maps,
 * was the only place a set of muscle grades vanished without trace.
 */
describe('TREAT-NMD alignment — 运动功能 carries the muscle grades it counts', () => {
  const twoSides: PatientProfileDTO['measurements'] = [
    // Same muscle, both sides, and the LEFT one older. Keyed on the
    // group alone, the newer right grade would be published as this
    // patient's deltoid — and FSHD is asymmetric far more often than
    // not, so that is a wrong number rather than a rounding.
    {
      ...EXPORT_FIXTURE_PROFILE.measurements[0],
      id: '33333333-3333-4333-8333-33333333333a',
      muscleGroup: 'deltoid',
      side: 'left',
      strengthScore: 2,
      recordedAt: '2025-01-01T00:00:00.000Z',
    },
    {
      ...EXPORT_FIXTURE_PROFILE.measurements[0],
      id: '33333333-3333-4333-8333-33333333333b',
      muscleGroup: 'deltoid',
      side: 'right',
      strengthScore: 5,
      recordedAt: '2025-06-01T00:00:00.000Z',
    },
  ];

  it('emits one row per muscle group AND side, latest first per pair', () => {
    const item = itemOf(
      sectionOf(build({ measurements: twoSides }), 'motorFunction'),
      'motor.muscleStrength',
    );
    expect(item?.value).toEqual([
      expect.objectContaining({ muscleGroup: 'deltoid', side: 'left', strengthScore: 2 }),
      expect.objectContaining({ muscleGroup: 'deltoid', side: 'right', strengthScore: 5 }),
    ]);
  });

  it('carries entryMode per row, because the rows do not share an author', () => {
    // One clinician-entered grade among self-tests is exactly the row a
    // registry weights differently, and one provenance sentence for the
    // whole item cannot say which one it is.
    const item = itemOf(sectionOf(build(), 'motorFunction'), 'motor.muscleStrength');
    expect(item?.value).toEqual([
      expect.objectContaining({ entryMode: 'self_report' }),
      expect.objectContaining({ entryMode: 'clinician_entered' }),
    ]);
    expect(item?.provenanceZh).toContain('entryMode');
    expect(item?.provenanceZh).toContain('clinician_entered');
  });

  it('drops the item rather than emitting an empty one when nothing was measured', () => {
    // An item present with an empty list would say 「we asked and there
    // are no grades」; an absent item says nothing was recorded.
    const section = sectionOf(build({ measurements: [] }), 'motorFunction');
    expect(itemOf(section, 'motor.muscleStrength')).toBeUndefined();
  });
});

describe('TREAT-NMD alignment — the ADL ratings reach a document at all', () => {
  it('emits the latest rating per activity, and keeps the null assistance answer a null', () => {
    const section = sectionOf(
      build({
        dailyImpacts: [
          {
            ...EXPORT_FIXTURE_PROFILE.dailyImpacts[0],
            id: '66666666-6666-4666-8666-66666666666a',
            adlKey: 'dressing',
            difficultyLevel: 1,
            needsAssistance: null,
            recordedAt: '2025-06-05T00:00:00.000Z',
          },
          {
            ...EXPORT_FIXTURE_PROFILE.dailyImpacts[0],
            id: '66666666-6666-4666-8666-66666666666b',
            adlKey: 'dressing',
            difficultyLevel: 4,
            needsAssistance: true,
            recordedAt: '2024-06-05T00:00:00.000Z',
          },
        ],
      }),
      'symptoms',
    );
    const item = itemOf(section, 'dailyImpact.dressing');
    expect(item?.labelZh).toBe('穿衣困难程度');
    expect(item?.value).toMatchObject({ difficultyLevel: 1, needsAssistance: null });
    // 「not asked」 must not be readable as 「does not need help」.
    expect(item?.provenanceZh).toContain('不表示不需要');
  });

  it('keeps the建档-time self-rating and the follow-up rating distinguishable', () => {
    const section = sectionOf(build(), 'symptoms');
    expect(itemOf(section, 'challenge.stairs')?.provenanceZh).toContain('建档时填写一次');
    expect(section.noteZh).toContain('两者不要合并统计');
  });
});

describe('TREAT-NMD alignment — 起病部位 reaches an export', () => {
  it('is carried verbatim and not classified', () => {
    const item = itemOf(sectionOf(build(), 'diagnosis'), 'diagnosis.onsetRegion');
    expect(item?.value).toBe('肩带');
    expect(item?.provenanceZh).toContain('原文照录');
    expect(item?.provenanceZh).toContain('不作归类');
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
    const marker = { source: 'admin_entered', adminUserId: ADMIN_ID, at: AT.toISOString() };
    return {
      ...EXPORT_FIXTURE_PROFILE,
      // // Written into the block by hand, and that is the fixture's point: the
      // helper refuses every genetic path now, so this marker can no longer
      // be created — but profiles written before that carry one, and an
      // exporter that dropped it would be a silent regression against real
      // stored data.
      baseline: {
        ...stored,
        diseaseBackground: { ...disease, diagnosisType: 'FSHD2', d4z4: '9 个重复单元' },
        [BASELINE_PROVENANCE_KEY]: {
          'diseaseBackground.diagnosisType': marker,
          'diseaseBackground.d4z4': marker,
        },
      },
    } as PatientProfileDTO;
  };

  it('把来源写进条目自己的 provenanceZh 里', () => {
    const diagnosis = sectionOf(build(adminEditedProfile()), 'diagnosis');

    expect(itemOf(diagnosis, 'diagnosis.type')?.provenanceZh).toContain('不是患者本人填写');
    expect(itemOf(diagnosis, 'diagnosis.d4z4')?.provenanceZh).toContain('管理员');
    // The fields the administrator did NOT touch keep their own string
    // exactly — a blanket disclaimer would be the same lie in reverse.
    // 单倍型 has no box on any patient form, so its string may not offer
    // the questionnaire as an author; the fixture's genetic report reads
    // the same 4qA that is in the archive, so what it names instead is
    // the report, and the marked fields above are what shows the whole
    // sentence is dropped when a marker refutes it.
    expect(itemOf(diagnosis, 'diagnosis.haplotype')?.provenanceZh).toBe(
      '本平台档案中记录的值。患者的表单不为这一项提供输入框，本平台后台也不允许代填（服务端拒绝写入并点名字段），所以它不是患者填写的问卷答案。本平台只从该患者上传的文件中被认定为这份档案基因证据的那一份读取这几项基因结果，其余上传件不参与；那一份的这一项与档案里这个值完全相同，而读取档案时那一份的解析结果会补上档案里空着的这一项，不留记录。所以这个值是基因报告的解析结果 —— 只是没有记录能指出是哪一次读取写进去的。',
    );
  });

  it('甲基化和单倍型不把基线问卷写成来源，D4Z4 才有那个框', () => {
    // The shared fixture has no 甲基化 — the field it is truest of is
    // the one a profile is least likely to carry — so this case puts
    // one in rather than asserting over a missing item.
    const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
    const disease = stored.diseaseBackground as Record<string, unknown>;
    const withMethylation = build({
      baseline: {
        ...stored,
        diseaseBackground: { ...disease, methylation: '25%' },
      },
    } as Partial<PatientProfileDTO>);
    const diagnosis = sectionOf(withMethylation, 'diagnosis');
    const provenanceOf = (key: string) => {
      const item = itemOf(diagnosis, key);
      if (!item) throw new Error(`no item ${key}`);
      return item.provenanceZh;
    };
    const d4z4 = provenanceOf('diagnosis.d4z4');
    const haplotype = provenanceOf('diagnosis.haplotype');
    const methylation = provenanceOf('diagnosis.methylation');

    // 建档表单 draws a D4Z4 box and draws none for the other two, and
    // the back office refuses all three. So the questionnaire may be
    // offered as a possible author on exactly one of them.
    expect(d4z4).toContain('基线问卷为这一项提供输入框');
    expect(haplotype).toContain('不为这一项提供输入框');
    expect(methylation).toContain('不为这一项提供输入框');

    // 甲基化 is on no report in this fixture, so nothing can be named
    // as its author and the sentence says so — which is what the
    // referral pack and the passport print over the same value.
    expect(methylation).toContain('来源无法确定');
    // The box is not what decides whether the reading is consulted —
    // see the case below, which runs D4Z4 through all three report
    // states. Here it says only that the box has not bought this field
    // out of reporting one: the fixture's archive reads 「5 个重复单元」
    // against a report reading 「5」, and the sentence prints the
    // difference rather than describing the autofill in the abstract.
    expect(d4z4).toContain('那一份的这一项是「5」');

    // No branch may OPEN by crediting the patient with the number: the
    // box arrives pre-filled from a baseline the report autofill has
    // already been through, so what every sentence can lead with is
    // where the value sits.
    [d4z4, haplotype, methylation].forEach((provenance) => {
      expect(provenance.startsWith('本平台档案中记录的值')).toBe(true);
    });
  });

  /**
   * THE SENTENCE MAY NOT DENY A READING THE SAME APP IS SHOWING.
   *
   * The tails spoke for 「该患者已上传的基因报告」 — every upload — while
   * being computed from the one `pickGeneticEvidenceDocument` names.
   * The state that separates the two: 甲基化 sitting on a 病历摘要 the
   * picker declines in favour of a genetics report that is silent about
   * it. The export told a registry no uploaded report of this patient's
   * carried the value, while 报告详情 printed it, with a correction
   * control beside it, off that very document — and the passport, the
   * share page and the referral pack carried the hedged 「不是本平台此刻
   * 能从报告里读到的值」 over the same string. One 甲基化, two accounts,
   * decided by which surface the reader was holding.
   *
   * Both states are run, because a sentence that cannot tell them apart
   * is the defect however true it happens to be in one of them.
   */
  it('不否认被跳过的那份报告里写着的值 —— 只说自己读的是哪一份', () => {
    const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
    const disease = stored.diseaseBackground as Record<string, unknown>;
    const methylationOf = (documents: PatientProfileDTO['documents']) => {
      const result = build({
        baseline: { ...stored, diseaseBackground: { ...disease, methylation: '25%' } },
        documents,
      } as Partial<PatientProfileDTO>);
      return itemOf(sectionOf(result, 'diagnosis'), 'diagnosis.methylation')?.provenanceZh ?? '';
    };

    const summaryDocument = {
      ...EXPORT_FIXTURE_PROFILE.documents[0],
      id: '88888888-8888-4888-8888-888888888899',
      documentType: 'medical_record',
      uploadedAt: '2026-03-01T06:00:00.000Z',
      ocrPayload: { fields: { classifiedType: 'medical_record', methylationValue: '25%' } },
    } as PatientProfileDTO['documents'][number];

    const declined = methylationOf([...EXPORT_FIXTURE_PROFILE.documents, summaryDocument]);
    // The same archive value with nothing to read it off at all. The
    // 病历摘要 stays, so the difference between the two is only which
    // document the picker had to choose from — not whether any document
    // on file carries 甲基化.
    const nowhere = methylationOf([
      ...EXPORT_FIXTURE_PROFILE.documents.filter(
        (document) => document.documentType !== 'genetic_report',
      ),
      { ...summaryDocument, ocrPayload: { fields: { classifiedType: 'medical_record' } } },
    ] as PatientProfileDTO['documents']);

    // The premise: the 病历摘要 is not what the platform reads these off.
    const picked = buildClinicalPassportSummary({
      ...EXPORT_FIXTURE_PROFILE,
      baseline: { ...stored, diseaseBackground: { ...disease, methylation: '25%' } },
      documents: [...EXPORT_FIXTURE_PROFILE.documents, summaryDocument],
    } as PatientProfileDTO);
    expect(picked.diagnosis.valueOrigins.d4z4Repeats.documentId).not.toBe(summaryDocument.id);

    // Neither state may carry the claim that spoke for every upload.
    for (const sentence of [declined, nowhere]) {
      expect(sentence).not.toContain('也没有从该患者已上传的基因报告里读到这一项');
    }
    // The state with a report says which one it read; the state without
    // one has no scope to state and says that instead.
    expect(declined).toContain('其余上传件不参与');
    // And the one where a declined document does carry it says so.
    expect(declined).toContain('这不等于该患者手里没有写着这一项的报告');
    // Having no report to read is not the same state as having one that
    // is silent, and the sentence no longer merges them — the merged
    // version sent a receiver looking for a report to ask about.
    expect(declined).not.toBe(nowhere);
    expect(nowhere).toContain('没有可作为这份档案基因证据来读的文件');

    // And what the clinical surfaces print over the same string stays
    // the same in both — this fix is about the export catching up to
    // them, not about moving the bracket.
    expect(picked.diagnosis.methylationValue).toBe('25%');
    expect(picked.diagnosis.valueOrigins.methylationValue.labelZh).toBe('来源无法确定');
  });

  /**
   * D4Z4 HAS A BOX, AND THAT DECIDES WHAT A MATCH IS WORTH — NOT
   * WHETHER THE REPORT IS READ AT ALL.
   *
   * The branch used to end at the box: every profile got one sentence
   * about the autofill mechanism, identical whether the evidence report
   * agreed with the archive, disagreed with it, or did not exist. D4Z4
   * is the value most likely to reach a registry twice — the passport,
   * the PDF, the share page and the referral pack print the report's
   * number while this export prints the archive's — so it was the one
   * genetic result whose export disclosed nothing about where it came
   * from.
   *
   * All three states, on one profile shape, so the sentences can be
   * read against each other.
   */
  it('D4Z4 的来源句报告读到什么就说什么，不是一句「区分不了」到底', () => {
    const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
    const disease = stored.diseaseBackground as Record<string, unknown>;
    const d4z4Of = (archived: string, documents = EXPORT_FIXTURE_PROFILE.documents) => {
      const result = build({
        baseline: { ...stored, diseaseBackground: { ...disease, d4z4: archived } },
        documents,
      } as Partial<PatientProfileDTO>);
      return itemOf(sectionOf(result, 'diagnosis'), 'diagnosis.d4z4')?.provenanceZh ?? '';
    };

    // Agreement. The box is why this stops short of attributing the
    // value: the patient could have typed the same number.
    const agrees = d4z4Of('5');
    expect(agrees).toContain('与档案里这个值完全相同');
    expect(agrees).toContain('本平台区分不了');
    expect(agrees).not.toContain('来源无法确定');

    // Disagreement — the state a receiver would otherwise resolve by
    // guessing, holding this export beside a passport printing 5.
    const disagrees = d4z4Of('4');
    expect(disagrees).toContain('那一份的这一项是「5」');
    expect(disagrees).toContain('与档案里这个值不完全一致');
    // How the comparison was made, so the fixture's own 「5 个重复单元」
    // against a report's 「5」 is not read as a laboratory disagreeing
    // with the archive about a repeat count.
    expect(d4z4Of('5 个重复单元')).toContain('逐字比对');
    expect(disagrees).toContain('来源无法确定');

    // No reading at all. The old sentence offered the autofill as a
    // possible author here too, for a profile with no report to autofill
    // from.
    const silent = d4z4Of(
      '4',
      EXPORT_FIXTURE_PROFILE.documents.filter(
        (document) => document.documentType !== 'genetic_report',
      ),
    );
    expect(silent).toContain('没有可作为这份档案基因证据来读的文件');
    expect(silent).not.toContain('本平台区分不了');

    // The three are different sentences, which is the whole finding.
    expect(new Set([agrees, disagrees, silent]).size).toBe(3);
  });

  it('单倍型和甲基化的来源句跟着报告走，不是一句「来源无法确定」到底', () => {
    // The defect this case pins: the sentence branched on whether the
    // patient's form draws a box and stopped there, so a value the same
    // read attributes to a document — `reportFields` carries it, the
    // FHIR bundle emits it as that document's Observation, the passport
    // brackets it 「报告读取」 — was exported as having no traceable
    // author at all.
    const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
    const disease = stored.diseaseBackground as Record<string, unknown>;
    const haplotypeOf = (baselineHaplotype: string | null) => {
      const result = build({
        baseline: {
          ...stored,
          diseaseBackground: { ...disease, haplotype: baselineHaplotype },
        },
      } as Partial<PatientProfileDTO>);
      const item = itemOf(sectionOf(result, 'diagnosis'), 'diagnosis.haplotype');
      return item?.provenanceZh ?? null;
    };

    // The fixture's genetic report reads 4qA. An archive holding the
    // same string is the state the autofill produces on its own.
    expect(haplotypeOf('4qA')).toContain('这个值是基因报告的解析结果');
    expect(haplotypeOf('4qA')).not.toContain('来源无法确定');

    // An archive value the report does not support keeps 来源无法确定,
    // and the reading is printed rather than left for the receiver to
    // discover in another document of the same export.
    const disagrees = haplotypeOf('4qB') ?? '';
    expect(disagrees).toContain('那一份的这一项是「4qA」');
    expect(disagrees).toContain('来源无法确定');

    // And with no reading at all the sentence says that too, rather
    // than leaving the reader to wonder whether a report was consulted.
    const noReport = build({
      documents: EXPORT_FIXTURE_PROFILE.documents.filter(
        (document) => document.documentType !== 'genetic_report',
      ),
    });
    const withoutReport = itemOf(sectionOf(noReport, 'diagnosis'), 'diagnosis.haplotype');
    expect(withoutReport?.provenanceZh).toContain('没有可作为这份档案基因证据来读的文件');
    expect(withoutReport?.provenanceZh).toContain('来源无法确定');
  });

  /**
   * NO SENTENCE MAY PUT A LABORATORY BEHIND A TRANSCRIPTION.
   *
   * `pickGeneticEvidenceDocument` takes a 病历摘要 quoting the results
   * when the genetics report read out nothing, on purpose, because for
   * some patients it is the only copy of the number that exists. Every
   * tail then ended by calling the value 基因报告的解析结果 — and the
   * same export answers 是否有基因报告 off the same documents, so one
   * document told a registry both that no genetics report exists and
   * that one had parsed the number four items down.
   *
   * The profile below is that state exactly: one 病历摘要, no genetics
   * report anywhere, an archive holding what the summary quotes.
   */
  it('证据是一份病历摘要时，来源句不把值说成基因报告的解析结果', () => {
    const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
    const disease = stored.diseaseBackground as Record<string, unknown>;
    const summaryDocument = {
      ...EXPORT_FIXTURE_PROFILE.documents[0],
      id: '88888888-8888-4888-8888-888888888897',
      documentType: 'medical_record',
      uploadedAt: '2026-03-01T06:00:00.000Z',
      ocrPayload: {
        fields: {
          classifiedType: 'medical_record',
          d4z4Repeats: '3',
          haplotype: '4qA',
          diagnosisDate: '2019-05-03',
        },
      },
    } as PatientProfileDTO['documents'][number];
    const result = build({
      baseline: { ...stored, diseaseBackground: { ...disease, d4z4: '3', haplotype: '4qA' } },
      documents: [
        summaryDocument,
        ...EXPORT_FIXTURE_PROFILE.documents.filter(
          (document) => document.documentType !== 'genetic_report',
        ),
      ],
    } as Partial<PatientProfileDTO>);
    const diagnosis = sectionOf(result, 'diagnosis');
    const provenanceOf = (key: string) => itemOf(diagnosis, key)?.provenanceZh ?? '';

    // The premise, and the contradiction the sentences used to sit
    // beside: this profile has no genetics report at all.
    expect(itemOf(diagnosis, 'diagnosis.geneticallyConfirmed')?.value).toBe(false);

    // 单倍型 has no box, so its tail is the one that ATTRIBUTES the
    // value — and what it may attribute it to is this platform's read
    // of a named document, not a laboratory.
    const haplotype = provenanceOf('diagnosis.haplotype');
    expect(haplotype).not.toContain('基因报告的解析结果');
    expect(haplotype).toContain('本平台对那一份的解析结果');
    // D4Z4 has one, so its tail still ends at 区分不了 — and the
    // alternative it offers beside the patient may not be a laboratory
    // either.
    const d4z4 = provenanceOf('diagnosis.d4z4');
    expect(d4z4).toContain('本平台区分不了');
    expect(d4z4).not.toContain('基因报告的解析结果');

    // And each of them says what the document IS, in the phrase the
    // passport brackets the same values with.
    for (const key of ['diagnosis.d4z4', 'diagnosis.haplotype', 'diagnosis.year']) {
      expect(provenanceOf(key)).toContain('那一份不是基因报告');
      expect(provenanceOf(key)).toContain('转录自非基因报告文件');
    }

    // The value still exports. Refusing to call it a laboratory reading
    // is not the same as dropping the patient's only copy of it.
    expect(itemOf(diagnosis, 'diagnosis.d4z4')?.value).toMatchObject({ recordedZh: '3' });

    // The same shape on a real genetics report keeps the sentence that
    // is true there — the point is that the two states differ, not that
    // 基因报告 is gone from the vocabulary.
    const fromLaboratory =
      itemOf(sectionOf(build(), 'diagnosis'), 'diagnosis.haplotype')?.provenanceZh ?? '';
    expect(fromLaboratory).toContain('这个值是基因报告的解析结果');
    expect(fromLaboratory).not.toContain('转录自非基因报告文件');
  });

  /**
   * 诊断 HAS FIVE VALUES AND HAD TWO REGISTERS.
   *
   * 分型 said 「患者档案记录为「FSHD1」」 and 确诊年份 said where the
   * column is, while D4Z4, 单倍型 and 甲基化 beside them each stated
   * whether this platform's own reading of the evidence report supports
   * the archived value. A registry reading that block saw two fields
   * with a stated provenance and two without, and nothing saying which
   * was which — while the same read-time autofill fills all five from
   * the same one document.
   */
  it('分型和确诊年份的来源句和它们的三个基因兄弟同一个规格', () => {
    const diagnosis = sectionOf(build(), 'diagnosis');
    const provenanceOf = (key: string) => itemOf(diagnosis, key)?.provenanceZh ?? '';
    const type = provenanceOf('diagnosis.type');
    const year = provenanceOf('diagnosis.year');

    // Neither may stop at where the value sits, which is all the old
    // strings did.
    expect(type).not.toBe('患者档案记录为「FSHD1」');
    expect(year).not.toBe('档案中的确诊年份；该栏位缺失时回退到确诊日期的年份部分');

    // Both name the box AND the read-time autofill as the two live ways
    // in — the pair that makes the author unprovable — and both end in
    // the same conclusion the genetic three end in.
    for (const sentence of [type, year]) {
      expect(sentence).toContain('基线问卷为这一项提供输入框');
      expect(sentence).toContain('不留记录');
      expect(sentence).toContain('其余上传件不参与');
    }
    // The fixture's genetics report states neither 分型 nor 诊断日期, so
    // both land on their 「that one report is silent」 branch rather than
    // on the branch that names no report at all.
    expect(type).toContain('那一份没有这一项');
    expect(year).toContain('那一份没有诊断日期');
    expect(type).toContain('来源无法确定');
    expect(year).toContain('来源无法确定');

    // 分型's exported value is a classification, not the stored string,
    // so its sentence names the string it was classified from.
    expect(type).toContain('本平台档案中记录的「FSHD1」，本次导出的分型由它归一而来');
    expect(diagnosis.items.find((item) => item.key === 'diagnosis.type')?.value).toBe('FSHD1');
  });

  it('分型的来源句报告读到什么就说什么', () => {
    const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
    const disease = stored.diseaseBackground as Record<string, unknown>;
    const withReportType = (archived: string, reported: string) => {
      const [genetic, ...rest] = EXPORT_FIXTURE_PROFILE.documents;
      const result = build({
        baseline: { ...stored, diseaseBackground: { ...disease, diagnosisType: archived } },
        documents: [
          {
            ...genetic,
            ocrPayload: {
              fields: {
                ...(genetic.ocrPayload as { fields: Record<string, unknown> }).fields,
                diagnosisType: reported,
              },
            },
          },
          ...rest,
        ] as PatientProfileDTO['documents'],
      } as Partial<PatientProfileDTO>);
      return itemOf(sectionOf(result, 'diagnosis'), 'diagnosis.type')?.provenanceZh ?? '';
    };

    // The report says what the archive says. 分型 has a box, so the
    // match settles nothing about the author — the patient could have
    // typed the same string — and the sentence stops there.
    const agrees = withReportType('FSHD1', 'FSHD1');
    expect(agrees).toContain('与档案里这个值完全相同');
    expect(agrees).toContain('本平台区分不了');
    expect(agrees).not.toContain('来源无法确定');

    // And where they differ, the receiver is handed both strings rather
    // than discovering the second one in another document of the same
    // export.
    const disagrees = withReportType('FSHD2', 'FSHD1');
    expect(disagrees).toContain('那一份的这一项是「FSHD1」');
    expect(disagrees).toContain('来源无法确定');
  });

  /**
   * 确诊年份 IS A YEAR AND THE REPORT STATES A DATE.
   *
   * That is why it is not a fifth entry in the genetic table: the exact
   * string comparison those four conclude from would read 2014 against
   * 2014-03-02 as a disagreement and tell a registry the archive is not
   * that reading. This sentence prints the date and concludes nothing
   * from comparing them.
   */
  it('确诊年份不拿年份去和报告上的日期做逐字比对', () => {
    const [genetic, ...rest] = EXPORT_FIXTURE_PROFILE.documents;
    const result = build({
      documents: [
        {
          ...genetic,
          ocrPayload: {
            fields: {
              ...(genetic.ocrPayload as { fields: Record<string, unknown> }).fields,
              diagnosisDate: '2014-03-02',
            },
          },
        },
        ...rest,
      ] as PatientProfileDTO['documents'],
    } as Partial<PatientProfileDTO>);
    const year = itemOf(sectionOf(result, 'diagnosis'), 'diagnosis.year')?.provenanceZh ?? '';

    expect(year).toContain('那一份的诊断日期是「2014-03-02」');
    expect(year).toContain('本平台取其中的年份');
    expect(year).toContain('区分不了');
    // The conclusion the genetic three draw from an exact mismatch, and
    // the one this pair may not be put through.
    expect(year).not.toContain('逐字比对');
    expect(year).not.toContain('不完全一致');
  });

  it('确诊年份是「记不清了」时不给它安一个来源', () => {
    const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
    const foundation = stored.foundation as Record<string, unknown>;
    const result = build({
      diagnosisDate: null,
      baseline: { ...stored, foundation: { ...foundation, diagnosisYear: '记不清了' } },
    } as Partial<PatientProfileDTO>);
    const item = itemOf(sectionOf(result, 'diagnosis'), 'diagnosis.year');

    expect(item?.value).toMatchObject({ answer: 'not_remembered' });
    // 记不清了 is an answer about the question, not a value with an
    // author: there is nothing for a report to have supplied and
    // nothing for the autofill to have written.
    expect(item?.provenanceZh).toBe('档案中的确诊年份；该栏位缺失时回退到确诊日期的年份部分');
  });

  it('确诊年份在没有基因证据文件时说的是「没有可读的文件」', () => {
    const result = build({
      documents: EXPORT_FIXTURE_PROFILE.documents.filter(
        (document) => document.documentType !== 'genetic_report',
      ),
    });
    const year = itemOf(sectionOf(result, 'diagnosis'), 'diagnosis.year')?.provenanceZh ?? '';
    expect(year).toContain('没有可作为这份档案基因证据来读的文件');
    expect(year).not.toContain('那一份没有诊断日期');
  });

  /**
   * 分型 HAS TWO STORES AND THE SENTENCE DESCRIBED ONE.
   *
   * `diagnosisTypeRawZh` resolves the baseline questionnaire's slot
   * first and `patient_profiles.genetic_mutation` after it, and the
   * provenance sentence described the first in every state: a value out
   * of the free-text column was exported under a paragraph about a box
   * that is empty, and the marker looked up beside it belonged to that
   * empty box. An administrator's name would have landed on a string
   * they never saw.
   */
  it('分型来自 genetic_mutation 列时，来源句说的是那一栏，且不套用基线栏位的标记', () => {
    const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
    const disease = { ...(stored.diseaseBackground as Record<string, unknown>) };
    delete disease.diagnosisType;
    const result = build({
      geneticMutation: 'FSHD1',
      baseline: {
        ...stored,
        diseaseBackground: disease,
        // A marker on the slot that is now EMPTY. It still rides the
        // envelope, because it describes the marker block; what it may
        // not do is describe the value on the page.
        [BASELINE_PROVENANCE_KEY]: {
          'diseaseBackground.diagnosisType': {
            source: 'admin_entered',
            adminUserId: ADMIN_ID,
            at: AT,
          },
        },
      },
      documents: [],
    } as Partial<PatientProfileDTO>);
    const item = itemOf(sectionOf(result, 'diagnosis'), 'diagnosis.type');

    // The value still exports — this is about the sentence, not about
    // dropping the column.
    expect(item?.value).toBe('FSHD1');
    const provenance = item?.provenanceZh ?? '';
    expect(provenance).toContain('不在基线问卷的分型栏位里');
    expect(provenance).toContain('基因突变自由文本栏');
    // The clause the baseline slot's value gets, and the marker that
    // goes with it, are both absent.
    expect(provenance).not.toContain('基线问卷为这一项提供输入框');
    expect(provenance).not.toContain('不是患者本人填写');
    // The marker itself is not hidden: it is what the envelope is for.
    expect(result.fieldOrigins.map((origin) => origin.path)).toContain(
      'diseaseBackground.diagnosisType',
    );

    // And the slot's own value keeps the sentence that is true of it,
    // so the two states differ rather than the column's wording taking
    // over everywhere.
    const fromSlot = itemOf(sectionOf(build(), 'diagnosis'), 'diagnosis.type')?.provenanceZh ?? '';
    expect(fromSlot).toContain('基线问卷为这一项提供输入框');
    expect(fromSlot).not.toContain('基因突变自由文本栏');
  });

  /**
   * 确诊年份 HAS TWO STORES TOO, AND SAID IT COULD NOT TELL THEM APART.
   *
   * The decoder prefers `foundation.diagnosisYear` and only falls back
   * to the year part of `patient_profiles.diagnosis_date` — so whenever
   * the fallback answers, the questionnaire's slot is EMPTY and 「患者在
   * 问卷里填的，还是某一次读取补上的，区分不了」 was this export
   * declining to state something it knows. `upsertBaseline` writes that
   * column from the slot on every save and clears it on every clear,
   * which is what makes the empty slot beside a full column a real
   * answer rather than a gap.
   */
  it('确诊年份取自确诊日期时，来源句说那一栏是空的，不再说自己区分不了问卷', () => {
    const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
    const foundation = { ...(stored.foundation as Record<string, unknown>) };
    delete foundation.diagnosisYear;
    const result = build({
      diagnosisDate: '2014-03-02',
      baseline: {
        ...stored,
        foundation,
        [BASELINE_PROVENANCE_KEY]: {
          'foundation.diagnosisYear': { source: 'admin_entered', adminUserId: ADMIN_ID, at: AT },
        },
      },
      documents: [],
    } as Partial<PatientProfileDTO>);
    const item = itemOf(sectionOf(result, 'diagnosis'), 'diagnosis.year');

    expect(item?.value).toMatchObject({ answer: 'known', year: 2014 });
    const provenance = item?.provenanceZh ?? '';
    expect(provenance).toContain('基线问卷的确诊年份栏位是空的');
    expect(provenance).toContain('不是问卷里填的答案');
    // The marker is about the empty slot, so it is not folded in here
    // either — and the envelope still carries it.
    expect(provenance).not.toContain('不是患者本人填写');
    expect(result.fieldOrigins.map((origin) => origin.path)).toContain('foundation.diagnosisYear');

    // The slot's own value keeps 区分不了, which is the whole of what is
    // known THERE: the box and the read-time autofill both write it.
    const fromSlot = itemOf(sectionOf(build(), 'diagnosis'), 'diagnosis.year')?.provenanceZh ?? '';
    expect(fromSlot).toContain('档案中基线问卷的确诊年份栏位');
    expect(fromSlot).not.toContain('不是问卷里填的答案');
  });

  /**
   * THE KEY IS WHAT A RECEIVER MAPS ON.
   *
   * The item was narrowed to 是否有基因报告 in its label and its
   * provenance, while `diagnosis.geneticallyConfirmed` stayed in the key
   * and 「is any document on file the laboratory's report」 stayed in the
   * value. A registry ingests the key and never reads the label, so it
   * received a confirmation claim for a profile whose passport, referral
   * pack and anesthesia card all read 未经基因确诊.
   */
  it('diagnosis.geneticallyConfirmed 答的是它的键说的那个问题', () => {
    const item = itemOf(sectionOf(build(), 'diagnosis'), 'diagnosis.geneticallyConfirmed');
    expect(item?.labelZh).toBe('是否基因确诊');
    expect(item?.value).toBe(true);

    // The state that separates 「a report is on file」 from 「the graded
    // evidence came off one」: a genetics report that read out nothing,
    // beside a 病历摘要 quoting the repeat count. The picker yields to
    // the transcription; the item may not report a confirmation.
    const transcribed = itemOf(
      sectionOf(
        build({
          documents: [
            {
              ...EXPORT_FIXTURE_PROFILE.documents[0],
              id: '88888888-8888-4888-8888-888888888881',
              documentType: 'genetic_report',
              status: 'parsed',
              ocrPayload: { fields: { reportTime: '2024-01-28' } },
            },
            {
              ...EXPORT_FIXTURE_PROFILE.documents[0],
              id: '88888888-8888-4888-8888-888888888883',
              documentType: 'medical_record',
              status: 'parsed',
              uploadedAt: '2024-03-01T06:00:00.000Z',
              ocrPayload: { fields: { d4z4Repeats: '5', haplotype: '4qA' } },
            },
          ] as PatientProfileDTO['documents'],
        } as Partial<PatientProfileDTO>),
        'diagnosis',
      ),
      'diagnosis.geneticallyConfirmed',
    );
    expect(transcribed?.value).toBe(false);
    // And the sentence says which document was read rather than denying
    // that a report exists — one is on file in exactly this state.
    expect(transcribed?.provenanceZh).toContain('转录自非基因报告文件');
    expect(transcribed?.provenanceZh).toContain('也不表示他手里没有报告');
  });

  /**
   * A dropdown is not evidence: the uploader picks a type from a menu
   * and the parser reads the page. Where they disagree the parser wins,
   * which is `isLaboratoryGeneticReport` — the same answer that ranks
   * the picker and grades the passport.
   */
  it('判定基因确诊时的文件类型以解析器为准，不是上传时选的那一项', () => {
    // 载荷里带着报告自己写的 检测方法，因为真的基因报告就带着它。
    // `isLaboratoryGeneticReport` 不再只认分类标签——关键词分类器是按
    // 文档里出现了多少基因词打分的，所以一份抄了结果的病历摘要同样会被
    // 判成基因报告，而这份 fixture 去掉方法这一格之后就正是那份病历摘要。
    // 区分两者的是页面本身长什么样，所以这里让它长出来。
    const withType = (documentType: string, classifiedType: string) =>
      itemOf(
        sectionOf(
          build({
            documents: [
              {
                ...EXPORT_FIXTURE_PROFILE.documents[0],
                documentType,
                ocrPayload: {
                  fields: {
                    classifiedType,
                    geneticTestMethod: 'southern_blot',
                    d4z4Repeats: '5',
                    haplotype: '4qA',
                  },
                },
              },
            ] as PatientProfileDTO['documents'],
          } as Partial<PatientProfileDTO>),
          'diagnosis',
        ),
        'diagnosis.geneticallyConfirmed',
      );

    expect(withType('genetic_report', 'medical_record')?.value).toBe(false);
    expect(withType('other', 'genetic_report')?.value).toBe(true);
    // A document the parse has not reached has no verdict to prefer, so
    // the declaration is what is left — and the sentence says so rather
    // than leaving a patient who picked that menu item without a
    // reason.
    expect(withType('other', 'genetic_report')?.provenanceZh).toContain(
      '解析器的判定为准，解析未落地时按上传时声明的类型',
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

/**
 * 诊断.haplotype IS THE FIELD A REGISTRY FILES AS THIS PATIENT'S
 * GENOTYPE, and it used to be whatever string the archive held.
 *
 * The archive holds what the read-time autofill put there, and what the
 * autofill puts there is the evidence report's cell as OCR read it. A
 * 4q 单倍型 cell can hold the laboratory's PROBES —「4qA/4qB」— and it
 * can hold a sentence saying the assay found nothing. This platform's
 * own parser refuses both: the passport prints them with 报告读取 in a
 * bracket and grades the profile as carrying no confirmatory result,
 * and every clinical surface says so. The export said nothing, in the
 * one place where 「未检出」 and a real allele name are indistinguishable
 * once ingested.
 *
 * The cases below are built the way a real profile reaches this module:
 * the report's cell in the archive, because the autofill has already
 * run by the time an export is built.
 */
describe('基因结果项：把读数和「本平台读不读得出结果」一起发出去', () => {
  const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
  const disease = stored.diseaseBackground as Record<string, unknown>;

  /** One laboratory report, with the same cells sitting in the archive
   *  — which is where `applyGeneticReportAutofill` puts them.
   *
   *  The overrides are handed back rather than built in place so a test
   *  can put the SAME profile through the clinical passport and this
   *  document, which is the only way to assert that the two carry one
   *  sentence rather than two. */
  const reportedProfile = (cells: { d4z4?: string; haplotype?: string }) =>
    ({
      baseline: {
        ...stored,
        diseaseBackground: {
          ...disease,
          d4z4: cells.d4z4 ?? null,
          haplotype: cells.haplotype ?? null,
        },
      },
      documents: [
        {
          ...EXPORT_FIXTURE_PROFILE.documents[0],
          documentType: 'genetic_report',
          status: 'parsed',
          ocrPayload: {
            fields: {
              ...(cells.d4z4 === undefined ? {} : { d4z4Repeats: cells.d4z4 }),
              ...(cells.haplotype === undefined ? {} : { haplotype: cells.haplotype }),
            },
          },
        },
      ],
    }) as Partial<PatientProfileDTO>;

  const reported = (cells: { d4z4?: string; haplotype?: string }) => build(reportedProfile(cells));

  const valueOf = (result: ReturnType<typeof build>, key: string) =>
    itemOf(sectionOf(result, 'diagnosis'), key)?.value;

  it('探针名不是单倍型 —— 原样发出，但不发成结果', () => {
    expect(valueOf(reported({ haplotype: '4qA/4qB' }), 'diagnosis.haplotype')).toEqual({
      recordedZh: '4qA/4qB',
      reading: 'no_result',
      readingZh: expect.stringContaining('读不出'),
      // 单倍型 has no guideline qualifier at all — see
      // GENETIC_RESULT_ITEMS. `toEqual` and not `toMatchObject` on
      // purpose: this item's whole shape is the assertion.
      qualifier: null,
    });
  });

  it('「未检出」不是单倍型，也不是重复单元数', () => {
    expect(valueOf(reported({ haplotype: '未检出' }), 'diagnosis.haplotype')).toMatchObject({
      recordedZh: '未检出',
      reading: 'no_result',
    });
    expect(valueOf(reported({ d4z4: '未检出' }), 'diagnosis.d4z4')).toMatchObject({
      recordedZh: '未检出',
      reading: 'no_result',
    });
  });

  it('区间是一个真实的发现，但不是一个重复单元数', () => {
    expect(valueOf(reported({ d4z4: '1-10' }), 'diagnosis.d4z4')).toMatchObject({
      recordedZh: '1-10',
      reading: 'no_result',
    });
  });

  /**
   * A LENGTH IN kb IS A MEASUREMENT AND IT IS NOT THIS ITEM'S. The
   * repeat-count cell parses to one unambiguous number either way, so a
   * check for 「the cell parses」 sent 「18kb」 to a registry as this
   * patient's D4Z4 重复单元数 — the item is written in repeat units, this
   * platform holds no boundary in kb to compare a length against, and
   * every clinical surface prints such a length with a sentence saying
   * it decided nothing.
   */
  it('报告上写成 kb 的长度不是重复单元数', () => {
    expect(valueOf(reported({ d4z4: '18kb' }), 'diagnosis.d4z4')).toMatchObject({
      recordedZh: '18kb',
      reading: 'no_result',
    });
  });

  /**
   * AND A 0 IS A READING SOMEBODY HAS TO GO AND CHECK. 0 repeat units
   * is not a viable FSHD1 allele, so it is neither a confirmation nor
   * an exclusion — it says the cell was misread or is about something
   * else. It parsed, so it went out as a count.
   */
  it('重复单元数读成 0 时，不发成这一项的结果', () => {
    expect(valueOf(reported({ d4z4: '0' }), 'diagnosis.d4z4')).toMatchObject({
      recordedZh: '0',
      reading: 'no_result',
    });
  });

  it('实验室确实读出结果时，就说读出来了', () => {
    const result = reported({ d4z4: '5', haplotype: '4qA' });
    expect(valueOf(result, 'diagnosis.haplotype')).toMatchObject({
      recordedZh: '4qA',
      reading: 'result',
    });
    expect(valueOf(result, 'diagnosis.d4z4')).toMatchObject({ recordedZh: '5', reading: 'result' });
    // 非允许型 is a result too. This item reports what the laboratory
    // determined; whether it supports the diagnosis is
    // diagnosis.geneticallyConfirmed, and its own sentence.
    expect(valueOf(reported({ haplotype: '4qB' }), 'diagnosis.haplotype')).toMatchObject({
      reading: 'result',
    });
  });

  /**
   * 「本平台读不出结果」 AND 「本平台没有读过这一行」 ARE DIFFERENT ANSWERS.
   * The first is a statement about the string; the second is a
   * statement about this platform. Merged, a repeat count a patient
   * typed into their own registration form — which no report on file
   * says anything about — would go out under a sentence calling it
   * unreadable.
   */
  it('档案里的值不是本平台读到的那一行时，说的是「没读过」而不是「读不出」', () => {
    const typedByPatient = build({
      baseline: { ...stored, diseaseBackground: { ...disease, d4z4: '5 个重复单元' } },
      documents: [],
    } as Partial<PatientProfileDTO>);

    expect(valueOf(typedByPatient, 'diagnosis.d4z4')).toMatchObject({
      recordedZh: '5 个重复单元',
      reading: 'not_read',
    });
  });

  it('档案里没有这一项时，整条不发 —— 不发成一个空结果', () => {
    const nothing = build({
      baseline: { ...stored, diseaseBackground: { ...disease, d4z4: null, haplotype: null } },
      documents: [],
    } as Partial<PatientProfileDTO>);

    expect(valueOf(nothing, 'diagnosis.haplotype')).toBeUndefined();
    expect(valueOf(nothing, 'diagnosis.d4z4')).toBeUndefined();
  });

  /**
   * 甲基化 IS DELIBERATELY NOT ONE OF THESE. No gate on this platform
   * reads it and no parser refuses it, so there is no reading to
   * report and inventing one here would be this module answering a
   * question nothing else asks.
   */
  it('甲基化仍然是一个字符串，因为本平台对它没有判读', () => {
    const withMethylation = build({
      baseline: { ...stored, diseaseBackground: { ...disease, methylation: '32%' } },
    } as Partial<PatientProfileDTO>);

    expect(valueOf(withMethylation, 'diagnosis.methylation')).toBe('32%');
  });

  /**
   * THE 8–10 UNIT GRAY ZONE REACHED EVERY SURFACE EXCEPT THIS ONE.
   *
   * The passport DTO, the markdown export, the share page, the mobile
   * PDF and the referral pack all print it, off the same
   * `buildClinicalPassportSummary` this document is normalised from —
   * and this item went out as the bare integer. So the patient's own
   * phone said 「这一项结果本身带着不确定性」 and the registry ingesting
   * the same profile in the same run was told 9 and nothing else. The
   * receiver who can act on the uncertainty was the only one not told.
   */
  it('灰区里的重复数，发出去时带着指南的限定', () => {
    const value = valueOf(reported({ d4z4: '9', haplotype: '4qA' }), 'diagnosis.d4z4');
    expect(value).toMatchObject({
      recordedZh: '9',
      reading: 'result',
      qualifier: { kind: 'grey_zone_8_10', noteZh: expect.stringContaining('8–10 单元灰区') },
    });
    // The same sentence the patient's own passport carries, not a
    // second one written here.
    expect((value as { qualifier: { noteZh: string } }).qualifier.noteZh).toBe(
      buildClinicalPassportSummary({
        ...EXPORT_FIXTURE_PROFILE,
        ...reportedProfile({ d4z4: '9', haplotype: '4qA' }),
      }).diagnosis.geneticEvidence.greyZoneNote,
    );
  });

  /**
   * AND THE ZONE IS NOT RE-DERIVED HERE, so every condition the
   * passport puts on it holds in this document too. 4qB is the one
   * that would be easiest to lose: the range is stated for 4qA arrays,
   * and a qualifier computed from the number alone would tell a trial
   * site that a non-permissive report is borderline-positive.
   */
  it('同样是 9，但报告写的是 4qB —— 不带灰区限定', () => {
    expect(valueOf(reported({ d4z4: '9', haplotype: '4qB' }), 'diagnosis.d4z4')).toMatchObject({
      recordedZh: '9',
      reading: 'result',
      qualifier: null,
    });
  });

  it('区间外的重复数不带限定', () => {
    for (const d4z4 of ['5', '12']) {
      expect(valueOf(reported({ d4z4, haplotype: '4qA' }), 'diagnosis.d4z4')).toMatchObject({
        recordedZh: d4z4,
        reading: 'result',
        qualifier: null,
      });
    }
  });

  /**
   * A QUALIFIER IS A VERDICT ON A RESULT, so there is none where this
   * document has just said it never read the line. The zone flag is
   * the passport's reading of the cell on the evidence REPORT; hung
   * off an archived string that differs from it, it would attribute
   * the guideline's verdict to the wrong number.
   */
  it('档案里的值不是本平台读到的那一行时，不挂灰区限定', () => {
    const mismatch = build({
      baseline: { ...stored, diseaseBackground: { ...disease, d4z4: '9 个重复单元' } },
      documents: [
        {
          ...EXPORT_FIXTURE_PROFILE.documents[0],
          documentType: 'genetic_report',
          status: 'parsed',
          ocrPayload: { fields: { d4z4Repeats: '9', haplotype: '4qA' } },
        },
      ],
    } as Partial<PatientProfileDTO>);

    expect(valueOf(mismatch, 'diagnosis.d4z4')).toMatchObject({
      reading: 'not_read',
      qualifier: null,
    });
  });
});

/**
 * THE READINGS THIS SECTION USED TO HAVE NO ITEM FOR.
 *
 * 分型, D4Z4 重复数, 单倍型 and 甲基化 all reach this section by way of
 * the archive, because each has a baseline slot the read-time autofill
 * tops up. The EcoRI fragment has none — no form on this platform draws
 * a box for it and the autofill has no field to write — so it could not
 * reach this section at all, and it was in neither of the other two
 * portable exports either. For a report that states its length in kb
 * and gives no repeat count that fragment is the ONLY size measurement
 * the laboratory made, and it appears on the passport, the markdown
 * export, the share page and the referral pack, each with a sentence
 * saying it is displayed and not judged.
 *
 * 甲基化 DID travel here, as a bare string — the FSHD2 discriminator,
 * filed under a key a registry maps as a graded result, with nothing
 * beside it saying that nothing on this platform grades it.
 */
describe('TREAT-NMD —— EcoRI 片段进来了，甲基化带上了「没有判读界限」', () => {
  const geneticReport = (cells: Record<string, string>) => ({
    ...EXPORT_FIXTURE_PROFILE.documents[0],
    ocrPayload: { fields: { reportTime: '2024-01-28', ...cells } },
  });

  /* The archive's genetic slots start EMPTY and the read-time autofill
   * fills them off the report, which is what `getProfileByUserId` does
   * before any exporter sees the profile. Without that the shared
   * fixture's own hand-typed 「5 个重复单元」 would answer instead of the
   * cells under test, and this section reads the archive. */
  const reported = (cells: Record<string, string>) => {
    const base: PatientProfileDTO = {
      ...EXPORT_FIXTURE_PROFILE,
      baseline: {
        ...(EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>),
        diseaseBackground: {
          ...((EXPORT_FIXTURE_PROFILE.baseline as Record<string, Record<string, unknown>>)
            .diseaseBackground ?? {}),
          diagnosisType: null,
          d4z4: null,
          haplotype: null,
          methylation: null,
        },
      },
      geneticMutation: null,
      documents: [geneticReport(cells), ...EXPORT_FIXTURE_PROFILE.documents.slice(1)],
    };
    const filled = { ...base, ...applyGeneticReportAutofill(base, base.documents) };
    return sectionOf(build(filled as PatientProfileDTO), 'diagnosis');
  };

  it('只有 kb 长度的报告，本节仍然带着实验室做过的那一次测量', () => {
    const diagnosis = reported({ ecoRIFragment: '18 kb', haplotype: '4qA' });
    expect(itemOf(diagnosis, 'diagnosis.ecoRIFragment')?.value).toBe('18 kb');
    expect(itemOf(diagnosis, 'diagnosis.d4z4')).toBeUndefined();
  });

  /* Every other sentence in this section describes an archived string,
   * so this one opens by saying there is no archived string to compare
   * against — otherwise a reader carries the assumption over. */
  it('说清楚这一项不在档案里，也说清楚本平台没有判断过它', () => {
    const provenance =
      itemOf(reported({ ecoRIFragment: '18 kb', haplotype: '4qA' }), 'diagnosis.ecoRIFragment')
        ?.provenanceZh ?? '';
    expect(provenance).toContain('这一项不在本平台的档案里');
    expect(provenance).toContain('不在 kb 和重复单元数之间做换算');
  });

  it('报告没有片段那一格时，不发这个 item', () => {
    expect(
      itemOf(reported({ d4z4Repeats: '5', haplotype: '4qA' }), 'diagnosis.ecoRIFragment'),
    ).toBeUndefined();
  });

  it('甲基化的来源说明里带着「本平台没有判读界限」，指南那一条交给医生', () => {
    const provenance =
      itemOf(
        reported({ d4z4Repeats: '30', haplotype: '4qA', methylationValue: '32%' }),
        'diagnosis.methylation',
      )?.provenanceZh ?? '';
    expect(provenance).toContain('没有任何判读界限');
    expect(provenance).toContain('SMCHD1');
    expect(provenance).toContain('由医生看着报告原件说');
  });
});

/**
 * `diagnosis.type` IS THE ARCHIVE'S, AND THE KEY IS WHAT A RECEIVER
 * MAPS ON.
 *
 * Its provenance sentence has always said when the evidence document
 * reads otherwise — in prose, which a registry ingesting the key never
 * parses. So over a profile whose questionnaire says FSHD1 and whose
 * genetics report reads FSHD2 (ordinary: the read-time autofill only
 * fills an EMPTY slot) this document filed FSHD1 while the patient's
 * passport, share page, referral pack and anaesthesia card said FSHD2,
 * and so did the FHIR `Condition` and the Phenopacket `Disease.term`.
 */
describe('TREAT-NMD —— 报告上的分型有自己的 key', () => {
  const reportSaysFshd2 = {
    ...EXPORT_FIXTURE_PROFILE.documents[0],
    ocrPayload: { fields: { reportTime: '2024-01-28', diagnosisType: 'FSHD2' } },
  };

  const mismatched = () => {
    const base: PatientProfileDTO = {
      ...EXPORT_FIXTURE_PROFILE,
      documents: [reportSaysFshd2, ...EXPORT_FIXTURE_PROFILE.documents.slice(1)],
    };
    return { ...base, ...applyGeneticReportAutofill(base, base.documents) } as PatientProfileDTO;
  };

  it('档案值和报告值各自有 key，两个都在', () => {
    const diagnosis = sectionOf(build(mismatched()), 'diagnosis');
    expect(itemOf(diagnosis, 'diagnosis.type')?.value).toBe('FSHD1');
    expect(itemOf(diagnosis, 'diagnosis.typeFromGeneticEvidence')?.value).toBe('FSHD2');
  });

  /** An absent item says the report was asked and answered nothing —
   *  which is what `diagnosis.type`'s own provenance sentence already
   *  says in words. A null value would say something else. */
  it('报告上没有分型那一项时，这个 item 不出现', () => {
    const diagnosis = sectionOf(build(), 'diagnosis');
    expect(itemOf(diagnosis, 'diagnosis.typeFromGeneticEvidence')).toBeUndefined();
  });
});

/**
 * The sweep's other half: what the clinical passport's 诊断 block holds
 * that this section does not carry is DECLARED rather than dropped. An
 * omissions list that declares some gaps and not others reads as a
 * complete one.
 */
describe('TREAT-NMD —— 护照上有、本导出没有的，写进 omissions', () => {
  it('分级、检查申请说明、检测方法与诊断进度，都在 omissions 里点名', () => {
    const reason =
      build().omissions.find((entry) => entry.field.includes('sections.diagnosis'))?.reasonZh ?? '';
    expect(reason).toContain('分级');
    expect(reason).toContain('检查申请说明');
    expect(reason).toContain('检测方法');
    expect(reason).toContain('诊断进度');
  });

  it('本导出不含文件清单，所以说明基因读数出自哪一份、有多旧要去别处看', () => {
    const reason =
      build().omissions.find((entry) => entry.field.includes('有多旧'))?.reasonZh ?? '';
    expect(reason).toContain('DocumentReference.date');
    expect(reason).toContain('files[].fileAttributes.uploadedAt');
  });
});
