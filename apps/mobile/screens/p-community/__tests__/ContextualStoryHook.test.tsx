/**
 * The card that appears beside a fall entry — and, by default, doesn't.
 *
 * story-hooks.test.ts proves the resolver returns null. This proves the
 * component renders *nothing* when it does: no placeholder, no
 * skeleton, no empty card with a border. A 200ms grey box that appears
 * after someone records a fall and then vanishes is still the app
 * reacting visibly to a decline.
 */

import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';

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

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => true,
  }),
}));

import ContextualStoryHook from '../ContextualStoryHook';
import { STORY_HOOKS_DISMISSED_KEY, STORY_HOOKS_ENABLED_KEY } from '../story-hooks';
import { getExcerpt, getStory } from '../../../lib/community-stories-content';

const render = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<ContextualStoryHook hookId="fall-logged" />);
  });
  return tree;
};

beforeEach(() => {
  mockStore = new Map();
});

describe('默认什么都不画', () => {
  it('没打开开关时，整个组件渲染为空', async () => {
    const tree = await render();
    expect(tree.toJSON()).toBeNull();
  });

  it('打开过又关掉，也是空的', async () => {
    mockStore.set(STORY_HOOKS_ENABLED_KEY, 'false');
    const tree = await render();
    expect(tree.toJSON()).toBeNull();
  });

  it('已经一键关掉过这一类的，即使开关是开的也不画', async () => {
    mockStore.set(STORY_HOOKS_ENABLED_KEY, 'true');
    mockStore.set(STORY_HOOKS_DISMISSED_KEY, JSON.stringify(['fall-logged']));
    const tree = await render();
    expect(tree.toJSON()).toBeNull();
  });
});

describe('打开之后', () => {
  beforeEach(() => {
    mockStore.set(STORY_HOOKS_ENABLED_KEY, 'true');
  });

  const textOf = (tree: TestRenderer.ReactTestRenderer) =>
    tree.root
      .findAllByType(Text)
      .map((node) => (node.props.children === undefined ? '' : String(node.props.children)))
      .join('\n');

  it('先说这不是对刚才那条记录的判断，再放病友的原话', async () => {
    const tree = await render();
    const text = textOf(tree);

    expect(text).toContain('这不是对你刚才那条记录的判断');

    const story = getStory('focus-on-now')!;
    const excerpt = getExcerpt(story, 'falling')!;
    expect(text).toContain(excerpt.text);
    expect(text).toContain(story.origin.byline);

    // The card must never characterise what was just recorded.
    ['加重', '下降', '变差', '恶化'].forEach((word) => expect(text).not.toContain(word));
  });

  it('一次点击就永久关掉这一类', async () => {
    const tree = await render();
    const onDismissed = jest.fn();

    const dismiss = tree.root
      .findAllByType(TouchableOpacity)
      .find((node) => node.props.accessibilityLabel === '不再显示这类内容');
    expect(dismiss).toBeDefined();

    await act(async () => {
      dismiss?.props.onPress();
    });

    // Gone from this render...
    expect(tree.toJSON()).toBeNull();
    // ...and gone from the next one, which is the part that matters:
    // a card that returns on the second fall makes the app look like
    // it is counting them.
    expect(JSON.parse(mockStore.get(STORY_HOOKS_DISMISSED_KEY) ?? '[]')).toEqual(['fall-logged']);

    const again = await render();
    expect(again.toJSON()).toBeNull();
    expect(onDismissed).not.toHaveBeenCalled();
  });

  it('关掉时通知父组件，好让它收掉自己的间距', async () => {
    const onDismissed = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ContextualStoryHook hookId="fall-logged" onDismissed={onDismissed} />,
      );
    });

    await act(async () => {
      tree.root
        .findAllByType(TouchableOpacity)
        .find((node) => node.props.accessibilityLabel === '不再显示这类内容')
        ?.props.onPress();
    });

    expect(onDismissed).toHaveBeenCalledTimes(1);
  });
});
