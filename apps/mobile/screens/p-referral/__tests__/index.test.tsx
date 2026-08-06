/**
 * 转诊准备 — the screen.
 *
 * Two things only the screen can get wrong:
 *
 *  1. rendering a code without the system it belongs to. The content
 *     file pre-joins them into `quotable` precisely so no render site
 *     can split them; this test is what keeps the render site using it.
 *  2. telling a patient their question sheet is saved when it is not,
 *     or quietly persisting it on a device several members of one
 *     family share (see lib/draft-keys.ts). It is in component state,
 *     and the screen says so.
 */

import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('SafeAreaView', null, children),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
}));

/**
 * The network module is doubled rather than required for real: it
 * imports lib/api, which reaches AsyncStorage at module load, and
 * jest-expo has no native module for that. `isGeneticallyConfirmed` is
 * restated here because it is one comparison and its own behaviour —
 * including that an unrecognised value counts as unconfirmed — is
 * pinned in lib/__tests__/referral-pack-api.test.ts.
 */
const mockFetchPack = jest.fn();
jest.mock('../../../lib/referral-pack-api', () => ({
  fetchMyReferralPack: () => mockFetchPack(),
  isGeneticallyConfirmed: (pack: { diagnosisConfirmation: string }) =>
    pack.diagnosisConfirmation === 'genetic',
}));

import ReferralScreen from '../index';
import { DISEASE_IDENTITY_CODES } from '../../../lib/disease-identity-content';
import { REFERRAL_QUESTIONS } from '../question-sheet';
import styles from '../styles';

const collectText = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (node && typeof node === 'object' && 'children' in node) {
    return collectText((node as { children: unknown }).children);
  }
  return '';
};

const render = () => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<ReferralScreen />);
  });
  return tree;
};

const screenText = (tree: TestRenderer.ReactTestRenderer) => collectText(tree.toJSON() as unknown);

describe('身份码的呈现', () => {
  it('每一条都以「体系 + 码」的完整串出现在页面上', () => {
    const text = screenText(render());
    for (const entry of DISEASE_IDENTITY_CODES) {
      expect(text).toContain(entry.quotable);
    }
  });

  it('G71.02 在页面上永远带着「美国专用」和「仅限美国」', () => {
    const text = screenText(render());
    expect(text).toContain('美国专用');
    expect(text).toContain('仅限美国');
  });

  it('每条的出处都印在页面上', () => {
    const text = screenText(render());
    for (const entry of DISEASE_IDENTITY_CODES) {
      expect(text).toContain(entry.source);
    }
  });

  it('把没核实到的国内扩展码这件事也说出来', () => {
    expect(screenText(render())).toContain('病案室');
  });
});

describe('我想问的问题', () => {
  it('列出所有问题，并各自带出处', () => {
    const text = screenText(render());
    for (const question of REFERRAL_QUESTIONS) {
      expect(text).toContain(question.prompt);
      expect(text).toContain(question.source);
    }
  });

  it('勾选之前不显示清单，勾选之后才出现', () => {
    const tree = render();
    expect(screenText(tree)).not.toContain('下面是整理好的清单');

    const first = tree.root.findAll((node) => node.props.accessibilityRole === 'checkbox')[0];
    act(() => {
      first.props.onPress();
    });

    const text = screenText(tree);
    expect(text).toContain('下面是整理好的清单');
    expect(text).toContain(REFERRAL_QUESTIONS[0]!.prompt);
  });

  it('再点一次取消勾选，清单也随之消失', () => {
    const tree = render();
    const first = tree.root.findAll((node) => node.props.accessibilityRole === 'checkbox')[0];

    act(() => {
      first.props.onPress();
    });
    expect(screenText(tree)).toContain('下面是整理好的清单');

    act(() => {
      first.props.onPress();
    });
    expect(screenText(tree)).not.toContain('下面是整理好的清单');
  });

  it('只写自己的那一句、一条都不勾，也能生成清单', () => {
    const tree = render();
    const input = tree.root.findAll((node) => node.props.accessibilityLabel === '我自己想问的')[0];

    act(() => {
      input.props.onChangeText('我的肩膀最近抬不起来了，是不是进展了？');
    });

    const text = screenText(tree);
    expect(text).toContain('我自己想问的：');
    expect(text).toContain('我的肩膀最近抬不起来了');
  });

  it('每个问题行都报成 checkbox，并带上勾选状态', () => {
    const tree = render();
    // Pressable forwards its accessibility props to the views it
    // renders, so one row matches several times. The set of labels is
    // what the assertion is about: one checkbox per question, each
    // announcing the question itself rather than 「选项 3」.
    const labels = new Set(
      tree.root
        .findAll((node) => node.props.accessibilityRole === 'checkbox')
        .map((node) => node.props.accessibilityLabel as string),
    );
    expect(labels).toEqual(new Set(REFERRAL_QUESTIONS.map((question) => question.prompt)));

    const first = tree.root.findAll(
      (node) => node.props.accessibilityLabel === REFERRAL_QUESTIONS[0]!.prompt,
    )[0]!;
    expect(first.props.accessibilityState).toEqual({ checked: false });

    act(() => {
      first.props.onPress();
    });
    const after = tree.root.findAll(
      (node) => node.props.accessibilityLabel === REFERRAL_QUESTIONS[0]!.prompt,
    )[0]!;
    expect(after.props.accessibilityState).toEqual({ checked: true });
  });

  it('明说这一页不保存，因为设备可能是家里共用的', () => {
    const text = screenText(render());
    expect(text).toContain('不会保存');
    expect(text).toContain('家里几个人一起用');
  });
});

/* ------------------------------------------------------------------ */
/* 转诊资料                                                             */
/* ------------------------------------------------------------------ */

/**
 * The pack section. What only the render site can get wrong:
 *
 *  1. collapsing 「有报告，读不出」 into 「本平台没有记录」. The API
 *     preserves three states all the way through JSON and the client
 *     parser refuses to guess at a fourth; the last place the
 *     distinction can still die is here, in the chip this screen picks.
 *  2. showing a diagnosis sentence without the caution that belongs to
 *     it, on a document that is about to be handed to a doctor.
 *  3. leaving a stale pack on screen after a refresh failed — a
 *     document dated ten minutes ago that no longer matches the record.
 *  4. reaching the network on mount, which would break a page that
 *     works with no account and no signal.
 */

const PACK = {
  documentTitle: '张三 罕见病诊疗协作网转诊资料',
  generatedAt: '2026-08-05T12:00:00.000Z',
  diagnosisConfirmation: 'self_reported',
  diagnosisStatement:
    '面肩肱型肌营养不良症（FSHD）—— 本人填报，本平台未收到基因报告，请勿按已确诊处理',
  monitoring: [
    {
      key: 'respiratory',
      title: '肺功能',
      state: 'unreadable' as const,
      statement: '已上传该类报告（2026-02-10），但本平台未能自动读出数值 —— 请向患者索取原件',
      note: '指南建议每位 FSHD 患者都做一次肺功能基线。',
    },
    {
      key: 'cardiac',
      title: '心脏检查',
      state: 'absent' as const,
      statement: '本平台没有该类报告的记录 —— 不等于没有做过，请当面询问',
      note: null,
    },
  ],
  markdown: '# 张三 罕见病诊疗协作网转诊资料\n\n## 一、诊断依据\n\n- 结论：本人填报',
};

const renderAsync = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<ReferralScreen />);
  });
  return tree;
};

const pressGenerate = async (tree: TestRenderer.ReactTestRenderer) => {
  const button = tree.root.findAll(
    (node) =>
      node.props.accessibilityRole === 'button' &&
      typeof node.props.accessibilityLabel === 'string' &&
      node.props.accessibilityLabel.includes('转诊资料'),
  )[0]!;
  await act(async () => {
    button.props.onPress();
  });
  return button;
};

beforeEach(() => mockFetchPack.mockReset());

describe('转诊资料 —— 什么时候才发请求', () => {
  it('进页面不发请求，也不显示任何错误', async () => {
    const tree = await renderAsync();
    expect(mockFetchPack).not.toHaveBeenCalled();
    // The codes and the question sheet still have to be there for
    // someone with no account on a hospital's dead wifi.
    expect(screenText(tree)).toContain(DISEASE_IDENTITY_CODES[0]!.quotable);
    expect(screenText(tree)).not.toContain('生成失败');
  });

  it('按一次按钮才请求一次', async () => {
    mockFetchPack.mockResolvedValue(PACK);
    const tree = await renderAsync();
    await pressGenerate(tree);
    expect(mockFetchPack).toHaveBeenCalledTimes(1);
  });
});

describe('转诊资料 —— 渲染', () => {
  it('把完整的资料正文放到页面上，可长按选中', async () => {
    mockFetchPack.mockResolvedValue(PACK);
    const tree = await renderAsync();
    await pressGenerate(tree);

    const text = screenText(tree);
    expect(text).toContain(PACK.documentTitle);
    expect(text).toContain('## 一、诊断依据');
    const document = tree.root.findAll(
      (node) => node.props.selectable === true && node.props.children === PACK.markdown,
    );
    expect(document.length).toBeGreaterThan(0);
  });

  it('「有报告，读不出」不会被写成「本平台没有记录」', async () => {
    mockFetchPack.mockResolvedValue(PACK);
    const tree = await renderAsync();
    await pressGenerate(tree);

    const text = screenText(tree);
    expect(text).toContain('有报告，读不出');
    expect(text).toContain('请向患者索取原件');
    // And the absent slot keeps its own wording — the two must never
    // render as the same row.
    expect(text).toContain('本平台没有记录');
    expect(text).toContain('不等于没有做过');
  });

  it('「本平台没有记录」不会被染成告警色 —— 那是本平台的状态，不是患者的', async () => {
    mockFetchPack.mockResolvedValue(PACK);
    const tree = await renderAsync();
    await pressGenerate(tree);

    // Asserted on the chip LABEL rather than the chip view: a
    // Pressable-free View still matches twice (host + composite), and
    // the label carries the same styling decision without the noise.
    const labelStyles = (label: string) =>
      tree.root.findAll((node) => node.props.children === label).map((node) => node.props.style);

    const unreadable = labelStyles('有报告，读不出');
    const absent = labelStyles('本平台没有记录');
    expect(unreadable.length).toBeGreaterThan(0);
    expect(absent.length).toBeGreaterThan(0);
    expect(unreadable.every((style) => style === styles.packStateChipTextUnreadable)).toBe(true);
    expect(absent.every((style) => style === styles.packStateChipText)).toBe(true);
  });

  it('未经基因确诊的结论带着告警样式和那句警告', async () => {
    mockFetchPack.mockResolvedValue(PACK);
    const tree = await renderAsync();
    await pressGenerate(tree);

    const sentence = tree.root.findAll(
      (node) => node.props.children === PACK.diagnosisStatement,
    )[0]!;
    expect(collectText(sentence.props.children)).toContain('请勿按已确诊处理');
    expect(sentence.props.style).toContain(styles.packDiagnosisUnconfirmed);
  });

  it('基因确诊的结论不带告警样式', async () => {
    mockFetchPack.mockResolvedValue({
      ...PACK,
      diagnosisConfirmation: 'genetic',
      diagnosisStatement: '面肩肱型肌营养不良症（FSHD）—— 基因确诊',
    });
    const tree = await renderAsync();
    await pressGenerate(tree);

    const sentence = tree.root.findAll(
      (node) => typeof node.props.children === 'string' && node.props.children.includes('基因确诊'),
    )[0]!;
    expect(sentence.props.style).not.toContain(styles.packDiagnosisUnconfirmed);
  });

  it('说清楚这份资料是那一刻的快照，而且不存在这台设备上', async () => {
    mockFetchPack.mockResolvedValue(PACK);
    const tree = await renderAsync();
    await pressGenerate(tree);

    const text = screenText(tree);
    expect(text).toContain('生成于 2026-08-05');
    expect(text).toContain('之后新传的报告不在里面');
    expect(text).toContain('不会保存在这台设备上');
  });

  it('生成时间读不出来时就不印日期，而不是印一个错的', async () => {
    mockFetchPack.mockResolvedValue({ ...PACK, generatedAt: 'not-a-date' });
    const tree = await renderAsync();
    await pressGenerate(tree);
    expect(screenText(tree)).not.toContain('生成于');
  });
});

describe('转诊资料 —— 失败时说人话', () => {
  it('401 说的是「需要先登录」，不是「出错了」', async () => {
    mockFetchPack.mockRejectedValue(Object.assign(new Error('请求失败'), { status: 401 }));
    const tree = await renderAsync();
    await pressGenerate(tree);
    expect(screenText(tree)).toContain('需要先登录');
  });

  it('404 说的是「还没有你的健康档案」，并指出去哪里补', async () => {
    mockFetchPack.mockRejectedValue(
      Object.assign(new Error('Patient profile not found'), {
        status: 404,
      }),
    );
    const tree = await renderAsync();
    await pressGenerate(tree);
    const text = screenText(tree);
    expect(text).toContain('还没有你的健康档案');
    expect(text).toContain('注册资料');
  });

  it('429 之类的把服务器那句话原样转达出去', async () => {
    mockFetchPack.mockRejectedValue(
      Object.assign(new Error('生成转诊资料过于频繁，请稍后再试'), { status: 429 }),
    );
    const tree = await renderAsync();
    await pressGenerate(tree);
    expect(screenText(tree)).toContain('生成转诊资料过于频繁');
  });

  it('重新生成失败时，上一份资料被清掉，不会留一份过期的在屏幕上', async () => {
    mockFetchPack.mockResolvedValueOnce(PACK);
    const tree = await renderAsync();
    await pressGenerate(tree);
    expect(screenText(tree)).toContain('## 一、诊断依据');

    mockFetchPack.mockRejectedValueOnce(Object.assign(new Error('网络连接不稳定'), { status: 0 }));
    await pressGenerate(tree);

    const text = screenText(tree);
    expect(text).not.toContain('## 一、诊断依据');
    expect(text).toContain('网络连接不稳定');
  });
});
