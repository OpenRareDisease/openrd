import { describe, expect, it } from 'vitest';

import type { PatientProfileDTO } from './profile.service.js';
import {
  REFERRAL_MAX_POINTS_PER_SERIES,
  REFERRAL_PROVENANCE_NOTE,
  buildReferralPack,
} from './referral-pack.js';

/**
 * What these tests are actually guarding.
 *
 * The pack is one page that leaves the app and lands in front of a
 * neurologist. Nothing on it can be checked by the reader against the
 * patient in the ten seconds they have, so every collapse this file
 * asserts against is a false statement made to someone who will act on
 * it:
 *
 *   - 「上传了但读不出」 rendered as 「没做过」 (the same collapse
 *     PassportMonitoringItemDTO.state and the anesthesia card exist to
 *     prevent, one reader further along the chain).
 *   - 「当天做不了」 rendered as a missing row. Migration 017 separated
 *     these in the database; a serialiser that drops `notApplicable`
 *     rows undoes that at the last step.
 *   - 「基线问卷里一项都没勾」 rendered as 「无辅具」, and 「从来没填过」
 *     rendered as either of the other two.
 *   - 「开始使用轮椅（2023-04）」 rendered as a present-tense device.
 *   - a self-reported diagnosis rendered in the same register as a
 *     genetic one.
 *
 * Every fixture timestamp is midday UTC, not midnight. The pack formats
 * dates with local-time accessors (deliberately — see `formatDate` in
 * referral-pack.ts), so a midnight-UTC fixture prints as the previous
 * day on any machine west of Greenwich and these tests would pass or
 * fail depending on where they run. Midday absorbs every real offset.
 */

const base = (over: Partial<PatientProfileDTO> = {}): PatientProfileDTO =>
  ({
    id: 'p1',
    userId: 'u1',
    fullName: '张三',
    preferredName: null,
    dateOfBirth: '1990-01-01',
    gender: 'male',
    patientCode: 'P0001',
    diagnosisStage: null,
    diagnosisDate: null,
    geneticMutation: null,
    heightCm: null,
    weightKg: null,
    bloodType: null,
    contactPhone: null,
    contactEmail: null,
    primaryPhysician: null,
    regionProvince: null,
    regionCity: null,
    regionDistrict: null,
    baseline: null,
    notes: null,
    measurements: [],
    functionTests: [],
    symptomScores: [],
    dailyImpacts: [],
    followupEvents: [],
    activityLogs: [],
    documents: [],
    medications: [],
    createdAt: '2026-01-01T12:00:00.000Z',
    updatedAt: '2026-01-01T12:00:00.000Z',
    ...over,
  }) as unknown as PatientProfileDTO;

const functionTest = (over: Record<string, unknown>) =>
  ({
    id: `ft-${Math.random()}`,
    testType: 'ten_meter_walk',
    measuredValue: 12.5,
    side: null,
    protocol: null,
    unit: 'sec',
    deviceUsed: null,
    assistanceRequired: null,
    notes: null,
    performedAt: '2026-03-01T12:00:00.000Z',
    createdAt: '2026-03-01T12:00:00.000Z',
    ...over,
  }) as unknown as PatientProfileDTO['functionTests'][number];

const followupEvent = (over: Record<string, unknown>) =>
  ({
    id: `ev-${Math.random()}`,
    eventType: 'started_wheelchair',
    severity: null,
    occurredAt: '2024-04-01T12:00:00.000Z',
    resolvedAt: null,
    description: null,
    linkedDocumentId: null,
    createdAt: '2024-04-01T12:00:00.000Z',
    submissionId: null,
    ...over,
  }) as unknown as PatientProfileDTO['followupEvents'][number];

const geneticReport = (fields: Record<string, string>) =>
  ({
    id: 'doc-gene',
    documentType: 'genetic_report',
    title: null,
    fileName: 'g.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: 1,
    storageUri: 'local://g',
    status: 'parsed',
    uploadedAt: '2026-02-01T12:00:00.000Z',
    checksum: null,
    submissionId: null,
    ocrPayload: { fields: { classifiedType: 'genetic_report', ...fields } },
  }) as unknown as PatientProfileDTO['documents'][number];

/** A report of a class the passport recognises, with nothing readable
 *  in it. Produces the `unreadable` monitoring state. */
const unreadablePulmonaryReport = () =>
  ({
    id: 'doc-pft',
    documentType: 'other',
    title: '肺功能报告',
    fileName: 'pft.jpg',
    mimeType: 'image/jpeg',
    fileSizeBytes: 1,
    storageUri: 'local://pft',
    status: 'parsed',
    uploadedAt: '2026-02-10T12:00:00.000Z',
    checksum: null,
    submissionId: null,
    ocrPayload: { fields: { classifiedType: 'pulmonary_function' } },
  }) as unknown as PatientProfileDTO['documents'][number];

const NOW = new Date('2026-08-05T12:00:00.000Z');

const pack = (profile: PatientProfileDTO) => buildReferralPack(profile, NOW);

/* ------------------------------------------------------------------ */

describe('转诊包 — the document itself', () => {
  it('leads with the catalogue entry and the document number, verbatim', () => {
    const result = pack(base());
    expect(result.catalogue.itemNumber).toBe(25);
    expect(result.catalogue.documentNumber).toBe('国卫医政发〔2023〕26号');
    expect(result.markdown).toContain(
      '《第二批罕见病目录》序号 25，国卫医政发〔2023〕26号（2023-09-18）',
    );
  });

  it('prints the provenance note before any patient data', () => {
    const result = pack(base());
    const noteIndex = result.markdown.indexOf(REFERRAL_PROVENANCE_NOTE);
    expect(noteIndex).toBeGreaterThan(-1);
    expect(noteIndex).toBeLessThan(result.markdown.indexOf('## 一、诊断依据'));
  });

  it('names the file and the document after the patient', () => {
    const result = pack(base());
    expect(result.fileName).toBe('张三-referral-pack.md');
    expect(result.documentTitle).toContain('罕见病诊疗协作网转诊资料');
    expect(result.contentType).toBe('text/markdown');
  });
});

describe('诊断依据 — a claim must never be typeset as evidence', () => {
  it('marks a self-reported diagnosis as such, in the printed line', () => {
    // `geneticMutation` is the free-text box on the baseline form. The
    // passport calls that `self_reported`; the pack must not upgrade it.
    const result = pack(base({ geneticMutation: 'FSHD1' } as Partial<PatientProfileDTO>));
    expect(result.diagnosis.confirmation).toBe('self_reported');
    expect(result.diagnosis.statement).toContain('请勿按已确诊处理');
    expect(result.markdown).toContain('请勿按已确诊处理');
  });

  it('says there is no basis at all when nothing was recorded', () => {
    const result = pack(base());
    expect(result.diagnosis.confirmation).toBe('none');
    expect(result.diagnosis.statement).toContain('本平台尚无任何诊断依据记录');
  });

  it('states the genetic result when there is one, and drops the warning', () => {
    const result = pack(base({ documents: [geneticReport({ d4z4Repeats: '6' })] } as never));

    expect(result.diagnosis.confirmation).toBe('genetic');
    expect(result.diagnosis.statement).toContain('基因确诊');
    expect(result.diagnosis.statement).toContain('6');
    expect(result.markdown).not.toContain('请勿按已确诊处理');
  });

  it('puts the confirmation question at the top of the sheet only when unconfirmed', () => {
    const unconfirmed = pack(base({ geneticMutation: 'FSHD1' } as Partial<PatientProfileDTO>));
    expect(unconfirmed.questions[0]?.id).toBe('confirm-diagnosis');
    expect(unconfirmed.questions[0]?.hint).toContain('本平台没有收到你的基因报告');

    const confirmed = pack(base({ documents: [geneticReport({ d4z4Repeats: '6' })] } as never));
    expect(confirmed.questions.some((question) => question.id === 'confirm-diagnosis')).toBe(false);
  });
});

describe('功能测试 —「当天做不了」 is a row, not a gap', () => {
  it('keeps a notApplicable attempt as its own dated observation', () => {
    const result = pack(
      base({
        functionTests: [
          functionTest({ performedAt: '2026-01-05T12:00:00.000Z', measuredValue: 11 }),
          functionTest({
            performedAt: '2026-05-05T12:00:00.000Z',
            measuredValue: null,
            notApplicable: true,
          }),
        ] as unknown as PatientProfileDTO['functionTests'],
      }),
    );

    const series = result.functionTests.find((entry) => entry.testType === 'ten_meter_walk');
    expect(series?.points).toHaveLength(2);
    expect(series?.points[1]?.outcome).toBe('unable');
    expect(series?.hasUnableEntries).toBe(true);
    expect(result.markdown).toContain('2026-05-05：当天尝试后无法完成');
  });

  it('adds a question about the tests the patient can no longer complete', () => {
    const result = pack(
      base({
        functionTests: [
          functionTest({
            testType: 'sit_to_stand',
            measuredValue: null,
            notApplicable: true,
          }),
        ] as unknown as PatientProfileDTO['functionTests'],
      }),
    );

    const question = result.questions.find((entry) => entry.id === 'unable-tests');
    expect(question).toBeDefined();
    expect(question?.prompt).toContain('坐站转换');
  });

  it('does not add that question when every attempt produced a value', () => {
    const result = pack(
      base({
        functionTests: [functionTest({})] as unknown as PatientProfileDTO['functionTests'],
      }),
    );
    expect(result.questions.some((entry) => entry.id === 'unable-tests')).toBe(false);
  });

  it('orders each series oldest first so it reads as a trend', () => {
    const result = pack(
      base({
        functionTests: [
          functionTest({ performedAt: '2026-06-01T12:00:00.000Z', measuredValue: 20 }),
          functionTest({ performedAt: '2026-01-01T12:00:00.000Z', measuredValue: 10 }),
        ] as unknown as PatientProfileDTO['functionTests'],
      }),
    );

    const series = result.functionTests[0];
    expect(series?.points.map((point) => point.measuredValue)).toEqual([10, 20]);
  });

  it('caps a long series and says how many rows were dropped', () => {
    const many = Array.from({ length: REFERRAL_MAX_POINTS_PER_SERIES + 4 }, (_, index) =>
      functionTest({
        performedAt: `2026-0${(index % 9) + 1}-0${(index % 9) + 1}T12:00:00.000Z`,
        measuredValue: index + 1,
      }),
    );

    const result = pack(
      base({ functionTests: many as unknown as PatientProfileDTO['functionTests'] }),
    );
    const series = result.functionTests[0];

    expect(series?.points).toHaveLength(REFERRAL_MAX_POINTS_PER_SERIES);
    expect(series?.omittedEarlierCount).toBe(4);
    expect(result.markdown).toContain('另有 4 次更早的记录未列出');
  });

  it('says so plainly when there are no function tests at all', () => {
    const result = pack(base());
    expect(result.functionTests).toHaveLength(0);
    expect(result.markdown).toContain('本平台没有功能测试记录 —— 不等于没有做过');
  });

  it('renders the unit, side and assistance qualifiers a clinician needs', () => {
    const result = pack(
      base({
        functionTests: [
          functionTest({
            testType: 'six_minute_walk',
            measuredValue: 320,
            unit: 'm',
            side: 'bilateral',
            assistanceRequired: true,
            deviceUsed: 'AFO',
          }),
        ] as unknown as PatientProfileDTO['functionTests'],
      }),
    );

    expect(result.markdown).toContain('6 分钟步行');
    expect(result.markdown).toContain('320米');
    expect(result.markdown).toContain('需要他人协助');
    expect(result.markdown).toContain('器械：AFO');
  });
});

describe('辅具 — three record states, none of them 「无辅具」', () => {
  it('lists devices the patient selected', () => {
    const result = pack(
      base({
        baseline: { currentStatus: { assistiveDevices: ['AFO', '轮椅'] } } as Record<
          string,
          unknown
        >,
      }),
    );

    expect(result.devices.state).toBe('listed');
    expect(result.devices.devices).toEqual(['AFO', '轮椅']);
    expect(result.markdown).toContain('辅具：AFO、轮椅');
  });

  it('distinguishes 「问卷交了，一项没勾」 from 「这一节没填过」', () => {
    const noneSelected = pack(
      base({
        baseline: { currentStatus: { assistiveDevices: [] } } as Record<string, unknown>,
      }),
    );
    expect(noneSelected.devices.state).toBe('none_selected');
    expect(noneSelected.devices.note).toContain('这不等于患者说自己不需要辅具');

    const notRecorded = pack(base());
    expect(notRecorded.devices.state).toBe('not_recorded');
    expect(notRecorded.devices.note).toContain('不等于没有使用辅具');

    expect(noneSelected.devices.note).not.toBe(notRecorded.devices.note);
  });

  it('never prints an absence as a fact about the patient', () => {
    const result = pack(base());
    expect(result.markdown).not.toContain('无辅具使用');
    expect(result.markdown).toContain('本平台无可列出的辅具');
  });

  it('keeps 「开始使用轮椅」 as a dated transition, not a current device', () => {
    const result = pack(
      base({
        followupEvents: [
          followupEvent({
            eventType: 'started_wheelchair',
            occurredAt: '2024-04-01T12:00:00.000Z',
          }),
        ] as unknown as PatientProfileDTO['followupEvents'],
      }),
    );

    expect(result.devices.devices).toEqual([]);
    expect(result.devices.startEvents).toHaveLength(1);
    expect(result.devices.startEvents[0]?.label).toBe('开始使用轮椅');
    expect(result.markdown).toContain('开始使用轮椅：2024-04-01');
    expect(result.markdown).toContain('不代表目前的使用情况');
  });

  it('warns that a migrated 「需要辅助」 may mean 「走不了」', () => {
    const assisted = pack(
      base({
        baseline: { currentStatus: { independentlyAmbulatory: 'assisted' } } as Record<
          string,
          unknown
        >,
      }),
    );
    expect(assisted.devices.ambulation).toBe('assisted');
    expect(assisted.devices.ambulationCaveat).toContain('无法行走的患者当时只能选');
    expect(assisted.markdown).toContain('无法行走的患者当时只能选');

    const unable = pack(
      base({
        baseline: { currentStatus: { independentlyAmbulatory: 'unable' } } as Record<
          string,
          unknown
        >,
      }),
    );
    expect(unable.devices.ambulationCaveat).toBeNull();
    expect(unable.devices.ambulationLabel).toContain('无法行走');
  });

  it('does not claim normal walking when nothing was recorded', () => {
    const result = pack(base());
    expect(result.devices.ambulation).toBeNull();
    expect(result.devices.ambulationLabel).toContain('不等于行走正常');
  });
});

describe('呼吸支持', () => {
  it('reports an NIV start date without claiming current use', () => {
    const result = pack(
      base({
        followupEvents: [
          followupEvent({ eventType: 'started_niv', occurredAt: '2025-09-15T12:00:00.000Z' }),
        ] as unknown as PatientProfileDTO['followupEvents'],
      }),
    );

    expect(result.respiratory.nivStartedAt).toBe('2025-09-15T12:00:00.000Z');
    expect(result.respiratory.statement).toContain('2025-09-15');
    expect(result.respiratory.statement).toContain('请当面核实');
    // The NIV event is respiratory support, not an assistive device.
    expect(result.devices.startEvents).toHaveLength(0);
  });

  it('does not read a missing NIV record as「不需要通气」', () => {
    const result = pack(base());
    expect(result.respiratory.nivStartedAt).toBeNull();
    expect(result.respiratory.statement).toContain('不等于没有使用');
  });

  it('carries the patient-reported breathing symptom answer as three states', () => {
    expect(pack(base()).respiratory.breathingSymptomsRecorded).toBeNull();
    expect(
      pack(
        base({
          baseline: { currentStatus: { breathingSymptoms: false } } as Record<string, unknown>,
        }),
      ).respiratory.breathingSymptomsRecorded,
    ).toBe(false);
    expect(
      pack(
        base({
          baseline: { currentStatus: { breathingSymptoms: true } } as Record<string, unknown>,
        }),
      ).respiratory.breathingSymptomsRecorded,
    ).toBe(true);
    expect(pack(base()).markdown).toContain('呼吸相关症状（患者自填）：未填写');
  });
});

describe('系统监测三项 — present / unreadable / absent survive to the page', () => {
  it('emits all three slots', () => {
    const result = pack(base());
    expect(result.monitoring.map((slot) => slot.key)).toEqual(['blood', 'respiratory', 'cardiac']);
  });

  it('says 「未能读出」 for a report that is on file but unparsed', () => {
    const result = pack(
      base({
        documents: [unreadablePulmonaryReport()] as unknown as PatientProfileDTO['documents'],
      }),
    );

    const respiratory = result.monitoring.find((slot) => slot.key === 'respiratory');
    expect(respiratory?.state).toBe('unreadable');
    expect(respiratory?.statement).toContain('已上传该类报告');
    expect(respiratory?.statement).toContain('请向患者索取原件');
    expect(respiratory?.statement).not.toContain('没有该类报告的记录');
    expect(result.respiratory.pulmonary.state).toBe('unreadable');
  });

  it('says 「不等于没有做过」 for a slot with nothing on file', () => {
    const result = pack(base());
    const cardiac = result.monitoring.find((slot) => slot.key === 'cardiac');
    expect(cardiac?.state).toBe('absent');
    expect(cardiac?.statement).toContain('不等于没有做过');
  });

  it('keeps the passport note that says whether a test is indicated', () => {
    const result = pack(base());
    const cardiac = result.monitoring.find((slot) => slot.key === 'cardiac');
    // The passport attaches an AAN-derived note to the cardiac slot so
    // the panel does not read as three tests everyone owes. If the
    // passport stops attaching one, this test says so rather than the
    // pack silently reverting to a to-do list.
    expect(cardiac?.note).toBeTruthy();
    expect(result.markdown).toContain(cardiac?.note ?? '');
  });
});

describe('我想问的问题', () => {
  it('gives every prompt a source, and every prompt is a question', () => {
    const result = pack(base());
    expect(result.questions.length).toBeGreaterThan(5);
    for (const question of result.questions) {
      expect(question.source.trim().length).toBeGreaterThan(0);
      expect(question.prompt).toMatch(/[？?]/);
    }
  });

  it('quotes the 协作网 registry obligation by document number', () => {
    const result = pack(base());
    const registry = result.questions.find((question) => question.id === 'registry');
    expect(registry?.source).toContain('国卫办医函〔2019〕157号');
  });

  it('prints a blank for each question so it can be filled in beforehand', () => {
    const result = pack(base());
    const blanks = result.markdown.split('我的情况 / 想问的：').length - 1;
    expect(blanks).toBe(result.questions.length);
  });
});
