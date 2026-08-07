/**
 * 康复：辅具与运动 — the screen.
 *
 * The content tests next door pin what the two modules say. These pin
 * the three things only the renderer can get wrong:
 *
 *  1. The two standing rules must be on screen at every endpoint of
 *     the orthosis flow — including the endpoint where no device
 *     matched, which is the one a layout edit would prune.
 *  2. The referral block and the four named clinicians must be on
 *     screen from the start, not only after the flow is complete. A
 *     patient who answers nothing should still leave with the list.
 *  3. On the exercise tab, 「这个方案和原研究的差别」 must appear ABOVE
 *     the first trial number in document order. Under it, the reader
 *     has already treated an RPE plan as the thing that produced the
 *     trial's VO2peak gain.
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

import RehabShareScreen from '../index';
import { TRIAL_FACTS } from '../../../lib/home-exercise-content';

/** Every string the screen renders, in document order, concatenated. */
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
    tree = TestRenderer.create(<RehabShareScreen />);
  });
  return tree;
};

const press = (tree: TestRenderer.ReactTestRenderer, accessibilityLabel: string) => {
  const node = tree.root.findAll(
    (instance) =>
      instance.props.accessibilityLabel === accessibilityLabel &&
      typeof instance.props.onPress === 'function',
  )[0];
  if (!node) throw new Error(`no pressable labelled ${accessibilityLabel}`);
  act(() => {
    node.props.onPress();
  });
};

/** Switches to the 六个月运动 tab via the segmented control. */
const openExerciseTab = (tree: TestRenderer.ReactTestRenderer) => press(tree, '六个月运动');

describe('辅具流：两条通则和就诊清单是无条件的', () => {
  it('什么都没答的时候，两条通则已经在页面上', () => {
    const text = collectText(render().toJSON());
    expect(text).toContain('先试用，再定制');
    expect(text).toContain('矫形器和助行器要一起开、一起练');
  });

  it('什么都没答的时候，四位康复医师也已经在页面上', () => {
    const text = collectText(render().toJSON());
    expect(text).toContain('带这份清单去找康复师');
    ['孙杨', '范亚蓓', '张光宇', '邓景元'].forEach((name) => {
      expect(text).toContain(name);
    });
  });

  it('全部答「还好」— 一件辅具都没推荐 — 通则和清单仍然在', () => {
    const tree = render();
    press(tree, '脚踝：勾脚背：脚是我自己控制着放下去的，不拍地也不拖地');
    press(tree, '大腿前侧：股四头肌：能自己站起来、能上楼，不用撑扶手');
    press(tree, '躯干：上半身撑不撑得住：撑得住，坐姿站姿没有明显问题');
    press(tree, '走路的稳定和平衡：走路不稳的问题还不明显');

    const text = collectText(tree.toJSON());
    expect(text).toContain('现在还没到 AFO 这一档');
    expect(text).toContain('现在还没到助行器这一档');
    expect(text).toContain('先试用，再定制');
    expect(text).toContain('矫形器和助行器要一起开、一起练');
    expect(text).toContain('带这份清单去找康复师');
  });
});

describe('辅具流：不完整的清单不装成完整的', () => {
  it('没答完时页面直接说这份是不完整的', () => {
    const text = collectText(render().toJSON());
    expect(text).toContain('这份是不完整的');
  });

  it('答完之后那句话换成「已经答完」', () => {
    const tree = render();
    press(tree, '脚踝：勾脚背：迈步的时候脚尖会拖地，绊过或差一点绊倒');
    press(tree, '小腿：蹬地的力气：蹬地还有力，站着的时候膝盖是稳的');
    press(tree, '大腿前侧：股四头肌：能自己站起来、能上楼，不用撑扶手');
    press(tree, '躯干：上半身撑不撑得住：撑得住，坐姿站姿没有明显问题');
    press(tree, '走路的稳定和平衡：主要是一条腿不稳');

    const text = collectText(tree.toJSON());
    expect(text).toContain('已经答完');
    expect(text).not.toContain('这份是不完整的');
    expect(text).toContain('轻便、动态的后侧 AFO');
    expect(text).toContain('单根手杖，拄在不稳那条腿的对侧');
  });
});

describe('辅具流：三种状态在页面上分得开', () => {
  it('「指南没写这一档」和「这一档现在对不上」不是同一个标签', () => {
    const tree = render();
    press(tree, '大腿前侧：股四头肌：要用手撑着膝盖或扶东西才站得起来，上楼得拉扶手');
    press(tree, '脚踝：勾脚背：脚是我自己控制着放下去的，不拍地也不拖地');
    const text = collectText(tree.toJSON());
    expect(text).toContain('指南没写这一档');
    expect(text).toContain('这一档现在对不上');
  });
});

describe('运动方案：替代说明在数字前面', () => {
  it('「这个方案和原研究的差别」出现在第一个实测数字之前', () => {
    const tree = render();
    openExerciseTab(tree);
    const text = collectText(tree.toJSON());
    const noteAt = text.indexOf('这个方案和原研究的差别');
    // Read the first result off the module rather than pasting the
    // percentage in: a hardcoded 「+19%」 went on matching after the
    // VO2peak figure was corrected to the week-24 value, because the
    // week-6 number is still quoted further down inside the detail.
    const firstResult = TRIAL_FACTS.find((fact) => fact.id === 'vo2peak')!.value;
    const numberAt = text.indexOf(firstResult);
    expect(noteAt).toBeGreaterThan(-1);
    expect(numberAt).toBeGreaterThan(-1);
    expect(noteAt).toBeLessThan(numberAt);
  });

  it('自觉用力程度那一节带着「本页的替代做法」标签', () => {
    const tree = render();
    openExerciseTab(tree);
    const text = collectText(tree.toJSON());
    expect(text).toContain('强度怎么定（自觉用力程度）');
    expect(text).toContain('本页的替代做法（不是原研究的方法）');
  });

  it('论文里查不到的部分被写出来了，而不是被填上', () => {
    const tree = render();
    openExerciseTab(tree);
    const text = collectText(tree.toJSON());
    expect(text).toContain('论文里查不到的部分');
    expect(text).toContain('Figure 3');
  });

  it('指南自己给的「低等级」和那条负面结论都在页面上', () => {
    const tree = render();
    openExerciseTab(tree);
    const text = collectText(tree.toJSON());
    expect(text).toContain('全部标为「低等级」');
    expect(text).toContain('有氧训练不能改善 FSHD 患者的活动能力');
  });
});

describe('两个标签页都不是空的', () => {
  it('默认落在辅具流，切过去是运动方案', () => {
    const tree = render();
    expect(collectText(tree.toJSON())).toContain('关于你走路的几个问题');
    openExerciseTab(tree);
    const text = collectText(tree.toJSON());
    expect(text).toContain('原研究做了什么，结果是什么');
    expect(text).not.toContain('关于你走路的几个问题');
  });
});
