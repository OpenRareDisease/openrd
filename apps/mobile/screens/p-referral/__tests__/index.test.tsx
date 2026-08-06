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

import ReferralScreen from '../index';
import { DISEASE_IDENTITY_CODES } from '../../../lib/disease-identity-content';
import { REFERRAL_QUESTIONS } from '../question-sheet';

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
