import { describe, expect, it } from 'vitest';

import { EXPORT_FIXTURE_PROFILE, FIXTURE_GENERATED_AT } from './__fixtures__/profile.fixture.js';
import { ambulationSentences, locatorsIn } from './__fixtures__/reason-claims.js';
import { normaliseSource } from './export-source.js';
import { BASELINE_PROVENANCE_KEY } from '../baseline-provenance.js';
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
