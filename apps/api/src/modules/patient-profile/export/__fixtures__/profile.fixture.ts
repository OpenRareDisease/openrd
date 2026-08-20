import type { PatientProfileDTO } from '../../profile.service.js';

/**
 * One realistic profile, shared by every test in this directory and
 * by the golden files.
 *
 * It is built to carry the cases that actually break exporters,
 * rather than a tidy happy path:
 *
 *   - a wheelchair milestone stored as the first instant of 2019,
 *     which is what a year-only answer looks like once something has
 *     pinned it (the case the golden files exist to police)
 *   - an NIV milestone with a genuine mid-year timestamp, so the two
 *     are distinguishable in the output
 *   - a function test marked 「今天做不了」 alongside one with a value
 *   - an OCR payload with a CK value and an FVC %predicted — the two
 *     fields a LOINC coding would have been attached to
 *   - a family-history statement, so the second-data-subject rule is
 *     exercised in both directions
 *   - a genetic report on file, which is what flips the FHIR
 *     Condition to verificationStatus=confirmed
 *
 * All ids are real UUIDs so `resourceUuid` passes them through
 * unchanged and the goldens stay readable.
 */
export const EXPORT_FIXTURE_PROFILE: PatientProfileDTO = {
  id: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  fullName: '张小雨',
  preferredName: '小雨',
  dateOfBirth: null,
  gender: 'female',
  patientCode: 'FSHD-0001',
  diagnosisStage: 'confirmed',
  diagnosisDate: null,
  geneticMutation: null,
  heightCm: 162,
  weightKg: 51,
  bloodType: 'A',
  contactPhone: '13800000000',
  contactEmail: null,
  primaryPhysician: '李医生（某某医院神经内科）',
  regionProvince: '四川省',
  regionCity: '成都市',
  regionDistrict: null,
  baseline: {
    foundation: {
      fullName: '张小雨',
      preferredName: '小雨',
      birthYear: 1988,
      ageBand: '35-44',
      regionLabel: '四川 成都',
      diagnosisYear: 2014,
    },
    diseaseBackground: {
      diagnosedFshd: true,
      diagnosisType: 'FSHD1',
      d4z4: '5 个重复单元',
      haplotype: '4qA',
      methylation: null,
      familyHistory: '父亲和姑姑都有类似的抬手困难，但都没有做过基因检测。',
      onsetRegion: '肩带',
    },
    currentStatus: {
      independentlyAmbulatory: 'assisted',
      armRaiseDifficulty: true,
      facialWeakness: true,
      footDrop: false,
      breathingSymptoms: null,
      assistiveDevices: ['手杖', '踝足矫形器'],
    },
    currentChallenges: {
      fatigue: 3,
      pain: 2,
      stairs: 4,
      reachingUp: 4,
    },
    notes: null,
  },
  notes: null,
  measurements: [
    {
      id: '33333333-3333-4333-8333-333333333331',
      muscleGroup: 'deltoid',
      metricKey: null,
      bodyRegion: 'shoulder_girdle',
      side: 'left',
      strengthScore: 3,
      method: 'MMT',
      entryMode: 'self_report',
      deviceUsed: null,
      notes: null,
      recordedAt: '2025-06-01T02:00:00.000Z',
      createdAt: '2025-06-01T02:05:00.000Z',
      submissionId: null,
    },
    {
      id: '33333333-3333-4333-8333-333333333332',
      muscleGroup: 'tibialis',
      metricKey: null,
      bodyRegion: 'ankle',
      side: 'bilateral',
      strengthScore: 4,
      method: 'MMT',
      entryMode: 'clinician_entered',
      deviceUsed: null,
      notes: null,
      recordedAt: '2025-05-02T02:00:00.000Z',
      createdAt: '2025-05-02T02:05:00.000Z',
      submissionId: null,
    },
  ],
  functionTests: [
    {
      id: '44444444-4444-4444-8444-444444444441',
      testType: 'ten_meter_walk',
      measuredValue: 14.2,
      side: null,
      protocol: null,
      unit: 'sec',
      deviceUsed: null,
      assistanceRequired: true,
      notes: null,
      performedAt: '2025-06-01T03:00:00.000Z',
      createdAt: '2025-06-01T03:05:00.000Z',
      submissionId: null,
    },
    {
      id: '44444444-4444-4444-8444-444444444442',
      testType: 'stair_climb',
      measuredValue: null,
      notApplicable: true,
      side: null,
      protocol: null,
      unit: null,
      deviceUsed: null,
      assistanceRequired: null,
      notes: null,
      performedAt: '2025-06-01T03:10:00.000Z',
      createdAt: '2025-06-01T03:12:00.000Z',
      submissionId: null,
    },
  ],
  symptomScores: [
    {
      id: '55555555-5555-4555-8555-555555555551',
      symptomKey: 'fatigue',
      score: 7,
      scaleMin: 0,
      scaleMax: 10,
      notes: null,
      recordedAt: '2025-06-02T01:00:00.000Z',
      createdAt: '2025-06-02T01:01:00.000Z',
      submissionId: null,
    },
    {
      id: '55555555-5555-4555-8555-555555555552',
      symptomKey: 'fatigue',
      score: 5,
      scaleMin: 0,
      scaleMax: 10,
      notes: null,
      recordedAt: '2025-04-02T01:00:00.000Z',
      createdAt: '2025-04-02T01:01:00.000Z',
      submissionId: null,
    },
  ],
  dailyImpacts: [
    {
      id: '66666666-6666-4666-8666-666666666661',
      adlKey: 'hair_washing',
      difficultyLevel: 3,
      needsAssistance: true,
      notes: null,
      recordedAt: '2025-06-02T01:10:00.000Z',
      createdAt: '2025-06-02T01:11:00.000Z',
      submissionId: null,
    },
  ],
  followupEvents: [
    {
      id: '77777777-7777-4777-8777-777777777771',
      eventType: 'started_wheelchair',
      severity: null,
      // Exactly the first instant of 2019 — the shape a year-only
      // answer takes once something pins it. Nothing downstream may
      // present this as a 1 January observation.
      occurredAt: '2019-01-01T00:00:00.000Z',
      resolvedAt: null,
      description: '外出较远时开始用轮椅',
      linkedDocumentId: null,
      createdAt: '2024-03-01T05:00:00.000Z',
      submissionId: null,
    },
    {
      id: '77777777-7777-4777-8777-777777777772',
      eventType: 'started_niv',
      severity: null,
      occurredAt: '2023-08-14T13:30:00.000Z',
      resolvedAt: null,
      description: null,
      linkedDocumentId: null,
      createdAt: '2023-08-15T02:00:00.000Z',
      submissionId: null,
    },
    {
      id: '77777777-7777-4777-8777-777777777773',
      eventType: 'fall',
      severity: 'mild',
      occurredAt: '2025-05-20T09:00:00.000Z',
      resolvedAt: null,
      description: '在浴室滑倒',
      linkedDocumentId: null,
      createdAt: '2025-05-20T10:00:00.000Z',
      submissionId: null,
    },
  ],
  activityLogs: [],
  documents: [
    {
      id: '88888888-8888-4888-8888-888888888881',
      documentType: 'genetic_report',
      title: 'D4Z4 检测报告',
      fileName: 'genetic.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 204800,
      storageUri: 'local://uploads/user-1/genetic.pdf',
      status: 'parsed',
      uploadedAt: '2024-02-01T06:00:00.000Z',
      checksum: 'sha256:deadbeef',
      ocrPayload: {
        fields: {
          reportTime: '2024-01-28',
          d4z4Repeats: '5',
          haplotype: '4qA',
        },
      },
      submissionId: null,
    },
    {
      id: '88888888-8888-4888-8888-888888888882',
      documentType: 'blood_panel',
      title: '生化检验',
      fileName: 'blood.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 102400,
      storageUri: 'local://uploads/user-1/blood.pdf',
      status: 'parsed',
      uploadedAt: '2025-05-10T06:00:00.000Z',
      checksum: null,
      ocrPayload: {
        fields: {
          reportTime: '2025-05-09',
          creatineKinase: '1245 U/L',
          fvcPredPct: '78%',
        },
      },
      submissionId: null,
    },
  ],
  medications: [],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2025-06-02T01:11:00.000Z',
};

/** Frozen clock, so goldens do not drift. */
export const FIXTURE_GENERATED_AT = '2026-01-15T08:00:00.000Z';

/**
 * The same patient with every field on `PatientProfileDTO` filled.
 *
 * It exists for one test — omissions-coverage.test.ts — and the reason
 * it has to exist is that `EXPORT_FIXTURE_PROFILE` leaves several
 * clinical facts empty (no medications, no activity log, no methylation
 * reading, no EcoRI fragment, no height or blood type), and a fact that
 * is empty in the fixture is a fact whose disappearance from an export
 * no golden file can show. Two consecutive review rounds found a held
 * value that reached no portable export and was declared in none;
 * both times the value was one the shared fixture does not carry.
 *
 * NOT used by the goldens. They pin a realistic profile, and a profile
 * with every column populated is not one.
 *
 * 「MAXIMAL」 NOW INCLUDES EVERY CELL `REPORT_FIELD_SPECS` CAN READ, and
 * it did not before — it carried a CK and an FVC%pred and nothing else,
 * so ten of the fourteen specs were exercised by no test in this
 * directory at all. A spec whose value is absent from the fixture is a
 * spec whose disappearance from an export nothing can show, which is
 * precisely how a whole category came to reach two of three documents
 * with no declaration anywhere. omissions-coverage.test.ts now walks
 * `REPORT_FIELD_SPECS` at runtime and asserts a home for each, and that
 * assertion is only worth anything over a profile that has them all.
 *
 * EVERY VALUE HERE IS INVENTED. No part of this profile is a real
 * reading, a real name, or a real patient.
 */
export const EXPORT_FIXTURE_PROFILE_MAXIMAL: PatientProfileDTO = {
  ...EXPORT_FIXTURE_PROFILE,
  dateOfBirth: '1988-04-02',
  diagnosisDate: '2014-06-01',
  regionDistrict: '武侯区',
  contactEmail: 'zhang@example.invalid',
  notes: '档案备注：最近爬楼比去年更吃力。',
  baseline: {
    ...(EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>),
    diseaseBackground: {
      ...((EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>).diseaseBackground as Record<
        string,
        unknown
      >),
      methylation: '甲基化水平 32%',
    },
    currentStatus: {
      ...((EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>).currentStatus as Record<
        string,
        unknown
      >),
      breathingSymptoms: true,
    },
  },
  activityLogs: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      logDate: '2025-06-03',
      source: 'self',
      content: '今天下午很累，晚饭后就躺下了。',
      moodScore: 3,
      createdAt: '2025-06-03T12:00:00.000Z',
      submissionId: null,
    },
  ],
  medications: [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      medicationName: '维生素 D',
      dosage: '800 IU',
      frequency: '每日一次',
      route: 'oral',
      startDate: '2024-01-01',
      endDate: null,
      notes: '骨密度偏低',
      status: 'active',
      createdAt: '2024-01-01T00:00:00.000Z',
      submissionId: null,
    },
  ],
  measurements: [
    ...EXPORT_FIXTURE_PROFILE.measurements,
    /**
     * THE ROW WITH NO MUSCLE GROUP.
     *
     * `measurementSchema` accepts 「metricKey or muscleGroup」, and the
     * shipped 用力闭眼 self-test takes the metricKey-only branch on every
     * submission: `SELF_TEST_ACTIONS[0]` (apps/mobile) has no
     * `muscleGroup` because the face has no cohort group, and
     * `buildSelfTestPayload` omits the key. `addMeasurement` stores the
     * NOT NULL column as `COALESCE($3, 'custom')`, so this is exactly the
     * shape the DTO carries — the sentinel, not a null.
     *
     * With no such row in any fixture, every export published
     * 「custom肌力」 for the most characteristic finding in this disease
     * and no test in this directory saw it.
     */
    {
      id: '33333333-3333-4333-8333-33333333333e',
      muscleGroup: 'custom',
      metricKey: 'eye_closure',
      bodyRegion: 'face',
      side: 'none',
      strengthScore: 4,
      method: 'MRC 自评',
      entryMode: 'self_report',
      deviceUsed: null,
      notes: null,
      recordedAt: '2025-06-05T02:00:00.000Z',
      createdAt: '2025-06-05T02:01:00.000Z',
      submissionId: null,
    },
  ],
  documents: [
    {
      ...EXPORT_FIXTURE_PROFILE.documents[0],
      ocrPayload: {
        fields: {
          reportTime: '2024-01-28',
          diagnosisType: 'FSHD1',
          d4z4Repeats: '5',
          haplotype: '4qA',
          ecoRIFragment: '21 kb',
          methylationValue: '32%',
          geneticTestMethod: 'Southern blot',
        },
      },
    },
    {
      ...EXPORT_FIXTURE_PROFILE.documents[1],
      ocrPayload: {
        fields: {
          reportTime: '2025-05-09',
          // The two the fixture already had.
          creatineKinase: '1245 U/L',
          fvcPredPct: '78%',
          // AND THE TEN IT DID NOT. One cell per remaining
          // `REPORT_FIELD_SPECS` entry, in the rendered form
          // `embedded-report-ocr.ts` writes: the laboratory panel, the
          // pulmonary panel, the cardiac panel, the imaging grade, and
          // the five MRC grades the parser reads off 体格检查 prose.
          myoglobin: '86 ng/mL',
          LDH: '312 U/L',
          CKMB: '28 U/L',
          tlcPredPct: '84%',
          dlcoPredPct: '71%',
          LVEF: '62%',
          qtcMs: '431 ms',
          serratusFatigueGrade: '2 级',
          // 「L4 / R3」 is `formatAggregateStrength`'s own encoding of the
          // two sides of one muscle — the notation the exports have to
          // gloss, or the weak side and the strong side swap.
          deltoidStrength: 'L4 / R3',
          bicepsStrength: 'L4 / R4',
          // The snake_case spelling, on purpose: archived payloads hold
          // it, the app's report table reads both, and the export used to
          // read neither.
          triceps_strength: '4',
          quadricepsStrength: 'L5 / R4',
          // A range the parser declined to type. It must travel as the
          // examiner wrote it, not folded into one number.
          tibialisStrength: 'L4-5级 / R4级',
        },
      },
    },
    ...EXPORT_FIXTURE_PROFILE.documents.slice(2),
  ],
};

/**
 * A GENETIC VALUE THAT IS IN THE ARCHIVE AND NOT ON THE REPORT.
 *
 * The baseline questionnaire's 甲基化 box is answered; the document this
 * platform reads as the profile's genetic evidence says nothing about
 * methylation. That is the ordinary lifecycle — `applyGeneticReportAutofill`
 * fills an EMPTY slot from the evidence report and never corrects a full
 * one, so a patient who answered the form before uploading anything keeps
 * their answer beside a report that is silent.
 *
 * It is its own fixture because the three documents used to give three
 * different answers here: TREAT-NMD printed the value, the Phenopacket
 * declared it AND pointed at a FHIR bundle that did not have it, and the
 * FHIR bundle said nothing at all.
 */
export const EXPORT_FIXTURE_PROFILE_ARCHIVE_ONLY_GENETICS: PatientProfileDTO = {
  ...EXPORT_FIXTURE_PROFILE,
  baseline: {
    ...(EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>),
    diseaseBackground: {
      ...((EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>).diseaseBackground as Record<
        string,
        unknown
      >),
      methylation: '甲基化水平 32%',
    },
  },
  // documents untouched: the genetic report carries d4z4 and haplotype
  // and no methylation cell.
};

/**
 * A profile with nothing on it but its own row.
 *
 * The other half of the same test: an omission that is only pushed when
 * a value happens to be present declares nothing for the patient who
 * has none, and 「this export does not carry X」 is exactly the sentence
 * an empty profile's receiver needs.
 */
export const EXPORT_FIXTURE_PROFILE_SPARSE: PatientProfileDTO = {
  ...EXPORT_FIXTURE_PROFILE,
  fullName: null,
  preferredName: null,
  dateOfBirth: null,
  gender: null,
  patientCode: null,
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
};

/**
 * THE SAME PATIENT WITH THE REPORT AND THE QUESTIONNAIRE DISAGREEING ON
 * EVERY GENETIC CELL.
 *
 * NOT AN EDGE CASE. `applyGeneticReportAutofill` fills an EMPTY
 * baseline slot from the evidence document at read time and never
 * corrects a full one, so any patient who answered the registration
 * form before uploading their report — or who uploaded a corrected
 * report afterwards — keeps the old answer in the archive forever,
 * beside a document that says something else. That is the ordinary
 * lifecycle, and it is the only state in which 「which value does this
 * surface print」 has an observable answer.
 *
 * ALL FOUR CELLS DISAGREE AT ONCE, on purpose: the defect this fixture
 * exists to catch was per-cell (分型 had been fixed, D4Z4, 单倍型 and
 * 甲基化 had not), so a fixture disagreeing on one of them would have
 * gone green on the three that were still wrong.
 *
 * THE VALUES ARE CHOSEN SO THAT PICKING THE WRONG ONE IS VISIBLE:
 *
 *   分型      问卷 FSHD1        报告 FSHD2   — a different mechanism
 *   D4Z4     问卷 5 个重复单元   报告 9      — and 9 is in the 8–10 zone,
 *                                            so the guideline qualifier
 *                                            only exists on one of them
 *   单倍型    问卷 4qB          报告 4qA    — 4qB is the allele that
 *                                            argues AGAINST FSHD1
 *   甲基化    问卷 甲基化水平 32% 报告 甲基化指数 0.31
 *
 * Every value is invented. No part of this profile is a real reading.
 */
export const EXPORT_FIXTURE_PROFILE_REPORT_DISAGREES: PatientProfileDTO = {
  ...EXPORT_FIXTURE_PROFILE,
  baseline: {
    ...(EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>),
    diseaseBackground: {
      ...((EXPORT_FIXTURE_PROFILE.baseline as Record<string, unknown>).diseaseBackground as Record<
        string,
        unknown
      >),
      diagnosisType: 'FSHD1',
      d4z4: '5 个重复单元',
      haplotype: '4qB',
      methylation: '甲基化水平 32%',
    },
  },
  documents: [
    {
      ...EXPORT_FIXTURE_PROFILE.documents[0],
      ocrPayload: {
        fields: {
          reportTime: '2024-01-28',
          diagnosisType: 'FSHD2',
          d4z4Repeats: '9',
          haplotype: '4qA',
          methylationValue: '甲基化指数 0.31',
        },
      },
    },
    ...EXPORT_FIXTURE_PROFILE.documents.slice(1),
  ],
};
