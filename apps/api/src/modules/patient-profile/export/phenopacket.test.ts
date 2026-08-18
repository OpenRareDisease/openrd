import { describe, expect, it } from 'vitest';

import { EXPORT_FIXTURE_PROFILE, FIXTURE_GENERATED_AT } from './__fixtures__/profile.fixture.js';
import { ambulationSentences, locatorsIn } from './__fixtures__/reason-claims.js';
import { normaliseSource } from './export-source.js';
import { BASELINE_PROVENANCE_KEY } from '../baseline-provenance.js';
import { applyGeneticReportAutofill } from '../profile.autofill.js';
import { AMBULATION_LABELS } from './labels.js';
import { buildPhenopacketExport, toPhenopacketSex } from './phenopacket.js';
import type { PatientProfileDTO } from '../profile.service.js';

const build = (overrides: Partial<PatientProfileDTO> = {}, includeLocalOnly = false) =>
  buildPhenopacketExport(
    normaliseSource(
      { ...EXPORT_FIXTURE_PROFILE, ...overrides },
      { includeLocalOnly, generatedAt: FIXTURE_GENERATED_AT },
    ),
  );

const withDiagnosisType = (diagnosisType: string | null): Partial<PatientProfileDTO> => ({
  baseline: {
    ...(EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>),
    diseaseBackground: { diagnosisType },
  },
  geneticMutation: null,
});

describe('Phenopacket v2 — only verified ontology terms', () => {
  it('emits the FSHD1 disease term with the OMIM id verified in this repo', () => {
    const result = build();
    expect(result.document.diseases).toEqual([
      {
        term: {
          id: 'OMIM:158900',
          label: 'Facioscapulohumeral muscular dystrophy 1 (FSHD1)',
        },
      },
    ]);
    expect(result.codingProvenance.emitted[0].verifiedAgainst[0]).toContain(
      'content/medical-kb/source/',
    );
  });

  it('emits FSHD2 as its own OMIM entry', () => {
    expect(build(withDiagnosisType('FSHD2')).document.diseases?.[0].term.id).toBe('OMIM:158901');
  });

  it('omits `diseases` entirely rather than defaulting an unknown subtype to FSHD1', () => {
    const result = build(withDiagnosisType(null));
    expect(result.document.diseases).toBeUndefined();
    const omission = result.omissions.find((entry) => entry.field === 'diseases');
    expect(omission?.reasonZh).toContain('不是默认写成最常见的 1 型');
    // With no disease term there is no OMIM resource to declare
    // either — a resources entry for a vocabulary we did not use
    // would be a false statement about the packet's dependencies.
    expect(result.document.metaData.resources).toEqual([]);
  });

  it('records that measurements and phenotypic features were withheld for lack of a code', () => {
    const fields = build().omissions.map((entry) => entry.field);
    expect(fields).toContain('measurements');
    expect(fields).toContain('phenotypicFeatures');
    // The counts matter: the receiver has to know data EXISTS and was
    // withheld, not that the patient has no findings.
    const measurements = build().omissions.find((entry) => entry.field === 'measurements');
    expect(measurements?.reasonZh).toContain('2 条肌力记录');
  });

  it('leaves an OMIM release version empty rather than inventing one', () => {
    expect(build().document.metaData.resources[0].version).toBe('');
  });
});

/**
 * A `Disease.term` IS NOT A CONFIRMATION, AND THE PACKET HAS NOWHERE TO
 * SAY SO.
 *
 * The v2 `Disease` message carries `term` and `excluded` and nothing
 * that records how the diagnosis was established — and `excluded`
 * means RULED OUT, so its default false is not a confirmation either.
 * The packet therefore emitted one identical term for a genetically
 * confirmed patient and for a patient whose repeat count this platform
 * read off a 病历摘要, with nothing in the envelope separating them.
 * The FHIR bundle answers this on `Condition.verificationStatus`; this
 * is the same answer in the one place this format leaves for it.
 */
describe('Phenopacket v2 — 一个 Disease.term 不表示基因确诊', () => {
  const transcription: PatientProfileDTO['documents'][number] = {
    ...EXPORT_FIXTURE_PROFILE.documents[0],
    id: '88888888-8888-4888-8888-888888888899',
    documentType: 'medical_summary',
    ocrPayload: {
      fields: { classifiedType: 'medical_summary', d4z4Repeats: '9', haplotype: '4qB' },
    },
  };

  /* The exact field, not a `startsWith('diseases[]')` prefix. A second
   * omission on the same prefix — `diseases[].term（分型取自何处）`, which
   * says which string this packet's ontology term was classified from —
   * now sits ahead of this one, and a prefix match silently retargeted
   * every assertion below onto it. */
  const DIAGNOSIS_BASIS_OMISSION_FIELD = 'diseases[].term（诊断依据）';

  const basisOf = (overrides: Partial<PatientProfileDTO> = {}) =>
    build(overrides).omissions.find((entry) => entry.field === DIAGNOSIS_BASIS_OMISSION_FIELD)
      ?.reasonZh ?? '';

  it('每次写出 Disease 都同时声明这个字段说不了诊断依据', () => {
    const result = build();
    expect(result.document.diseases).toHaveLength(1);
    const basis = basisOf();
    expect(basis).toContain('没有记录「这个诊断是怎么确立的」的位置');
    expect(basis).toContain('不表示基因确诊');
    // `excluded` is the slot a reader would otherwise reach for, so the
    // sentence says what it actually means rather than leaving it.
    expect(basis).toContain('excluded 表示「已排除该病」');
  });

  it('三种状态说三句不同的话 —— 读的是报告 / 读的是转录件 / 什么都没读', () => {
    const laboratory = basisOf();
    const transcribed = basisOf({ documents: [transcription] });
    const nothing = basisOf({ documents: [] });

    expect(laboratory).toContain('本平台读作这份档案基因证据的那一份是基因检测报告');

    // The transcription state names the document class in the phrase
    // every other surface uses, so a registry holding this beside the
    // TREAT-NMD export reads one claim and not two wordings of one.
    expect(transcribed).toContain('转录自非基因报告文件');

    // And 「read a transcription」 is not merged with 「read nothing」: one
    // says this platform holds a number it may not speak for, the other
    // that it holds none. Merging them sends a registry asking after a
    // document that does not exist.
    expect(nothing).toContain('本平台此刻没有可作为这份档案基因证据来读的文件');
    expect(nothing).not.toContain('转录自非基因报告文件');

    expect(new Set([laboratory, transcribed, nothing]).size).toBe(3);
  });

  /**
   * THE DISCLOSURE BRANCHED ON THE WRONG HALF OF THE STATE SPACE.
   *
   * It asked 「is a report on file」 before it asked which document was
   * read, so the transcription warning was written only where no report
   * existed — where there is no transcription to warn about — and went
   * silent in the state it was written for: a genetics report on file
   * that read out nothing is exactly when the picker falls through to a
   * 病历摘要, and that packet named a laboratory report and said nothing
   * about the page the numbers came off.
   */
  it('报告在档但读出来的是转录件时，转录声明照发', () => {
    const basis = basisOf({
      documents: [
        {
          ...EXPORT_FIXTURE_PROFILE.documents[0],
          id: '88888888-8888-4888-8888-888888888881',
          documentType: 'genetic_report',
          status: 'parsed',
          ocrPayload: { fields: { reportTime: '2024-01-28' } },
        },
        { ...transcription, uploadedAt: '2024-03-01T06:00:00.000Z' },
      ] as PatientProfileDTO['documents'],
    });

    expect(basis).toContain('转录自非基因报告文件');
    expect(basis).not.toContain('本平台读作这份档案基因证据的那一份是基因检测报告');
    // And the headline claim is the one the FHIR bundle and the
    // TREAT-NMD item carry for the same profile.
    expect(basis).toContain('本平台没有把这份档案判定为基因确诊');
  });

  it('没有可写的 Disease 时不发这条声明 —— 它说的是本文件里的那个 term', () => {
    const result = build(withDiagnosisType(null));
    expect(result.document.diseases).toBeUndefined();
    expect(result.omissions.some((entry) => entry.field.startsWith('diseases[]'))).toBe(false);
    // The other 'diseases' omission is the one that applies there.
    expect(result.omissions.some((entry) => entry.field === 'diseases')).toBe(true);
  });
});

describe('Phenopacket v2 — FSHD1 is not a sequence variant', () => {
  it('never emits interpretations, and says why', () => {
    const result = build();
    expect('interpretations' in result.document).toBe(false);
    const omission = result.omissions.find((entry) => entry.field === 'interpretations');
    expect(omission?.reasonZh).toContain('D4Z4');
    expect(omission?.reasonZh).toContain('不是 DUX4 的序列变异');
  });

  it('does not mention DUX4 as a studied gene anywhere in the packet', () => {
    // The exact defect the lane warned about: stuffing DUX4 into
    // gene-studied so a genomics profile validates.
    const serialised = JSON.stringify(build().document);
    expect(serialised).not.toContain('DUX4');
    expect(serialised).not.toContain('geneContext');
    expect(serialised).not.toContain('gene-studied');
  });
});

describe('Phenopacket v2 — subject', () => {
  it('maps sex without turning a privacy choice into a characteristic', () => {
    expect(toPhenopacketSex('female')).toBe('FEMALE');
    expect(toPhenopacketSex('male')).toBe('MALE');
    expect(toPhenopacketSex('non_binary')).toBe('OTHER_SEX');
    // Declining to answer is not a statement about sex.
    expect(toPhenopacketSex('prefer_not_to_say')).toBe('UNKNOWN_SEX');
    expect(toPhenopacketSex(null)).toBe('UNKNOWN_SEX');
  });

  it('carries no direct identifier, even in the local-only variant', () => {
    const serialised = JSON.stringify(build({}, true));
    expect(serialised).not.toContain('张小雨');
    expect(serialised).not.toContain('13800000000');
    expect(serialised).not.toContain('李医生');
  });
});

describe('Phenopacket v2 — files', () => {
  it('points at the API path and never at the object-store URI', () => {
    const files = build().document.files ?? [];
    expect(files).toHaveLength(2);
    files.forEach((file) => {
      expect(file.uri.startsWith('/patient-profiles/me/documents/')).toBe(true);
    });
    expect(JSON.stringify(build())).not.toContain('local://uploads');
  });

  it('omits a null title instead of stringifying it', () => {
    const result = build({
      documents: [{ ...EXPORT_FIXTURE_PROFILE.documents[0], title: null, mimeType: null }],
    });
    const attributes = result.document.files?.[0].fileAttributes ?? {};
    expect(Object.keys(attributes).sort()).toEqual(['documentType', 'uploadedAt']);
    expect(JSON.stringify(attributes)).not.toContain('null');
  });

  it('omits the files array entirely when there are no documents', () => {
    expect(build({ documents: [] }).document.files).toBeUndefined();
  });
});

describe('Phenopacket v2 — held-but-unemitted instruments are declared', () => {
  it('names Brooke and Vignos among the omissions', () => {
    const omission = build().omissions.find((entry) => entry.field.includes('Brooke'));
    expect(omission?.reasonZh).toContain('Vignos');
    expect(omission?.reasonZh).toContain('不表示患者没有做过分级');
  });

  it('has nowhere for a walking state to be, whatever the baseline says', () => {
    // Structural ground truth for the omission. The packet's whole
    // shape is asserted, so 「there is no mobility data in it」 is read
    // off the document rather than inferred from a character being
    // absent — the previous `not.toContain('行走')` passed only because
    // the fixture's walk test is spelt 步行, and would have gone red on
    // a fixture change that altered nothing in production.
    expect(Object.keys(build().document).sort()).toEqual([
      'diseases',
      'files',
      'id',
      'metaData',
      'subject',
    ]);
    Object.entries(AMBULATION_LABELS).forEach(([value, labelZh]) => {
      const serialised = JSON.stringify(
        build({
          baseline: {
            ...(EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>),
            currentStatus: {
              ...(EXPORT_FIXTURE_PROFILE.baseline as { currentStatus: Record<string, unknown> })
                .currentStatus,
              independentlyAmbulatory: value,
            },
          },
        }).document,
      );
      expect(serialised, value).not.toContain(value);
      expect(serialised, labelZh).not.toContain(labelZh);
    });
  });

  it('does not tell the receiver a walking state is somewhere in a packet that has none', () => {
    const result = build();
    const reason = result.omissions.find((entry) => entry.field.includes('Brooke'))?.reasonZh ?? '';
    // EVERY omission this packet carries, not the Brooke one alone: the
    // packet has four, and reading one of them is how the same claim
    // written into a neighbouring reason would ship green.
    const claims = result.omissions.flatMap((entry) => ambulationSentences(entry.reasonZh));
    // The shared wording used to end 「…会出现在运动功能一节」 — true of
    // TREAT-NMD, and describing nothing that exists here. Its
    // replacement guard pinned that phrase, so a new sentence making
    // the same claim in other words stayed green. So this is the
    // exhaustive list of sentences that name the walking state in one
    // of AMBULATION_SUBJECT's words: the shared instrument prefix,
    // which names Vignos and 运动功能 and claims nothing about this
    // packet, then the denial, then the redirect. One more makes this
    // array longer whatever it says.
    //
    // The redirect — 「需要行走状态请向患者索取，或改用 TREAT-NMD 对齐
    // 导出」 — points AWAY from this packet. It is listed rather than
    // filtered: the filter that used to drop it keyed on a
    // demonstrative, and a claim about this packet written without one
    // — 「基线行走状态会作为 Observation 一并导出。」 — was dropped with it.
    //
    // By EXACT STRING, not `expect.stringContaining`: a substring
    // matcher makes every approved entry a place to hang a false clause
    // on with ，or ；, and `sentencesOf` splits on 。 only, so the array
    // stays the same length and the whole suite stays green.
    expect(claims).toEqual([
      '本平台采集 Brooke 上肢功能分级与 Vignos 下肢功能分级（见 /me/instruments），但这两项尚未接入本导出所读取的档案结构，因此本次导出不含任何分级数值、施测时间或量表版本',
      '这是导出管线的缺口，不表示患者没有做过分级——在本记录的全部内容里，这两项通常是唯一可跨患者比较的运动功能测量，需要时请直接向患者索取',
      '本文件不含任何行走能力或运动功能数据：即使患者在填写 Vignos 时选择了同步到基线，基线里的行走状态也不会出现在本文件的任何位置',
      '需要行走状态请向患者索取，或改用 TREAT-NMD 对齐导出',
    ]);
    // And no locator may point into a document that has no sections.
    expect(locatorsIn(reason)).toEqual([]);
  });
});

/** The provenance block an administrator's edit actually leaves on
 *  disk, built with the real write helper. */
const adminEdited = (): Partial<PatientProfileDTO> => {
  const stored = EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>;
  const disease = stored.diseaseBackground as Record<string, unknown>;
  const foundation = stored.foundation as Record<string, unknown>;
  const marker = {
    source: 'admin_entered',
    adminUserId: '11111111-2222-3333-4444-555555555555',
    at: '2026-08-13T04:11:07.912Z',
  };
  // 确诊年份 stays reachable through the back office; the 分型 marker is
  // written by hand because the helper refuses every genetic path now.
  // Profiles written before that carry one, and an exporter that dropped
  // it would be a silent regression against real stored data.
  return {
    baseline: {
      ...stored,
      foundation: { ...foundation, diagnosisYear: 2016 },
      diseaseBackground: { ...disease, diagnosisType: 'FSHD2' },
      [BASELINE_PROVENANCE_KEY]: {
        'foundation.diagnosisYear': marker,
        'diseaseBackground.diagnosisType': marker,
      },
    },
  };
};

/**
 * Contract §B3. A Phenopacket is protobuf-with-a-JSON-mapping and has
 * no message field for 「this answer was typed by our staff」, so the
 * marker rides the envelope rather than being dropped or smuggled into
 * the document as a non-conformant key.
 */
describe('Phenopacket — §B3：管理员代填的值要跟着导出走', () => {
  it('信封逐条列出代填的字段', () => {
    const marked = build(adminEdited());
    expect(marked.fieldOrigins.map((origin) => origin.path)).toEqual([
      'diseaseBackground.diagnosisType',
      'foundation.diagnosisYear',
    ]);
    expect(marked.notes.字段来源).toContain('确诊年份');
  });

  it('没有标记时说的是「没有代填」，不是沉默', () => {
    expect(build().fieldOrigins).toEqual([]);
    expect(build().notes.字段来源).toContain('没有本平台工作人员代填');
  });
});

/**
 * `Disease.term` IS THE ONLY MACHINE-USABLE CLINICAL ASSERTION THIS
 * PACKET MAKES, and it used to be classified out of the ARCHIVE while
 * every patient- and clinician-facing surface resolved the evidence
 * document's own 分型 cell first. The two disagree over an ordinary
 * profile — `applyGeneticReportAutofill` fills an EMPTY archive slot
 * and never corrects a full one, so a questionnaire answered before the
 * corrected report was uploaded keeps its answer forever — and this
 * packet then filed the patient under OMIM:158900 while their passport,
 * share page, referral pack and anaesthesia card all said FSHD2. FSHD1
 * is a contracted D4Z4 array on a permissive 4qA allele; FSHD2 is a
 * different mechanism, and a cohort assembled on this term inherits the
 * error with nothing in the file to catch it.
 */
describe('Phenopacket v2 —— Disease.term 跟着报告，不跟着旧问卷答案', () => {
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

  const sourceOmissionOf = (result: ReturnType<typeof build>) =>
    result.omissions.find((entry) => entry.field.includes('分型取自何处'))?.reasonZh ?? '';

  it('报告写 FSHD2、问卷写 FSHD1 时，写出的本体项是 FSHD2', () => {
    expect(build(mismatched()).document.diseases).toEqual([
      {
        term: { id: 'OMIM:158901', label: 'Facioscapulohumeral muscular dystrophy 2 (FSHD2)' },
      },
    ]);
  });

  /* `Disease` has no note slot anywhere in the v2 schema, so the
   * omissions list is where this format says it — the same sentence the
   * FHIR bundle sets on `Condition.note`, so a receiver holding both
   * reads one account and not two wordings of one. */
  it('档案里那个不一样的值也写出来，并且指明它在哪一份导出里', () => {
    const reason = sourceOmissionOf(build(mismatched()));
    expect(reason).toContain('FSHD2');
    expect(reason).toContain('FSHD1');
    expect(reason).toContain('不一致');
    expect(reason).toContain('diagnosis.type');
  });

  it('报告没有分型那一项时，说清楚本体项是从档案值归一来的', () => {
    const reason = sourceOmissionOf(build());
    expect(reason).toContain('档案里记录的「FSHD1」');
    expect(reason).toContain('那一份上没有这一项');
  });

  /**
   * The `interpretations` omission used to end 「D4Z4 重复数与单倍型在
   * TREAT-NMD 对齐导出中按其本来面目呈现」 — a two-item list of a
   * four-member set. 甲基化 travelled to TREAT-NMD unnamed here, and the
   * EcoRI fragment travelled to no portable export at all and was named
   * nowhere. A receiver reading that sentence and finding a 4qA
   * haplotype with no size measurement could not tell 「this patient has
   * none」 from 「this document does not carry it」.
   */
  it('不承载读数这件事说全了四项，不只说两项', () => {
    const reason =
      build().omissions.find((entry) => entry.field.includes('基因报告上的读数'))?.reasonZh ?? '';
    for (const cell of ['D4Z4 重复单元数', '4q 单倍型', 'EcoRI 片段', '甲基化']) {
      expect(reason, cell).toContain(cell);
    }
    expect(reason).toContain('不要因为本文件里没有这些数据就认为患者没有做过这些检测');
  });
});
