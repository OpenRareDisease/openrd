/**
 * 我的档案 — the 遗传信息 and 分型/诊断方式 rows.
 *
 * Both used to be assembled field by field, each field preferring the
 * archive's own copy over the report's: 分型 from `baseline`, D4Z4 from
 * `baseline`, 单倍型 from the report because the archive has no box for
 * it, 甲基化 from `baseline` again. That is the per-row merge
 * `pickGeneticEvidenceDocument` exists to forbid — one line reading as
 * one assay while holding a repeat count out of the archive next to a
 * haplotype off a laboratory report — and it disagreed with 临床护照,
 * the share page, the referral pack and both registry exports whenever
 * the two copies differed.
 *
 * The fixture below is such a profile, and the passport summary beside
 * it is the API's real answer for it: `buildClinicalPassportSummary` was
 * run on the same baseline and the same document, and its
 * `diagnosis` block is transcribed here. Both rows are now read off that
 * block, so the assertions are 「这一屏和护照说的是同一件事」 rather than
 * 「这一屏说了点什么」.
 */

import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { Text } from 'react-native';

// api.ts reaches AsyncStorage through session-storage, which has no
// native module under jest. Same stub the surveillance suite uses, and
// the reason the mock below can keep the module's real functions.
jest.mock('../../../lib/session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));

// Only the two requests are stubbed. `readPassportValueOrigins` stays
// the real parser: it is the thing that decides whether a bracket is
// printed at all, and a hand-written stand-in would let this suite pass
// over origins the shipped parser rejects.
jest.mock('../../../lib/api', () => {
  const actual = jest.requireActual('../../../lib/api');
  class ApiError extends Error {
    status?: number;
    data?: unknown;
  }
  return {
    __esModule: true,
    ...actual,
    ApiError,
    getMyPatientProfile: jest.fn(),
    getClinicalPassportSummary: jest.fn(),
  };
});

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      ReactLocal.createElement('SafeAreaView', null, children),
  };
});

const stub = (name: string) => {
  const ReactLocal = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      ReactLocal.createElement(name, null, children),
  };
};

jest.mock('../../common/Button', () => stub('Button'));
jest.mock('../../common/ScreenHeader', () => stub('ScreenHeader'));
jest.mock('../../common/ListGroup', () => {
  const ReactLocal = require('react');
  const Group = ({ children }: { children?: React.ReactNode }) =>
    ReactLocal.createElement('ListGroup', null, children);
  return {
    __esModule: true,
    default: Group,
    Row: () => ReactLocal.createElement('Row', null),
  };
});

import ArchiveScreen from '../index';
import { getClinicalPassportSummary, getMyPatientProfile } from '../../../lib/api';
import type { ClinicalPassportSummary, PatientProfile } from '../../../lib/api';

const asMock = <T,>(fn: T) => fn as unknown as jest.Mock;

/** The one genetics report on file, parsed. Its four readings are the
 *  ones `pickGeneticEvidenceDocument` hands every other surface. */
const GENETIC_REPORT = {
  id: 'doc-genetic',
  documentType: 'genetic_report',
  title: null,
  fileName: 'g.pdf',
  mimeType: 'application/pdf',
  fileSizeBytes: 1,
  storageUri: 's',
  status: 'parsed',
  uploadedAt: '2026-03-01T00:00:00.000Z',
  checksum: null,
  ocrPayload: {
    fields: {
      diagnosisType: 'FSHD1',
      d4z4Repeats: '3',
      haplotype: '4qA',
      methylationValue: '25%',
    },
  },
};

/** An archive that disagrees with that report on all three of the values
 *  the passport prints as rows. Every number here is different from the
 *  report's, so a row taking either side is identifiable on sight. */
const profile = (): PatientProfile =>
  ({
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    fullName: '张三',
    preferredName: null,
    dateOfBirth: '1990-01-01',
    gender: 'male',
    patientCode: 'P0001',
    diagnosisDate: null,
    geneticMutation: null,
    baseline: {
      diseaseBackground: { diagnosisType: 'FSHD2', d4z4: '10', methylation: '55%' },
    },
    measurements: [],
    functionTests: [],
    symptomScores: [],
    dailyImpacts: [],
    followupEvents: [],
    activityLogs: [],
    documents: [GENETIC_REPORT],
    medications: [],
    updatedAt: '2026-03-01T00:00:00.000Z',
  }) as unknown as PatientProfile;

/**
 * `buildClinicalPassportSummary`'s own output for the profile above,
 * transcribed. Kept as literals rather than derived here: this bundle
 * cannot import the API package, and a fixture computed from the mobile
 * copy of the rule would only prove the mobile copy agrees with itself.
 */
const REPORT_ORIGIN = {
  kind: 'report',
  labelZh: '报告读取',
  documentId: 'doc-genetic',
  adminUserId: null,
  at: null,
  detail: null,
};

const ABSENT_ORIGIN = {
  kind: 'absent',
  labelZh: '未填',
  documentId: null,
  adminUserId: null,
  at: null,
  detail: null,
};

const PASSPORT_DIAGNOSIS = {
  ready: true,
  confirmation: 'genetic' as const,
  latestSourceDate: '2026-02-28',
  latestDocumentId: 'doc-genetic',
  freshness: { label: '待更新', tone: 'warning' as const, date: '2026-02-28', daysSince: 168 },
  geneticType: 'FSHD1',
  d4z4Repeats: '3',
  methylationValue: '25%',
  diagnosisDate: '—',
  geneEvidence: 'FSHD1 · 4qA · 3',
  // Transcribed from the same run. Three values off the report, and
  // 诊断日期 with nothing behind it — which is the state that must print
  // no bracket at all rather than 「—（未填）」.
  valueOrigins: {
    geneticType: REPORT_ORIGIN,
    d4z4Repeats: REPORT_ORIGIN,
    methylationValue: REPORT_ORIGIN,
    diagnosisDate: ABSENT_ORIGIN,
  },
};

/**
 * The same screen for a patient whose only upload is a 病历摘要 quoting
 * the laboratory.
 *
 * Also transcribed from `buildClinicalPassportSummary`, run on a
 * profile holding 甲基化 55% in the archive and one parsed 病历摘要
 * carrying 分型 FSHD1 and D4Z4 3. `pickGeneticEvidenceDocument` takes
 * that document — for some patients it is the only copy of the number —
 * and the API brackets what it reads off it as a transcription. Two of
 * these three values are in one register and the third is in another,
 * which is exactly what one undifferentiated line hid.
 */
const TRANSCRIBED_ORIGIN = {
  kind: 'transcribed',
  labelZh: '转录自非基因报告文件',
  documentId: 'doc-summary',
  adminUserId: null,
  at: null,
  detail:
    '这个值不是从基因报告上读到的，而是从你上传的另一份文件（例如病历摘要）里读到的转录内容。',
};

const TRANSCRIBED_DIAGNOSIS = {
  ...PASSPORT_DIAGNOSIS,
  confirmation: 'self_reported' as const,
  latestDocumentId: 'doc-summary',
  methylationValue: '55%',
  geneEvidence: 'FSHD1 · 3',
  valueOrigins: {
    geneticType: TRANSCRIBED_ORIGIN,
    d4z4Repeats: TRANSCRIBED_ORIGIN,
    methylationValue: {
      kind: 'indeterminate',
      labelZh: '来源无法确定',
      documentId: null,
      adminUserId: null,
      at: null,
      detail: '这一项在患者自己的表单里没有输入框，本平台的后台也不能代填。',
    },
    diagnosisDate: ABSENT_ORIGIN,
  },
};

const passport = (): ClinicalPassportSummary =>
  ({
    generatedAt: '2026-08-15T00:00:00.000Z',
    passportId: 'FSHD-A1B2C3D4E5',
    patientName: '张三',
    hasRecordedData: true,
    latestUpdatedAt: '2026-03-01T00:00:00.000Z',
    completion: { completed: 1, total: 4 },
    metrics: [],
    summaryCards: [],
    diagnosis: PASSPORT_DIAGNOSIS,
    motor: {
      ready: false,
      average: '—',
      latestMeasurementAt: null,
      latestActivityAt: null,
      summary: '—',
      highlights: [],
      bodyRegions: {},
      activitySummary: '—',
    },
    imaging: {
      ready: false,
      latestMriDate: null,
      latestDocumentId: null,
      freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
      summary: '—',
      highlights: [],
      bodyRegions: {},
    },
    monitoring: { ready: false, items: [] },
    nextSteps: [],
    timeline: [],
  }) as unknown as ClinicalPassportSummary;

const renderScreen = async () => {
  asMock(getMyPatientProfile).mockResolvedValue(profile());
  asMock(getClinicalPassportSummary).mockResolvedValue(passport());
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<ArchiveScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
};

const textOf = (children: unknown): string =>
  Array.isArray(children)
    ? children.map(textOf).join('')
    : typeof children === 'string' || typeof children === 'number'
      ? String(children)
      : '';

/** The value printed under a 档案控制台 label. The console renders each
 *  entry as a label `Text` immediately followed by its value `Text`, so
 *  the value is the string after the label's own. */
const consoleValue = (tree: TestRenderer.ReactTestRenderer, label: string) => {
  const texts = tree.root
    .findAllByType(Text)
    .map((node: ReactTestInstance) => textOf(node.props.children));
  const at = texts.indexOf(label);
  return at >= 0 ? texts[at + 1] : undefined;
};

/** Every `Text` on the screen, joined — for asserting that a sentence
 *  is or is not anywhere on the card. */
const screenText = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map((node: ReactTestInstance) => textOf(node.props.children))
    .join('\n');

/** The same diagnosis block as an API build that predates
 *  `valueOrigins` — the state a cached WeChat bundle can be talking to.
 *  Deleted rather than set to null: the field is simply not on the
 *  wire, which is what the parser has to survive. */
const withoutValueOrigins = () => {
  const diagnosis: Record<string, unknown> = { ...PASSPORT_DIAGNOSIS };
  delete diagnosis.valueOrigins;
  return diagnosis;
};

const renderWithDiagnosis = async (diagnosis: unknown) => {
  asMock(getMyPatientProfile).mockResolvedValue(profile());
  asMock(getClinicalPassportSummary).mockResolvedValue({ ...passport(), diagnosis });
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<ArchiveScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
};

describe('我的档案 prints the passport’s genetic values, not its own merge', () => {
  it('分型/诊断方式 is the passport’s 分型 even when the archive holds another', async () => {
    const tree = await renderScreen();
    expect(consoleValue(tree, '分型/诊断方式')).toBe('FSHD1（报告读取）');
    // The archive's own copy, which this row used to prefer.
    expect(consoleValue(tree, '分型/诊断方式')).not.toContain('FSHD2');
  });

  it('遗传信息 is built from the same three values the passport prints as rows', async () => {
    const tree = await renderScreen();
    expect(consoleValue(tree, '遗传信息')).toBe(
      'FSHD1（报告读取） · D4Z4 3（报告读取） · 甲基化 25%（报告读取）',
    );
  });

  /**
   * THE SOURCE TRAVELS WITH THE VALUE.
   *
   * The three values arrived on this screen with `valueOrigins` beside
   * them and were printed without it for a round — one line, one
   * register, whether a laboratory measured the number or this platform
   * read it off a 病历摘要 quoting one. 临床护照 is one tap away and
   * prints those two states differently under the same value.
   */
  it('转录自病历摘要的值带着服务端给的那句来源，不和报告读数同一个写法', async () => {
    const tree = await renderWithDiagnosis(TRANSCRIBED_DIAGNOSIS);
    expect(consoleValue(tree, '遗传信息')).toBe(
      'FSHD1（转录自非基因报告文件） · D4Z4 3（转录自非基因报告文件） · 甲基化 55%（来源无法确定）',
    );
    expect(consoleValue(tree, '分型/诊断方式')).toBe('FSHD1（转录自非基因报告文件）');
    // The API's own phrase, not a second one worded here.
    expect(screenText(tree)).not.toContain('报告读取');
  });

  /**
   * NO BRACKET IS NOT 「off a report」.
   *
   * `readPassportValueOrigins` returns null for an API build that sends
   * no origins — this app is a web export WeChat caches for days — and
   * a reader who has learned what the bracket means reads its absence
   * as the strongest of the states it can name. So the card says the
   * server did not send them.
   */
  it('服务端没发来源时，值照印，卡片下面说清这次说不出来源', async () => {
    const tree = await renderWithDiagnosis(withoutValueOrigins());
    expect(consoleValue(tree, '遗传信息')).toBe('FSHD1 · D4Z4 3 · 甲基化 25%');
    expect(screenText(tree)).toContain('服务端这一版没有把逐项来源发全');
  });

  /** And the note is about values: a card with nothing on it has no
   *  missing source to report. */
  it('一个值都没有时不写那句来源说明', async () => {
    const tree = await renderWithDiagnosis({
      ...withoutValueOrigins(),
      geneticType: '—',
      d4z4Repeats: '—',
      methylationValue: '—',
    });
    expect(consoleValue(tree, '遗传信息')).toBe('等待相关报告识别');
    expect(screenText(tree)).not.toContain('服务端这一版没有把逐项来源发全');
  });

  it('no archived value reaches the line, and no unattributed 单倍型 rides along', async () => {
    const tree = await renderScreen();
    const line = consoleValue(tree, '遗传信息') ?? '';
    // The three numbers the archive holds. Each of them on this line
    // would be the row disagreeing with every other surface about one
    // assay's reading.
    expect(line).not.toContain('10');
    expect(line).not.toContain('55%');
    expect(line).not.toContain('FSHD2');
    // 单倍型 is on no passport row. It used to be spliced in off the
    // report while D4Z4 beside it came out of the archive — one line
    // reading as one assay while holding two sources.
    expect(line).not.toContain('单倍型');
  });

  it('says it is waiting when the passport has none of the three', async () => {
    asMock(getMyPatientProfile).mockResolvedValue({
      ...profile(),
      baseline: { diseaseBackground: { diagnosisType: 'FSHD2', d4z4: '10' } },
    });
    asMock(getClinicalPassportSummary).mockResolvedValue({
      ...passport(),
      diagnosis: {
        ...PASSPORT_DIAGNOSIS,
        geneticType: '—',
        d4z4Repeats: '—',
        methylationValue: '—',
        // `absent` all round, which is what the API sends for a value
        // it did not print — and what must never come out as 「—（未填）」.
        valueOrigins: {
          geneticType: ABSENT_ORIGIN,
          d4z4Repeats: ABSENT_ORIGIN,
          methylationValue: ABSENT_ORIGIN,
          diagnosisDate: ABSENT_ORIGIN,
        },
      },
    });
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<ArchiveScreen />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(consoleValue(tree, '遗传信息')).toBe('等待相关报告识别');
    expect(consoleValue(tree, '分型/诊断方式')).toBe('等待报告识别');
    expect(screenText(tree)).not.toContain('未填）');
  });
});
