/**
 * 病友经验 — the rendered shelf.
 *
 * Three claims are checked here that the data tests cannot make,
 * because they are claims about what a patient sees:
 *
 *  - the switch that governs contextual stories starts off, and the
 *    thing it would do is printed under it while it is still off;
 *  - the memoir renders top-to-bottom in instalment order;
 *  - the excerpt on a card is the author's sentence, verbatim, with
 *    their name beside it.
 */

import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

let mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => Promise.resolve(mockStore.get(key) ?? null),
  setItem: (key: string, value: string) => {
    mockStore.set(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    mockStore.delete(key);
    return Promise.resolve();
  },
}));

// Ionicons loads its font asynchronously and setStates outside act();
// these assertions are about copy and order, not glyphs.
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));

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

import CommunityScreen from '../index';
import ToggleSwitch from '../../common/ToggleSwitch';
import { STORY_HOOKS_ENABLED_KEY } from '../story-hooks';
import { getPullQuote, getStory, storiesForTheme } from '../../../lib/community-stories-content';

const renderScreen = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<CommunityScreen />);
  });
  return tree;
};

const allText = (tree: TestRenderer.ReactTestRenderer): string =>
  tree.root
    .findAllByType(Text)
    .map((node) =>
      node.props.children === undefined
        ? ''
        : String(
            Array.isArray(node.props.children) ? node.props.children.join('') : node.props.children,
          ),
    )
    .join('\n');

beforeEach(() => {
  mockStore = new Map();
});

describe('页面开门见山', () => {
  it('先说这是别人的经历、不是医学建议，再放故事', async () => {
    const tree = await renderScreen();
    const text = allText(tree);

    expect(text).toContain('不转载全文');
    expect(text).toContain('不是医学建议');

    // The caveat has to be above the first story, not in a footer
    // nobody scrolls to.
    const first = storiesForTheme('diagnosis')[0];
    expect(text.indexOf('不是医学建议')).toBeLessThan(text.indexOf(first.title));
  });

  it('第一屏就是求医之路，21 篇的总数写在页面上', async () => {
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain('求医之路');
    expect(text).toContain('共 21 篇');
  });
});

describe('故事卡片', () => {
  it('摘录是作者原话，并且署了作者的名字', async () => {
    const tree = await renderScreen();
    const text = allText(tree);

    const story = getStory('twenty-years-of-failed-treatment')!;
    expect(text).toContain(getPullQuote(story)!.text);
    expect(text).toContain(story.origin.byline);
    // 「读原文」 is the way out to the whole thing — the shelf never
    // pretends the excerpt is the story.
    expect(text).toContain('读原文');
  });
});

describe('连载必须按顺序出现在页面上', () => {
  it('家人一栏里，连载 1 到 4 从上往下依次排列', async () => {
    const tree = await renderScreen();

    await act(async () => {
      // Switch to 家人 by pressing its segment. SegmentedControl gives
      // each segment accessibilityRole="tab", not "button".
      const segment = tree.root
        .findAll(
          (node) =>
            node.props?.accessibilityRole === 'tab' && node.props?.accessibilityLabel === '家人',
        )
        .at(0);
      segment?.props?.onPress?.();
    });

    const text = allText(tree);
    const positions = [1, 2, 3, 4].map((part) => text.indexOf('连载 ' + part + ' / 4'));

    positions.forEach((position) => expect(position).toBeGreaterThanOrEqual(0));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

describe('情境提示的开关', () => {
  it('默认是关的', async () => {
    // The rendered counterpart of the story-hooks default. A switch
    // whose stored value is off but which draws as on would opt a
    // patient in with one accidental tap that reads as「turning it
    // off」.
    const tree = await renderScreen();
    const toggle = tree.root.findByType(ToggleSwitch);
    expect(toggle.props.isEnabled).toBe(false);
  });

  it('还没打开的时候，就已经写清楚它会在什么时候出现', async () => {
    const tree = await renderScreen();
    const text = allText(tree);

    expect(text).toContain('默认关闭');
    expect(text).toContain('记录了一次跌倒');
    expect(text).toContain('把爬楼测试标记为「今天做不了」');
    expect(text).toContain('第一次记录使用踝足矫形器（AFO）');
    expect(text).toContain('一键关掉');
  });

  it('设备上存的是 true 时，开关才画成打开', async () => {
    mockStore.set(STORY_HOOKS_ENABLED_KEY, 'true');
    const tree = await renderScreen();
    expect(tree.root.findByType(ToggleSwitch).props.isEnabled).toBe(true);
  });

  it('打开之后才出现「让关掉过的卡片重新出现」，并且它真的会清掉记录', async () => {
    // resetStoryHookDismissals must have a caller. An exported reset
    // that no screen invokes is the pattern this repo has been bitten
    // by seven times, and here it would mean 一键关掉 is irreversible.
    mockStore.set(STORY_HOOKS_ENABLED_KEY, 'true');
    mockStore.set('openrd.community.storyHooks.dismissed', JSON.stringify(['fall-logged']));

    const tree = await renderScreen();
    expect(allText(tree)).toContain('让关掉过的卡片重新出现');

    const reset = tree.root
      .findAll((node) => node.props?.accessibilityRole === 'button')
      .find((node) => node.props?.accessibilityLabel === '让关掉过的卡片重新出现');
    expect(reset).toBeDefined();

    await act(async () => {
      reset?.props?.onPress?.();
    });

    expect(mockStore.has('openrd.community.storyHooks.dismissed')).toBe(false);
  });

  it('关着的时候不显示重置入口', async () => {
    const tree = await renderScreen();
    expect(allText(tree)).not.toContain('让关掉过的卡片重新出现');
  });
});
