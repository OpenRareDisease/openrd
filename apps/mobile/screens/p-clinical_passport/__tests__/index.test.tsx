/**
 * 临床护照 screen — the two things on it that are not decoration.
 *
 * 1. The anesthesia card exists in two carriers. It used to be a PNG
 *    only, which means a screen reader got the card's *name* and not
 *    「避免琥珀胆碱」, the type did not reflow at 200%, and nothing on it
 *    could be copied into WeChat to send a surgical team in advance.
 *
 * 2. Each diagnosis cell is typeset according to its OWN source, from
 *    `diagnosis.valueOrigins`. `diagnosis.confirmation` is an evidence
 *    grade and answers nothing about authorship, so it picks no
 *    typography here: a 分型 the patient typed into a text box and a
 *    D4Z4 repeat count off a genetics report can sit in the same block
 *    under the same grade. This population lives through a ~10-year
 *    diagnostic odyssey with a majority misdiagnosed on the way; a
 *    well-set number is read as a measurement, and that is the
 *    mechanism.
 */

import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';

jest.mock('../../../lib/api', () => {
  class ApiError extends Error {
    status?: number;
    data?: unknown;
  }
  return {
    __esModule: true,
    // The real shape check, not a stub. It is the only thing standing
    // between a rolled-back API and a render-time throw that takes the
    // whole passport down, so a test that faked it would be asserting
    // against its own fiction.
    readPassportGeneticEvidence: jest.requireActual('../../../lib/api').readPassportGeneticEvidence,
    readPassportValueOrigin: jest.requireActual('../../../lib/api').readPassportValueOrigin,
    readPassportValueOrigins: jest.requireActual('../../../lib/api').readPassportValueOrigins,
    ApiError,
    isConsentRequiredError: () => false,
    getClinicalPassportSummary: jest.fn(),
    getMyPatientProfile: jest.fn(),
    getInstrumentAdministrations: jest.fn(),
    getInstrumentCatalogue: jest.fn(),
  };
});

jest.mock('../../../lib/ai-streaming', () => ({
  __esModule: true,
  streamAiQuestion: jest.fn(() => ({ close: jest.fn() })),
}));

jest.mock('../../../lib/session-storage', () => ({
  __esModule: true,
  getSessionValue: jest.fn(async () => null),
  setSessionValue: jest.fn(async () => undefined),
}));

// The one collaborator the test steers: it is the canvas, and the point
// of the text carrier is that it survives the canvas being absent.
jest.mock('../../../lib/anesthesia-card-image', () => ({
  __esModule: true,
  renderAnesthesiaCardPng: jest.fn(),
}));

jest.mock('../../../lib/report-insights', () => ({
  __esModule: true,
  buildReportInsights: () => ({ systemPanels: [] }),
  buildLatestMriVisualization: () => ({ regions: {}, findings: [], summary: '—' }),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('expo-print', () => ({ printToFileAsync: jest.fn(), printAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => false),
  shareAsync: jest.fn(),
}));
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

jest.mock('../../common/Icon', () => stub('Icon'));
jest.mock('../../common/SegmentedControl', () => stub('SegmentedControl'));
jest.mock('../../common/HumanBodyFigure', () => stub('HumanBodyFigure'));
jest.mock('../../common/SystemMonitoringPanels', () => stub('SystemMonitoringPanels'));
jest.mock('../../common/TimelineSectionCard', () => stub('TimelineSectionCard'));
jest.mock('../../common/AnswerText', () => stub('AnswerText'));
jest.mock('../../common/ScreenHeader', () => stub('ScreenHeader'));
jest.mock('../../common/feedback/AppDialog', () => ({
  __esModule: true,
  useAppDialog: () => ({ notify: jest.fn() }),
}));

// Kept pressable so the test can drive the button rather than reaching
// into the component's state.
jest.mock('../../common/Button', () => {
  const ReactLocal = require('react');
  const { Text: RNText, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    default: ({ label, onPress, disabled }: Record<string, never>) =>
      ReactLocal.createElement(
        TouchableOpacity,
        { onPress, disabled, accessibilityRole: 'button', accessibilityLabel: label },
        ReactLocal.createElement(RNText, null, label),
      ),
  };
});

import ClinicalPassportScreen from '../index';
import styles from '../styles';
import {
  getClinicalPassportSummary,
  getInstrumentAdministrations,
  getInstrumentCatalogue,
  getMyPatientProfile,
} from '../../../lib/api';
import { renderAnesthesiaCardPng } from '../../../lib/anesthesia-card-image';
import { printToFileAsync } from 'expo-print';
import type { ClinicalPassportSummary } from '../../../lib/api';

const asMock = <T,>(fn: T) => fn as unknown as jest.Mock;

/** StyleSheet.flatten keeps the literal types from `StyleSheet.create`,
 *  so asking whether a key is absent is a type error rather than a
 *  question. Absence is exactly what these tests check. */
const flat = (style: unknown) =>
  StyleSheet.flatten(style as never) as unknown as Record<string, unknown>;

/** One `PassportValueOrigin`, worded the way the API words it. */
const origin = (kind: string, labelZh: string) => ({
  kind,
  labelZh,
  documentId: null,
  adminUserId: null,
  at: null,
  detail: null,
});

/**
 * THE FIXTURE THAT USED TO BE MISLABELLED, AND IS THE POINT.
 *
 * A genetics report parsed to nothing but a 分型 puts `confirmation` at
 * `self_reported` with 分型 read off that report — nobody typed it. The
 * screen printed 「本人填写的诊断信息」 over exactly this profile.
 */
const SELF_REPORTED_ORIGINS = {
  geneticType: origin('report', '报告读取'),
  d4z4Repeats: origin('absent', '未填'),
  methylationValue: origin('absent', '未填'),
  diagnosisDate: origin('patient', '本人填写'),
};

const summary = (over: Record<string, unknown> = {}): ClinicalPassportSummary =>
  ({
    generatedAt: '2026-08-05T00:00:00.000Z',
    passportId: 'FSHD-A1B2C3D4E5',
    patientName: '张三',
    hasRecordedData: true,
    latestUpdatedAt: '2026-08-01T00:00:00.000Z',
    completion: { completed: 1, total: 4 },
    metrics: [],
    summaryCards: [
      {
        key: 'diagnosis',
        title: '诊断证据',
        ready: false,
        summary: '未经基因确诊（未读到 D4Z4 重复数、4q 单倍型或 EcoRI 片段）—— 分型（报告读取）',
        meta: '诊断日期 2023-05-01',
      },
    ],
    diagnosis: {
      ready: false,
      confirmation: 'self_reported',
      latestSourceDate: null,
      latestDocumentId: null,
      freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
      geneticType: 'FSHD1',
      d4z4Repeats: '—',
      methylationValue: '—',
      diagnosisDate: '2023-05-01',
      valueOrigins: SELF_REPORTED_ORIGINS,
      geneEvidence: '暂无可直接展示的基因证据',
      // 证据摘要 has an origin of its own on the wire, beside the map.
      // With nothing joined off a report it is the 分型 row's own.
      geneEvidenceOrigin: origin('report', '报告读取'),
    },
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
    monitoring: {
      ready: false,
      items: [
        {
          key: 'respiratory',
          title: '肺功能',
          available: false,
          summary: '暂无可自动读取的肺功能结果',
          latestDate: null,
          latestDocumentId: null,
          freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
        },
        {
          key: 'cardiac',
          title: '心脏检查',
          available: false,
          summary: '暂无可自动读取的心脏检查结果',
          latestDate: null,
          latestDocumentId: null,
          freshness: { label: '缺失', tone: 'neutral', date: null, daysSince: null },
        },
      ],
    },
    nextSteps: [],
    timeline: [],
    ...over,
  }) as unknown as ClinicalPassportSummary;

const geneticSummary = (diagnosisOver: Record<string, unknown> = {}) =>
  summary({
    summaryCards: [
      {
        key: 'diagnosis',
        title: '诊断证据',
        ready: true,
        summary: 'FSHD1 · 4qA · 18kb · 4',
        meta: '诊断日期 2023-05-01',
      },
    ],
    diagnosis: {
      ready: true,
      confirmation: 'genetic',
      latestSourceDate: '2026-02-01',
      latestDocumentId: 'd1',
      freshness: { label: '最新', tone: 'success', date: '2026-02-01', daysSince: 3 },
      geneticType: 'FSHD1',
      d4z4Repeats: '4',
      methylationValue: '25%',
      diagnosisDate: '2023-05-01',
      // 基因确诊 is earned by the repeat count alone, so this profile
      // is confirmed with a 分型 the patient typed and a date the OCR
      // autofill may have written. Three different sources, one block.
      valueOrigins: {
        geneticType: origin('patient', '本人填写'),
        d4z4Repeats: origin('report', '报告读取'),
        methylationValue: origin('report', '报告读取'),
        diagnosisDate: origin('indeterminate', '来源无法确定'),
      },
      geneEvidence: 'FSHD1 · 4qA · 18kb · 4',
      // Joined out of values that do not agree about where they came
      // from, which is the state the API resolves to `indeterminate`.
      geneEvidenceOrigin: origin('indeterminate', '来源无法确定'),
      ...diagnosisOver,
    },
  });

const render = async (passport: ClinicalPassportSummary) => {
  asMock(getClinicalPassportSummary).mockResolvedValue(passport);
  asMock(getMyPatientProfile).mockResolvedValue({ documents: [] });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<ClinicalPassportScreen />);
  });
  await act(async () => {});
  return renderer;
};

const readText = (node: ReactTestInstance): string => {
  const children = node.props.children;
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.filter((c) => typeof c === 'string').join('');
  return typeof children === 'number' ? String(children) : '';
};

const allText = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map(readText);

/** Every `Text` run as one string, for asserting on a substring of a
 *  sentence. `allText` stays the exact-match form: 「证据摘要」 is a note
 *  TITLE, and it is also a word inside the section's own intro copy, so
 *  asserting its absence has to compare whole runs. */
const joinedText = (renderer: TestRenderer.ReactTestRenderer) => allText(renderer).join('\n');

const nodeWithText = (renderer: TestRenderer.ReactTestRenderer, text: string) =>
  renderer.root.findAllByType(Text).find((node) => readText(node) === text);

const press = (renderer: TestRenderer.ReactTestRenderer, label: string) => {
  const button = renderer.root.find(
    (node) => node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label,
  );
  act(() => {
    button.props.onPress();
  });
};

/** `press`, for handlers that are async. The export below awaits
 *  expo-print, so the assertions have to run after the microtasks. */
const pressAsync = (renderer: TestRenderer.ReactTestRenderer, label: string) =>
  act(async () => {
    renderer.root
      .find(
        (node) =>
          node.props.accessibilityRole === 'button' && node.props.accessibilityLabel === label,
      )
      .props.onPress();
  });

beforeEach(() => {
  jest.clearAllMocks();
  // clearAllMocks leaves implementations in place, so this has to be a
  // reset — otherwise one test's instrument fixture is still answering
  // in the next one.
  asMock(getInstrumentAdministrations).mockReset();
  asMock(getInstrumentAdministrations).mockResolvedValue([]);
  asMock(getInstrumentCatalogue).mockReset();
  asMock(getInstrumentCatalogue).mockResolvedValue([]);
});

describe('麻醉卡：同一份内容，两种载体', () => {
  const RENDERED = { uri: 'data:image/png;base64,AAAA', width: 1500, height: 3000 };

  it('生成后文字版带着全部临床内容，不只是图片', async () => {
    asMock(renderAnesthesiaCardPng).mockReturnValue(RENDERED);
    const renderer = await render(summary());
    press(renderer, '生成麻醉卡');

    const text = allText(renderer).join('\n');
    // The drug lines are the reason this card exists — succinylcholine
    // in an FSHD patient can produce life-threatening hyperkalaemia —
    // and until the text carrier existed they were pixels.
    expect(text).toContain('琥珀胆碱');
    expect(text).toContain('高钾血症');
    expect(text).toContain('恶性高热');
    // Both halves of the patient block, including the line item 1 of
    // this lane was about.
    expect(text).toContain('最近肺功能：未做过或未上传');
    // 本人填报 is gone from this line: this fixture's 分型 was read off a
    // report, so nobody filed it and a genetic report IS on file.
    expect(text).toContain('诊断：FSHD —— 未经基因确诊');
    expect(text).toContain('档案里的分型为 FSHD1（报告读取）');
    // A literature summary must not travel without its disclaimer or
    // its sources.
    expect(text).toContain('不替代麻醉医师');
    expect(text).toContain('AANA Journal');
  });

  it('每一行都可选中 —— 复制给手术团队是图片做不到的那一半', async () => {
    asMock(renderAnesthesiaCardPng).mockReturnValue(RENDERED);
    const renderer = await render(summary());
    press(renderer, '生成麻醉卡');

    const line = renderer.root
      .findAllByType(Text)
      .find((node) => readText(node).includes('琥珀胆碱'));
    expect(line?.props.selectable).toBe(true);
  });

  it('图片渲染不出来时（原生壳、无 canvas）文字版照常在', async () => {
    // The old behaviour set an error and rendered nothing: on a device
    // without a canvas the clinical content simply did not exist.
    asMock(renderAnesthesiaCardPng).mockReturnValue(null);
    const renderer = await render(summary());
    press(renderer, '生成麻醉卡');

    const text = allText(renderer).join('\n');
    expect(text).toContain('琥珀胆碱');
    expect(text).toContain('文字版');
  });

  it('图片的无障碍标签说明它是重复的那一份', async () => {
    asMock(renderAnesthesiaCardPng).mockReturnValue(RENDERED);
    const renderer = await render(summary());
    press(renderer, '生成麻醉卡');

    const image = renderer.root.find(
      (node) => typeof node.props.accessibilityLabel === 'string' && node.props.source?.uri,
    );
    expect(image.props.accessibilityLabel).toContain('与下方文字相同');
  });

  it('文字块里没有固定高度 —— 200% 字号要能撑开', async () => {
    asMock(renderAnesthesiaCardPng).mockReturnValue(RENDERED);
    const renderer = await render(summary());
    press(renderer, '生成麻醉卡');

    const flattened = [
      styles.anesthesiaTextBlock,
      styles.anesthesiaTextLine,
      styles.anesthesiaTextPatient,
      styles.anesthesiaTextFine,
    ].map(flat);
    flattened.forEach((style) => {
      expect(style.height).toBeUndefined();
      expect(style.maxHeight).toBeUndefined();
      expect(style.numberOfLines).toBeUndefined();
    });
  });
});

describe('逐项来源：每个值按自己的来源排版，而不是按整块的证据等级', () => {
  const styleOfValue = (renderer: TestRenderer.ReactTestRenderer, value: string) =>
    StyleSheet.flatten(nodeWithText(renderer, value)!.props.style);

  it('报告读出来的那个值保持 metric，同一块里患者自己填的那个不保持', async () => {
    // The fixture is genetically confirmed — earned by the repeat count
    // alone — with a 分型 the patient typed. One block, two registers.
    const renderer = await render(geneticSummary());
    const repeats = styleOfValue(renderer, '4');
    expect(repeats.fontWeight).toBe('700');
    expect(repeats.fontVariant).toEqual(['tabular-nums']);

    const geneticType = styleOfValue(renderer, 'FSHD1');
    expect(geneticType.fontWeight).not.toBe('700');
    expect(geneticType.fontVariant).toBeUndefined();
  });

  it('「来源无法确定」不当成报告读取 —— 它可能就是患者的叙述', async () => {
    const style = styleOfValue(await render(geneticSummary()), '2023-05-01');
    expect(style.fontWeight).not.toBe('700');
    expect(style.fontVariant).toBeUndefined();
  });

  it('报告里只读到分型时，那一格是报告读取，不降级', async () => {
    // `confirmation` is `self_reported` on this fixture and the 分型
    // still came off a report.
    const style = styleOfValue(await render(summary()), 'FSHD1');
    expect(style.fontWeight).toBe('700');
    expect(style.fontVariant).toEqual(['tabular-nums']);
  });

  it('每个值下面印着它自己的来源', async () => {
    const text = allText(await render(summary()));
    expect(text).toContain('报告读取');
    expect(text).toContain('本人填写');
  });

  it('没有来源可归的值不印「未填」两个字 —— 「—（未填）」是同一件事说两遍', async () => {
    expect(joinedText(await render(summary()))).not.toContain('未填');
  });

  it('服务端没给逐项来源时说没给，不读成「都是报告读出来的」', async () => {
    const renderer = await render(
      summary({ diagnosis: { ...summary().diagnosis, valueOrigins: undefined } }),
    );
    expect(joinedText(renderer)).toContain('服务端这一版没有把逐项来源发全');
    // It names the diagnosis values it is about. 临床护照 ID is generated
    // here and 诊断进度 carries whatever author the server named, so
    // neither is covered by this sentence.
    expect(joinedText(renderer)).toContain('基因类型、D4Z4 重复数、甲基化值、诊断日期和证据摘要');
    // And the notice above the grid stops pointing at captions that are
    // not there.
    expect(joinedText(renderer)).not.toContain('本平台能说明来源的，来源就写在那个值下面');
    // And nothing keeps the laboratory register on the strength of a
    // field that never arrived.
    expect(styleOfValue(renderer, 'FSHD1').fontVariant).toBeUndefined();
  });

  it('证据摘要那一行也印着自己的来源 —— 和这个屏幕导出的 PDF 说同一件事', async () => {
    const renderer = await render(
      geneticSummary({ geneEvidenceOrigin: origin('indeterminate', '拼出来的，来源不一致') }),
    );
    const runs = allText(renderer);
    const value = runs.indexOf('FSHD1 · 4qA · 18kb · 4', runs.indexOf('证据摘要'));
    expect(value).toBeGreaterThan(-1);
    expect(runs[value + 1]).toBe('拼出来的，来源不一致');
  });

  it('只漏了证据摘要的来源时也说没发全 —— 那张表来了不等于这一节全了', async () => {
    const renderer = await render(geneticSummary({ geneEvidenceOrigin: null }));
    expect(joinedText(renderer)).toContain('服务端这一版没有把逐项来源发全');
  });

  it('证据摘要没有来源可归时不印小字 —— 和上面那些格子一样', async () => {
    // `absent` is a source the server did send, so the sentence about a
    // missing payload must not fire on it either.
    const joined = joinedText(
      await render(
        summary({
          diagnosis: { ...summary().diagnosis, geneEvidenceOrigin: origin('absent', '未填') },
        }),
      ),
    );
    expect(joined).not.toContain('未填');
    expect(joined).not.toContain('服务端这一版没有把逐项来源发全');
  });

  it('护照 ID 在任何状态下都保持 metric —— 它是系统生成的，不是谁声称的', async () => {
    const renderer = await render(summary());
    const style = StyleSheet.flatten(nodeWithText(renderer, 'FSHD-A1B2C3D4E5')!.props.style);
    expect(style.fontVariant).toEqual(['tabular-nums']);
  });
});

describe('标题和提示只说证据，不说是谁填的', () => {
  it('未确诊时标题不再叫「证据摘要」，也不认领一个作者', async () => {
    const renderer = await render(summary());
    expect(allText(renderer)).toContain('诊断信息');
    expect(allText(renderer)).not.toContain('证据摘要');
    expect(joinedText(renderer)).not.toContain('本人填写的诊断信息');
  });

  it('基因确诊时标题仍然是「证据摘要」，也不出提示', async () => {
    const renderer = await render(geneticSummary());
    expect(allText(renderer)).toContain('证据摘要');
    expect(joinedText(renderer)).not.toContain('未经基因确诊');
  });

  it('管理员代填时也不说是管理员填的整块 —— 那个标记只关于「确诊年份」一个字段', async () => {
    // `confirmation` is derived from `foundation.diagnosisYear`'s
    // provenance entry alone, and this block holds values an
    // administrator has no way to write, so neither 「管理员代填的诊断
    // 信息」 nor 「本人填写的诊断信息」 can be said of it.
    const text = joinedText(
      await render(
        summary({ diagnosis: { ...summary().diagnosis, confirmation: 'admin_entered' } }),
      ),
    );
    expect(text).not.toContain('管理员代填的诊断信息');
    expect(text).not.toContain('本人填写的诊断信息');
  });

  it('提示说的是被检查过的那三项，不是「本平台尚未收到基因报告」', async () => {
    const text = joinedText(await render(summary()));
    expect(text).toContain('未经基因确诊');
    expect(text).toContain('D4Z4 重复数、4q 单倍型或 EcoRI 片段');
    expect(text).not.toContain('尚未收到');
  });

  it('只解析出甲基化值时，不说「没有可展示的证据」而下面正印着那个值', async () => {
    // 甲基化 is in none of the three confirmation tests, so a genetics
    // report that parsed to a methylation value and nothing else yields
    // `confirmation: 'none'`. The notice may not say there is nothing
    // to show while that report's own 甲基化值 is printed below it.
    const text = joinedText(
      await render(
        summary({
          summaryCards: [
            {
              key: 'diagnosis',
              title: '诊断证据',
              ready: false,
              summary: '缺少可直接展示的基因或诊断证据',
              meta: '诊断日期 —',
            },
          ],
          diagnosis: {
            ...summary().diagnosis,
            confirmation: 'none',
            geneticType: '—',
            diagnosisDate: '—',
            methylationValue: '35%',
            valueOrigins: {
              geneticType: origin('absent', '未填'),
              d4z4Repeats: origin('absent', '未填'),
              methylationValue: origin('report', '报告读取'),
              diagnosisDate: origin('absent', '未填'),
            },
          },
        }),
      ),
    );
    expect(text).toContain('35%');
    expect(text).toContain('报告读取');
    expect(text).not.toContain('缺少可直接展示的基因或诊断证据');
  });

  it('提示不是第四块琥珀色 —— 那个颜色在这个产品里只说一件事', async () => {
    // Amber is already spent on the PDF's unconfirmed banner. A second
    // one here makes it a decoration in both places.
    const notice = flat(styles.diagnosisNotice);
    const noticeText = flat(styles.diagnosisNoticeText);
    const { COLOR } = require('../../../lib/design');
    expect(notice.backgroundColor).toBeUndefined();
    expect(notice.borderLeftColor).not.toBe(COLOR.warn);
    expect(notice.borderLeftColor).not.toBe(COLOR.warnWash);
    expect(noticeText.color).not.toBe(COLOR.warn);
  });
});

/**
 * 功能分级 on the passport.
 *
 * The requirement is exact and it is not cosmetic: 「上肢 Brooke 3 级
 * （去年同期 2 级）」 must appear WITH the behavioural anchor, and a bare
 * number must never appear at all. This page gets printed and handed to
 * a neurologist who may see three FSHD patients a year, and this app
 * carries three scales at once — Brooke 1-6 and Vignos 1-10 both count
 * upward toward worse, while the MRC strength score on the same record
 * counts upward toward better. 「3」 alone is three different patients.
 *
 * Note what the fixtures do NOT do: they never state an anchor this
 * bundle authored. `levelLabelZh` comes off the wire, resolved by the
 * server against the version the patient answered, and the screen has
 * no fallback wording of its own to reach for.
 */
describe('§B3：这一页要说出哪些字段不是患者自己填的', () => {
  const ADMIN_ORIGIN = {
    path: 'diseaseBackground.d4z4',
    labelZh: 'D4Z4 重复数',
    state: 'admin_entered' as const,
    adminUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    at: '2026-08-13T04:11:07.912Z',
    detail: null,
  };

  it('诊断进度那一格说的是服务端给的那个来源，不是写死的「本人填写」', async () => {
    const renderer = await render(
      summary({
        diagnosis: {
          ...summary().diagnosis,
          ladder: 'confirmed',
          ladderLabel: '已确诊',
          ladderOriginZh: '管理员代填',
        },
      }),
    );
    const text = allText(renderer);
    expect(text).toContain('管理员代填的诊断进度');
    expect(text).not.toContain('本人填写的诊断进度');
  });

  // A cached bundle can reach an API build that sends the rung without
  // the origin. The rung still prints; the author does not, because the
  // same render says 「无法确认上面这些值是不是都由你本人填写」 a few
  // blocks down and this cell cannot know better than that sentence.
  it('服务端没给来源时，那一格不替患者认领这个答案', async () => {
    const renderer = await render(
      summary({
        diagnosis: { ...summary().diagnosis, ladder: 'confirmed', ladderLabel: '已确诊' },
      }),
    );
    const text = allText(renderer);
    expect(text).toContain('诊断进度');
    expect(text).toContain('已确诊');
    expect(text).not.toContain('本人填写的诊断进度');
    expect(text).toContain(
      '服务端这一版没有返回字段来源，无法确认上面这些值是不是都由你本人填写。',
    );
  });

  it('逐条列出被代填的字段，带上是谁、什么时候 —— PDF 和分享页早就列了', async () => {
    // §10（四）of the privacy policy names 「App 里」 by name. Until this
    // block the screen showed only the aggregate sentence, so the one
    // surface where a patient learns WHICH of their fields was typed
    // for them was a PDF they had to export first.
    const renderer = await render(summary({ fieldOrigins: [ADMIN_ORIGIN] }));
    const text = allText(renderer);
    expect(text).toContain('这些字段不是你本人填的');
    expect(text).toContain('D4Z4 重复数：「肌愈通」管理员于 2026-08-13 代为录入，不是你本人填写。');
  });

  it('读不出来的标记说自己读不出来，不借用患者的名义', async () => {
    const renderer = await render(
      summary({
        fieldOrigins: [
          {
            ...ADMIN_ORIGIN,
            state: 'unreadable',
            adminUserId: null,
            at: null,
            detail: 'adminUserId is not a user id',
          },
        ],
      }),
    );
    const text = allText(renderer);
    expect(text).toContain(
      'D4Z4 重复数：来源记录读不出来（adminUserId is not a user id），只能确定不是你本人填写。',
    );
  });

  it('一条标记都没有时整块不出现 —— 一个写着「无」的标题只会教人跳过它', async () => {
    const renderer = await render(summary({ fieldOrigins: [] }));
    const text = allText(renderer);
    expect(text).not.toContain('这些字段不是你本人填的');
    expect(text).not.toContain(
      '服务端这一版没有返回字段来源，无法确认上面这些值是不是都由你本人填写。',
    );
  });

  it('服务端这一版没给这个字段时说没给，不读成「都是本人填的」', async () => {
    // A cached WeChat bundle talking to an API build that predates the
    // field gets `undefined`, and reading that as an empty list is
    // exactly the false sentence this block exists to prevent.
    const renderer = await render(summary());
    expect(allText(renderer)).toContain(
      '服务端这一版没有返回字段来源，无法确认上面这些值是不是都由你本人填写。',
    );
  });
});

describe('功能分级：一个数字必须带着它的那句话', () => {
  const BROOKE_KEY = 'brooke_upper_extremity';
  const BROOKE_L3 = '手举不到头顶上方，但能把一杯约 240 毫升（8 盎司）的水端到嘴边。';
  const BROOKE_L2 = '只有先把手肘弯起来，才能把手举过头顶。';

  const administration = (over: Record<string, unknown> = {}) => ({
    id: 'a1',
    instrumentKey: BROOKE_KEY,
    instrumentVersion: 'v1',
    instrumentNameZh: 'Brooke 上肢功能分级',
    scoredValue: 3,
    levelLabelZh: BROOKE_L3,
    source: 'self',
    assistedBy: 'none',
    supersededById: null,
    administeredAt: '2026-08-01T00:00:00.000Z',
    createdAt: '2026-08-01T00:00:00.000Z',
    responses: [
      { itemCode: 'brooke_grade', responseValue: 3, skipped: false, notApplicable: false },
    ],
    ...over,
  });

  const catalogue = () => [
    {
      key: BROOKE_KEY,
      version: 'v1',
      nameZh: 'Brooke 上肢功能分级',
      descriptionZh: '',
      licenceStatus: 'free_with_attribution',
      sourceCitation: 'Brooke MH, et al. Muscle Nerve. 1981;4(3):186-97.',
      scoreMin: 1,
      scoreMax: 6,
      higherIsWorse: true,
      recallPeriod: 'current',
      adminMinutes: 2,
      limitationsZh: [],
      selfReportEvidenceZh: '',
      items: [{ code: 'brooke_grade', version: 'v1', promptZh: 'p', levels: [] }],
    },
  ];

  it('印出「上肢 Brooke 3 级（去年同期 2 级）」，并带上两级的描述', async () => {
    asMock(getInstrumentAdministrations).mockResolvedValue([
      administration({ id: 'now', administeredAt: '2026-08-01T00:00:00.000Z' }),
      administration({
        id: 'then',
        scoredValue: 2,
        levelLabelZh: BROOKE_L2,
        administeredAt: '2025-08-05T00:00:00.000Z',
      }),
    ]);
    const renderer = await render(summary());
    const text = allText(renderer).join('\n');

    expect(text).toContain('上肢 Brooke 3 级（去年同期 2 级）');
    expect(text).toContain(BROOKE_L3);
    // And last year's, so「变差了」says what the patient could do then.
    expect(text).toContain(BROOKE_L2);
  });

  it('标明是本人自评，并在目录可用时写出量表出处', async () => {
    asMock(getInstrumentAdministrations).mockResolvedValue([administration()]);
    asMock(getInstrumentCatalogue).mockResolvedValue(catalogue());
    const renderer = await render(summary());
    const text = allText(renderer).join('\n');
    expect(text).toContain('功能分级（本人自评）');
    expect(text).toContain('Muscle Nerve. 1981');
  });

  it('服务端说不出这一级是什么意思时，整块不出现', async () => {
    // levelLabelZh is null when the stored version is not in the
    // server's registry. Printing the number alone is the one outcome
    // worse than printing nothing.
    asMock(getInstrumentAdministrations).mockResolvedValue([
      administration({ levelLabelZh: null }),
    ]);
    const renderer = await render(summary());
    const text = allText(renderer).join('\n');
    expect(text).not.toContain('功能分级（本人自评）');
    expect(text).not.toContain('上肢 Brooke');
  });

  it('目录读不到时仍然渲染 —— 每一行自己带着那句话', async () => {
    asMock(getInstrumentAdministrations).mockResolvedValue([administration()]);
    asMock(getInstrumentCatalogue).mockRejectedValue(new Error('offline'));
    const renderer = await render(summary());
    const text = allText(renderer).join('\n');
    expect(text).toContain('上肢 Brooke 3 级');
    expect(text).toContain(BROOKE_L3);
    // No citation is printed rather than a remembered one.
    expect(text).not.toContain('Muscle Nerve');
  });

  it('接口还没上线时，护照其余部分照常渲染', async () => {
    asMock(getInstrumentAdministrations).mockRejectedValue(new Error('404 not found'));
    asMock(getInstrumentCatalogue).mockRejectedValue(new Error('404 not found'));
    const renderer = await render(geneticSummary());
    const text = allText(renderer).join('\n');
    expect(text).not.toContain('功能分级（本人自评）');
    // The page the patient actually came for is untouched.
    expect(text).toContain('FSHD-A1B2C3D4E5');
    expect(text).toContain('证据摘要');
  });

  it('一次记录时不编造对比', async () => {
    asMock(getInstrumentAdministrations).mockResolvedValue([administration()]);
    const renderer = await render(summary());
    const text = allText(renderer).join('\n');
    expect(text).toContain('上肢 Brooke 3 级');
    expect(text).not.toContain('去年同期');
  });
});

/**
 * 基因证据分级 + 《检查申请说明》 on the passport.
 *
 * The API has graded this since the genetics pass landed and no screen
 * rendered a byte of it. What was stranded is not a nicety: the one
 * sentence a Chinese FSHD patient is almost never told is that a
 * negative whole-exome report is not a negative answer, it is the wrong
 * test — the D4Z4 array cannot be sized by short reads (Giardina et al.
 * 2024, Clin Genet 106(1):13-26). That sentence, and the 《检查申请说明》
 * built around it, existed only in a JSON field nobody read.
 *
 * THE FIXTURES ARE REAL RESPONSE BODIES. Both were produced by running
 * the API's own `buildClinicalPassportSummary` over a profile and
 * copying `diagnosis.geneticEvidence` verbatim — not hand-written to
 * match what this screen happens to render. `getClinicalPassportSummary`
 * is an `apiRequest<T>` call and that type parameter is an unchecked
 * assertion, so a fixture written to fit the reader proves nothing
 * about the wire.
 *
 * `record` is dropped from both: the screen does not consume it (the
 * D4Z4 and haplotype values already have their own cells), so keeping
 * it here would suggest a coupling that does not exist.
 */

const METHOD_NOT_APPLICABLE = {
  grade: 'method_not_applicable',
  gradeLabel: '方法不适用',
  headline: '你上传的这份报告，用的方法测不到 FSHD 的位点',
  reason:
    '报告里明确写着做的是全外显子 / 全基因组 / panel 这类短读长测序。指南原文：D4Z4 重复序列的长度和单倍型无法由短读长的 WES 或 WGS 类技术测定。',
  action:
    '所以这份报告即使结论是阴性，也不能用来排除 FSHD——它没有测这个位点。不需要再花一次钱做同类测序；下面这份说明写清了该换成哪一项。',
  greyZoneNote: null,
  testRequest: {
    title: 'FSHD（面肩肱型肌营养不良）基因检查申请说明',
    intro:
      '这份说明由患者本人带来，内容摘自国际 FSHD 基因诊断最佳实践指南与国内综述，供接诊医生参考。患者无法判断该开哪张单子，只是希望在开单之前，这几条与常规基因检测不同的地方能被看到。',
    sections: [
      {
        heading: '为什么全外显子 / 全基因组测序读不到 FSHD',
        body: [
          'FSHD1 的病因是 4 号染色体 4q35 上 D4Z4 串联重复序列的拷贝数缩短。单个 D4Z4 单元长 3.3 kb，整段重复序列可长达 150 个单元（约 500 kb）。',
          '指南原文写明：D4Z4 重复序列的长度和单倍型「cannot be determined by short read WES- or WGS-like technologies」——短读长的全外显子、全基因组以及 panel 测序无法测定这两项。',
          '因此一份写着「未见明确致病变异」的全外显子报告，不能作为排除 FSHD 的依据：它测的不是这个位点。再做一次同类测序也不会有不同结果。',
        ],
        source:
          'Giardina E 等《面肩肱型肌营养不良基因诊断最佳实践指南：2012 版更新》，Clinical Genetics 2024;106(1):13-26，doi:10.1111/cge.14533',
      },
      {
        heading: '能测出 FSHD1 的方法',
        body: [
          'Southern blotting：EcoR I + Bln I 双酶切基因组 DNA，脉冲场凝胶电泳（PFGE）或琼脂糖凝胶电泳，联合 p13E-11 探针，再结合 4qA / 4qB 探针判断单倍型。',
          '指南列出的可用于长片段分析的方法有三种：SB-PFGE（脉冲场电泳后的 Southern blot）、光学基因组图谱（optical genome mapping, OGM）、分子梳（molecular combing, MC）。',
          '国内已有开展：复旦大学附属华山医院 2017 年 1 月至 2023 年 12 月对 247 例 FSHD 表型患者做 OGM 或分子梳的 4qA 等位基因分析，其中 219 例据此确诊 FSHD1（重复单元 2–9 个）。',
          '需要提前知道的一点：SB-PFGE 与分子梳需要琼脂糖包埋制备的高质量 DNA，对操作和设备要求高，不是每家实验室都能做——问清楚再抽血，可以少跑一趟。',
        ],
        source:
          '张成、李欢《面-肩-肱型肌营养不良症研究进展史》，中国现代神经疾病杂志 2019 年 5 月第 19 卷第 5 期；Giardina E 等《面肩肱型肌营养不良基因诊断最佳实践指南：2012 版更新》，Clinical Genetics 2024;106(1):13-26，doi:10.1111/cge.14533；Xia X 等（复旦大学附属华山医院）摘要 642P，Neuromuscular Disorders 2024;43:104441',
      },
      {
        heading: '报告上需要写明的内容',
        body: [
          '一、4 号染色体 D4Z4 重复单元数（U），以及所用的检测方法；',
          '二、该等位基因的 4qA / 4qB 单倍型——只有 4qA 是允许型，缺了这一项，重复单元数本身不足以下结论；',
          '三、若重复单元数大于 10 而临床仍高度怀疑，需加做 D4Z4 甲基化分析与 SMCHD1 测序，以评估 FSHD2。',
          '指南写明：FSHD 的基因分析建立在确定 4 号与 10 号染色体 D4Z4 重复序列的「长度和单倍型」这两项之上；而临床试验的入组无一例外要求已确认的分子遗传学诊断。',
        ],
        source:
          'Giardina E 等《面肩肱型肌营养不良基因诊断最佳实践指南：2012 版更新》，Clinical Genetics 2024;106(1):13-26，doi:10.1111/cge.14533',
      },
    ],
    printable:
      '【FSHD（面肩肱型肌营养不良）基因检查申请说明】\n\n这份说明由患者本人带来，内容摘自国际 FSHD 基因诊断最佳实践指南与国内综述，供接诊医生参考。患者无法判断该开哪张单子，只是希望在开单之前，这几条与常规基因检测不同的地方能被看到。\n\n■ 为什么全外显子 / 全基因组测序读不到 FSHD\n  FSHD1 的病因是 4 号染色体 4q35 上 D4Z4 串联重复序列的拷贝数缩短。单个 D4Z4 单元长 3.3 kb，整段重复序列可长达 150 个单元（约 500 kb）。\n  指南原文写明：D4Z4 重复序列的长度和单倍型「cannot be determined by short read WES- or WGS-like technologies」——短读长的全外显子、全基因组以及 panel 测序无法测定这两项。\n  因此一份写着「未见明确致病变异」的全外显子报告，不能作为排除 FSHD 的依据：它测的不是这个位点。再做一次同类测序也不会有不同结果。\n  出处：Giardina E 等《面肩肱型肌营养不良基因诊断最佳实践指南：2012 版更新》，Clinical Genetics 2024;106(1):13-26，doi:10.1111/cge.14533\n\n■ 能测出 FSHD1 的方法\n  Southern blotting：EcoR I + Bln I 双酶切基因组 DNA，脉冲场凝胶电泳（PFGE）或琼脂糖凝胶电泳，联合 p13E-11 探针，再结合 4qA / 4qB 探针判断单倍型。\n  指南列出的可用于长片段分析的方法有三种：SB-PFGE（脉冲场电泳后的 Southern blot）、光学基因组图谱（optical genome mapping, OGM）、分子梳（molecular combing, MC）。\n  国内已有开展：复旦大学附属华山医院 2017 年 1 月至 2023 年 12 月对 247 例 FSHD 表型患者做 OGM 或分子梳的 4qA 等位基因分析，其中 219 例据此确诊 FSHD1（重复单元 2–9 个）。\n  需要提前知道的一点：SB-PFGE 与分子梳需要琼脂糖包埋制备的高质量 DNA，对操作和设备要求高，不是每家实验室都能做——问清楚再抽血，可以少跑一趟。\n  出处：张成、李欢《面-肩-肱型肌营养不良症研究进展史》，中国现代神经疾病杂志 2019 年 5 月第 19 卷第 5 期；Giardina E 等《面肩肱型肌营养不良基因诊断最佳实践指南：2012 版更新》，Clinical Genetics 2024;106(1):13-26，doi:10.1111/cge.14533；Xia X 等（复旦大学附属华山医院）摘要 642P，Neuromuscular Disorders 2024;43:104441\n\n■ 报告上需要写明的内容\n  一、4 号染色体 D4Z4 重复单元数（U），以及所用的检测方法；\n  二、该等位基因的 4qA / 4qB 单倍型——只有 4qA 是允许型，缺了这一项，重复单元数本身不足以下结论；\n  三、若重复单元数大于 10 而临床仍高度怀疑，需加做 D4Z4 甲基化分析与 SMCHD1 测序，以评估 FSHD2。\n  指南写明：FSHD 的基因分析建立在确定 4 号与 10 号染色体 D4Z4 重复序列的「长度和单倍型」这两项之上；而临床试验的入组无一例外要求已确认的分子遗传学诊断。\n  出处：Giardina E 等《面肩肱型肌营养不良基因诊断最佳实践指南：2012 版更新》，Clinical Genetics 2024;106(1):13-26，doi:10.1111/cge.14533\n',
  },
  sources: [
    'Giardina E 等《面肩肱型肌营养不良基因诊断最佳实践指南：2012 版更新》，Clinical Genetics 2024;106(1):13-26，doi:10.1111/cge.14533',
  ],
};

const GREY_ZONE_TRIAL_READY = {
  grade: 'trial_ready',
  gradeLabel: '可用于入组',
  headline: '这份报告已经包含临床试验入组通常要求的两项内容',
  reason:
    'D4Z4 长度 8，单倍型 4qA。指南写明 FSHD 的基因分析基于确定重复序列的长度和单倍型两项，而临床试验入组要求已确认的分子遗传学诊断。',
  action:
    '把它和临床护照一起带去就诊或报名筛选即可。具体是否符合某一项试验的入组标准，仍由该试验的研究者判断——这里只说明材料是齐的。',
  greyZoneNote:
    '你的 D4Z4 重复单元数是 8，落在指南所说的 8–10 单元灰区：这个区间的 4qA 等位基因在欧洲对照人群中约有 1%–2% 的人携带且无症状。对 8 个单元，指南给出的报告口径是「可能致病」而不是「致病」。这不推翻你的诊断，只是说这一项结果本身带着不确定性，值得和医生确认一次。',
  testRequest: null,
  sources: [
    'Giardina E 等《面肩肱型肌营养不良基因诊断最佳实践指南：2012 版更新》，Clinical Genetics 2024;106(1):13-26，doi:10.1111/cge.14533',
  ],
};

const withEvidence = (evidence: unknown) => {
  const base = summary();
  return summary({ diagnosis: { ...base.diagnosis, geneticEvidence: evidence } });
};

/** The sentence this whole block exists to deliver. */
const WES_IS_THE_WRONG_TEST =
  '因此一份写着「未见明确致病变异」的全外显子报告，不能作为排除 FSHD 的依据：它测的不是这个位点。再做一次同类测序也不会有不同结果。';

describe('基因证据分级：分的是报告，不是人', () => {
  it('分级、结论、依据和下一步四样都上屏', async () => {
    const renderer = await render(withEvidence(METHOD_NOT_APPLICABLE));
    const text = allText(renderer).join('\n');
    expect(text).toContain('方法不适用');
    expect(text).toContain('你上传的这份报告，用的方法测不到 FSHD 的位点');
    expect(text).toContain('无法由短读长的 WES 或 WGS 类技术测定');
    expect(text).toContain('不需要再花一次钱做同类测序');
  });

  it('说清楚这是在评报告，不是在评人', async () => {
    // 「方法对，但结果不全」 is where most Chinese reports legitimately
    // land — 4qA permissiveness is routinely missing even from a proper
    // Southern blot — so this block must never read as a verdict on the
    // patient's diagnosis.
    const renderer = await render(withEvidence(METHOD_NOT_APPLICABLE));
    expect(allText(renderer)).toContain('关于报告，不是关于你');
  });

  it('分级不借用琥珀色 —— 那个颜色在这个产品里只说一件事', async () => {
    const { COLOR } = require('../../../lib/design');
    const block = flat(styles.geneticEvidenceBlock);
    const pill = flat(styles.geneticGradePill);
    expect(block.borderLeftColor).not.toBe(COLOR.warn);
    expect(pill.backgroundColor).not.toBe(COLOR.warnWash);
  });

  it('每一条结论都带着出处', async () => {
    const renderer = await render(withEvidence(METHOD_NOT_APPLICABLE));
    const text = allText(renderer).join('\n');
    expect(text).toContain('出处：Giardina E 等');
    expect(text).toContain('doi:10.1111/cge.14533');
  });

  it('灰区提示照常出现，即使这份报告已经不需要《检查申请说明》', async () => {
    // The 8-unit case grades `trial_ready` and carries `testRequest:
    // null` — the grey-zone note must not be gated on the document.
    const renderer = await render(withEvidence(GREY_ZONE_TRIAL_READY));
    const text = allText(renderer).join('\n');
    expect(text).toContain('8–10 单元灰区');
    expect(text).toContain('可能致病');
    expect(text).toContain('这不推翻你的诊断');
    expect(text).not.toContain('FSHD（面肩肱型肌营养不良）基因检查申请说明');
  });
});

describe('《检查申请说明》：得能出得去', () => {
  it('把「全外显子测不到这个位点」那句话印到屏幕上', async () => {
    const renderer = await render(withEvidence(METHOD_NOT_APPLICABLE));
    expect(allText(renderer).join('\n')).toContain(WES_IS_THE_WRONG_TEST);
  });

  it('三节内容和每节的出处都在，正文一行不落', async () => {
    const renderer = await render(withEvidence(METHOD_NOT_APPLICABLE));
    const text = allText(renderer).join('\n');
    const testRequest = METHOD_NOT_APPLICABLE.testRequest;
    expect(text).toContain(testRequest.title);
    expect(text).toContain(testRequest.intro);
    testRequest.sections.forEach((section) => {
      expect(text).toContain(section.heading);
      section.body.forEach((line) => expect(text).toContain(line));
      expect(text).toContain(`出处：${section.source}`);
    });
  });

  it('每一行都可选中 —— 复制发给医生是这份文件的第一用途', async () => {
    const renderer = await render(withEvidence(METHOD_NOT_APPLICABLE));
    const line = renderer.root
      .findAllByType(Text)
      .find((node) => readText(node) === WES_IS_THE_WRONG_TEST);
    expect(line?.props.selectable).toBe(true);
  });

  it('导出的那一页带着服务端拼好的全文', async () => {
    asMock(printToFileAsync).mockResolvedValue({ uri: 'file:///t.pdf' });
    const renderer = await render(withEvidence(METHOD_NOT_APPLICABLE));
    await pressAsync(renderer, '打印 / 导出这份说明');

    const html = asMock(printToFileAsync).mock.calls[0][0].html as string;
    expect(html).toContain(WES_IS_THE_WRONG_TEST);
    // No CDN, no web font, no remote stylesheet: this document is
    // opened in WeChat's in-app browser in mainland China, where an
    // external host at print time is a blank page.
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('导出失败时文字版还在 —— 会失败的是那张纸，不是内容', async () => {
    asMock(printToFileAsync).mockRejectedValue(new Error('no printer'));
    const renderer = await render(withEvidence(METHOD_NOT_APPLICABLE));
    await pressAsync(renderer, '打印 / 导出这份说明');
    expect(allText(renderer).join('\n')).toContain(WES_IS_THE_WRONG_TEST);
  });

  it('两项都齐的报告不再印这份说明', async () => {
    const renderer = await render(withEvidence(GREY_ZONE_TRIAL_READY));
    const text = allText(renderer).join('\n');
    expect(text).toContain('可用于入组');
    expect(text).not.toContain('FSHD（面肩肱型肌营养不良）基因检查申请说明');
  });
});

describe('服务端没给这一段的时候', () => {
  it('字段整个缺失时，护照其余部分照常渲染', async () => {
    // A web export cached in WeChat's browser for days can be talking
    // to an API build that predates this field. Reaching for
    // `.gradeLabel` there throws inside render and takes the diagnosis,
    // the reports and the timeline down with it.
    const renderer = await render(summary());
    const text = allText(renderer).join('\n');
    expect(text).toContain('FSHD-A1B2C3D4E5');
    expect(text).not.toContain('关于报告，不是关于你');
  });

  it('字段残缺时整块不出现，而不是出一半', async () => {
    // 「下一步该做什么」 is the half of this block a patient acts on. A
    // grade and a headline with no action is not a shorter answer.
    const withoutAction: Record<string, unknown> = { ...METHOD_NOT_APPLICABLE };
    delete withoutAction.action;
    const renderer = await render(withEvidence(withoutAction));
    const text = allText(renderer).join('\n');
    expect(text).not.toContain('方法不适用');
    expect(text).not.toContain(WES_IS_THE_WRONG_TEST);
    expect(text).toContain('FSHD-A1B2C3D4E5');
  });

  it('说明里某一节缺了出处时，不印一个空的「出处：」', async () => {
    const evidence = {
      ...METHOD_NOT_APPLICABLE,
      testRequest: {
        ...METHOD_NOT_APPLICABLE.testRequest,
        sections: [{ heading: '没有出处的一节', body: ['一句话'], source: null }],
      },
    };
    const renderer = await render(withEvidence(evidence));
    const text = allText(renderer);
    expect(text).toContain('一句话');
    expect(text).not.toContain('出处：');
  });
});

describe('诊断进度那一格', () => {
  it('答过的那一级按 API 的措辞出现，且不用 metric 字体', async () => {
    // 「what did you tell us」 and 「what does the evidence show」 are
    // different questions. This cell answers the first one and is not
    // evidence whatever the uploaded reports say, so it never takes the
    // 16.5pt/700/tabular-nums treatment even on a genetically confirmed
    // passport.
    const base = geneticSummary();
    const renderer = await render(
      summary({
        ...base,
        diagnosis: {
          ...base.diagnosis,
          ladder: 'confirmed_report_unavailable',
          ladderLabel: '已确诊，但报告不在手上',
        },
      }),
    );
    const node = nodeWithText(renderer, '已确诊，但报告不在手上');
    expect(node).toBeDefined();
    const style = StyleSheet.flatten(node!.props.style);
    expect(style.fontVariant).toBeUndefined();
    expect(style.fontWeight).not.toBe('700');
  });

  it('没答过的时候整格不出现，而不是印一个「—」', async () => {
    const renderer = await render(summary());
    expect(allText(renderer)).not.toContain('诊断进度');
  });
});
