/**
 * 临床护照 screen — the two things on it that are not decoration.
 *
 * 1. The anesthesia card exists in two carriers. It used to be a PNG
 *    only, which means a screen reader got the card's *name* and not
 *    「避免琥珀胆碱」, the type did not reflow at 200%, and nothing on it
 *    could be copied into WeChat to send a surgical team in advance.
 *
 * 2. The diagnosis cells are typeset according to
 *    `diagnosis.confirmation`. The API has carried that field for a
 *    while and the PDF honours it; this screen did not read it, so a
 *    diagnosis the patient typed into a text box was set in the same
 *    16.5pt/700/tabular-nums metric type as a D4Z4 repeat count off a
 *    genetics report, under a heading that said 证据摘要. This
 *    population lives through a ~10-year diagnostic odyssey with a
 *    majority misdiagnosed on the way; a well-set number is read as a
 *    measurement, and that is the mechanism.
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
    ApiError,
    isConsentRequiredError: () => false,
    getClinicalPassportSummary: jest.fn(),
    getMyPatientProfile: jest.fn(),
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
import { getClinicalPassportSummary, getMyPatientProfile } from '../../../lib/api';
import { renderAnesthesiaCardPng } from '../../../lib/anesthesia-card-image';
import type { ClinicalPassportSummary } from '../../../lib/api';

const asMock = <T,>(fn: T) => fn as unknown as jest.Mock;

/** StyleSheet.flatten keeps the literal types from `StyleSheet.create`,
 *  so asking whether a key is absent is a type error rather than a
 *  question. Absence is exactly what these tests check. */
const flat = (style: unknown) =>
  StyleSheet.flatten(style as never) as unknown as Record<string, unknown>;

const SELF_REPORTED_NOTICE = '未经基因确诊 —— 以下为本人填写，尚无基因报告佐证';

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
        summary: SELF_REPORTED_NOTICE,
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
      geneEvidence: '暂无可直接展示的基因证据',
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

const geneticSummary = () =>
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
      geneEvidence: 'FSHD1 · 4qA · 18kb · 4',
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

beforeEach(() => {
  jest.clearAllMocks();
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
    expect(text).toContain('诊断：FSHD —— 本人填报，本平台尚未收到基因报告');
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

describe('三态诊断：自填的不能长得像测出来的', () => {
  const DIAGNOSIS_VALUES = ['FSHD1', '2023-05-01'];

  it('未确诊时四个诊断格降到正文字重，并且不用等宽数字', async () => {
    const renderer = await render(summary());
    DIAGNOSIS_VALUES.forEach((value) => {
      const node = nodeWithText(renderer, value);
      expect(node).toBeDefined();
      const style = StyleSheet.flatten(node!.props.style);
      expect(style.fontVariant).toBeUndefined();
      expect(style.fontWeight).not.toBe('700');
    });
  });

  it('基因确诊时保持 metric 字体', async () => {
    const renderer = await render(geneticSummary());
    const node = nodeWithText(renderer, '4');
    const style = StyleSheet.flatten(node!.props.style);
    expect(style.fontWeight).toBe('700');
    expect(style.fontVariant).toEqual(['tabular-nums']);
  });

  it('护照 ID 在任何状态下都保持 metric —— 它是系统生成的，不是谁声称的', async () => {
    const renderer = await render(summary());
    const style = StyleSheet.flatten(nodeWithText(renderer, 'FSHD-A1B2C3D4E5')!.props.style);
    expect(style.fontVariant).toEqual(['tabular-nums']);
  });

  it('未确诊时标题不再叫「证据摘要」', async () => {
    const renderer = await render(summary());
    const text = allText(renderer);
    expect(text).toContain('本人填写的诊断信息');
    expect(text).not.toContain('证据摘要');
  });

  it('基因确诊时标题仍然是「证据摘要」，也不出提示', async () => {
    const renderer = await render(geneticSummary());
    const text = allText(renderer);
    expect(text).toContain('证据摘要');
    expect(text).not.toContain('本人填写的诊断信息');
    expect(text).not.toContain(SELF_REPORTED_NOTICE);
  });

  it('提示原样复用 summaryCards 的那句话，不另写一句', async () => {
    // Two wordings for the same fact is two things to keep in step, and
    // the PDF exported from this screen already prints one of them.
    const renderer = await render(summary());
    expect(allText(renderer)).toContain(SELF_REPORTED_NOTICE);
  });

  it('confirmation 为 none 时同样降级', async () => {
    const none = summary({
      summaryCards: [
        {
          key: 'diagnosis',
          title: '诊断证据',
          ready: false,
          summary: '缺少可直接展示的基因或诊断证据',
          meta: '诊断日期 —',
        },
      ],
      diagnosis: { ...summary().diagnosis, confirmation: 'none' },
    });
    const renderer = await render(none);
    const text = allText(renderer);
    expect(text).toContain('缺少可直接展示的基因或诊断证据');
    expect(text).not.toContain('证据摘要');
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
