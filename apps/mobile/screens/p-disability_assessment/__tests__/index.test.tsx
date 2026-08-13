/**
 * 残疾评定准备 — the screen.
 *
 * The content tests next door pin what the page says. These pin the two
 * things only the screen can get wrong:
 *
 *  1. The eight-activity block must not show a running subtotal, and the
 *     total it does eventually show must arrive with the sentence saying
 *     it converts to no grade — in the rendered output, not merely as an
 *     export nobody placed.
 *  2. The functional-impairment clauses must be visible above the grade
 *     lists. They are what makes the standard apply to FSHD and they sit
 *     last in every grade; a refactor that drops the lifted block leaves
 *     a page that is still accurate and still useless.
 */

import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
// Icon.tsx renders Ionicons, which loads its font asynchronously and
// setStates outside act(). Stubbed to a host string.
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

import DisabilityAssessmentScreen from '../index';
import { ADL_ITEMS, ADL_SCORE_DISCLAIMER } from '../../../lib/disability-assessment-content';

/** Every string the screen renders, in document order, concatenated —
 *  a single <Text> splits its interpolations into separate children, and
 *  the assertion is about what a patient reads. */
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
    tree = TestRenderer.create(<DisabilityAssessmentScreen />);
  });
  return tree;
};

/** Presses one answer chip. `label` is the accessibilityLabel the chip
 *  carries, e.g. 「端坐：能实现」. */
const answer = (tree: TestRenderer.ReactTestRenderer, itemLabel: string, choice: string) => {
  const node = tree.root.findAll(
    (instance) =>
      typeof instance.props.accessibilityLabel === 'string' &&
      instance.props.accessibilityLabel === `${itemLabel}：${choice}` &&
      typeof instance.props.onPress === 'function',
  )[0];
  act(() => {
    node.props.onPress();
  });
};

describe('功能障碍条款被拎到了正文前面', () => {
  it('三级那一条在页面上出现两次：拎出来一次，原文列表里一次', () => {
    const text = collectText(render().toJSON());
    const clause = '一肢功能重度障碍或二肢功能中度障碍。';
    const occurrences = text.split(clause).length - 1;
    expect(occurrences).toBe(2);
  });

  it('拎出来的那一段解释了它们为什么容易被漏读', () => {
    const text = collectText(render().toJSON());
    expect(text).toContain('先读这几条');
    expect(text).toContain('排在缺失类条款的后面');
  });

  it('原文四级全文都还在，没有只留下好看的那几条', () => {
    const text = collectText(render().toJSON());
    expect(text).toContain('肢体残疾一级');
    expect(text).toContain('肢体残疾二级');
    expect(text).toContain('肢体残疾三级');
    expect(text).toContain('肢体残疾四级');
    expect(text).toContain('四肢瘫：四肢运动功能重度丧失');
  });
});

describe('八项自述的合计', () => {
  it('一项都没填时不显示数字', () => {
    const text = collectText(render().toJSON());
    expect(text).toContain('八项里已填 0 项，全部填完才会显示合计');
  });

  it('填了一部分仍然不显示合计，只报进度', () => {
    // A running subtotal is a number that looks like a result. Revert
    // tallyAdl's「null until all eight」and this goes red.
    const tree = render();
    answer(tree, '端坐', '能实现');
    answer(tree, '站立', '实现困难');
    const text = collectText(tree.toJSON());
    expect(text).toContain('八项里已填 2 项，全部填完才会显示合计');
    expect(text).not.toContain('八项合计');
  });

  it('八项全填完才给合计，并且算得对', () => {
    const tree = render();
    ADL_ITEMS.forEach((item) => answer(tree, item.label, '实现困难'));
    const text = collectText(tree.toJSON());
    expect(text).toContain('4.0');
    expect(text).toContain('八项合计（满分 8）');
  });

  it('合计出现的同时，「换算不出等级」那句也在页面上', () => {
    // The number and the sentence that keeps it honest must not be
    // separable by a layout edit.
    const tree = render();
    ADL_ITEMS.forEach((item) => answer(tree, item.label, '能实现'));
    const text = collectText(tree.toJSON());
    expect(text).toContain('8.0');
    expect(text).toContain(ADL_SCORE_DISCLAIMER);
  });
});

describe('自述文字', () => {
  it('未填的项显示为「（未填）」，不静默当成「能实现」', () => {
    const tree = render();
    answer(tree, '洗漱', '不能实现');
    const text = collectText(tree.toJSON());
    expect(text).toContain('洗漱：不能实现');
    expect(text).toContain('行走：（未填）');
  });

  it('自述那一段是可选中的，因为它的用途就是复制出去或照着念', () => {
    const tree = render();
    const selectable = tree.root.findAll(
      (instance) =>
        instance.props.selectable === true &&
        typeof instance.props.children === 'string' &&
        instance.props.children.startsWith('我的日常生活活动自述'),
    );
    // >0 rather than ==1: findAll walks both the composite <Text> and
    // the host element it renders to, so one line matches twice.
    expect(selectable.length).toBeGreaterThan(0);
  });
});

describe('这一页不预测等级', () => {
  it('渲染出来的整页文字里没有等级预测', () => {
    const tree = render();
    ADL_ITEMS.forEach((item) => answer(tree, item.label, '不能实现'));
    const text = collectText(tree.toJSON());
    // 0 分 is the most tempting state to editorialise on.
    expect(text).not.toMatch(/你(应该|大概|多半|很可能)能评/);
    expect(text).not.toMatch(/可以评上|能评上/);
    expect(text).toContain('不预测评定结果');
  });
});

describe('材料清单', () => {
  it('规定项和建议项在页面上分得开', () => {
    const text = collectText(render().toJSON());
    expect(text).toContain('办法要求');
    expect(text).toContain('本页建议');
  });
});

describe('资料截至', () => {
  it('日期在页面上，而且在正文之前', () => {
    const text = collectText(render().toJSON());
    expect(text).toContain('资料截至');
    expect(text.indexOf('资料截至')).toBeLessThan(text.indexOf('肢体残疾一级'));
  });
});
