import TestRenderer, { act } from 'react-test-renderer';
import P_QNA from '../index';

/**
 * 问答 used to open on a paragraph and an empty input.
 *
 * Typing is the most expensive action this app can ask for — FSHD
 * takes the face, shoulders and upper arms first — and the people who
 * most need the corpus are the ones who do not yet have the words:
 * years of being told it was a shoulder problem, nothing uploaded,
 * only symptoms. AskAboutDrawer already renders tappable openers when
 * idle「so the patient never faces an empty input」; this pins the same
 * thing on the tab.
 */

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

const mockStore = new Map<string, string>();
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

const mockStreamAiQuestion = jest.fn<{ close: jest.Mock }, unknown[]>(() => ({
  close: jest.fn(),
}));
jest.mock('../../../lib/ai-streaming', () => ({
  streamAiQuestion: (...args: unknown[]) => mockStreamAiQuestion(...args),
}));

let mockToken: string | null = 'token-123';
jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: mockToken }),
}));
jest.mock('../../../contexts/ProfileContext', () => ({
  useProfileContext: () => ({ profile: null }),
}));

const mockNotify = jest.fn();
jest.mock('../../common/feedback/AppDialog', () => ({
  useAppDialog: () => ({ confirm: jest.fn(), notify: mockNotify }),
}));

// Replaced wholesale: lib/api reaches AsyncStorage through
// session-storage and resolves the API base URL at import time.
jest.mock('../../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  QNA_CHAT_STORAGE_KEY: 'openrd.qna.chatMessages.v1',
  isConsentRequiredError: () => false,
  updateMyConsent: jest.fn(),
}));

jest.mock('../../../lib/consent-epoch', () => ({
  getConsentEpoch: () => Promise.resolve(1),
  bumpConsentEpoch: () => Promise.resolve(2),
}));

const renderScreen = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<P_QNA />);
  });
  return tree;
};

/** Buttons carry their label as `accessibilityLabel` when one is not
 *  set explicitly; find by the visible label text instead so the test
 *  reads like the screen. */
const pressableWithLabel = (tree: TestRenderer.ReactTestRenderer, label: string) =>
  tree.root.findAll(
    (node) =>
      typeof node.props?.onPress === 'function' &&
      (node.props?.accessibilityLabel === label || node.props?.label === label),
  );

const allText = (tree: TestRenderer.ReactTestRenderer): string =>
  tree.root
    .findAll((node) => String(node.type) === 'Text')
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === 'string')
    .join(' | ');

describe('p-qna opens with starter questions', () => {
  beforeEach(() => {
    mockStore.clear();
    mockPush.mockClear();
    mockNotify.mockClear();
    mockStreamAiQuestion.mockClear();
    mockToken = 'token-123';
  });

  it('offers openers that need no history and no upload', async () => {
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain('FSHD 是一种什么病');
    expect(text).toContain('确诊需要做哪些检查');
    expect(text).toContain('会遗传给孩子吗');
    // None of them may presuppose something on file — that would be an
    // empty input with extra steps for the person this list is for.
    expect(text).not.toContain('我的报告');
    expect(text).not.toContain('上传');
  });

  it('sends a starter straight out rather than filling the composer', async () => {
    const tree = await renderScreen();
    const [starter] = pressableWithLabel(tree, 'FSHD 是一种什么病');
    expect(starter).toBeDefined();

    await act(async () => {
      starter.props.onPress();
    });

    expect(mockStreamAiQuestion).toHaveBeenCalledTimes(1);
    expect(mockStreamAiQuestion.mock.calls[0][0]).toBe('FSHD 是一种什么病');
  });

  it('answers 会遗传给孩子吗 from the cited page instead of the model', async () => {
    // /p-genetics_family is finished and sourced per section. Reading
    // it beats generating an answer to the question people ask before
    // they have told anyone else.
    const tree = await renderScreen();
    const [genetics] = pressableWithLabel(tree, '会遗传给孩子吗');
    expect(genetics).toBeDefined();

    await act(async () => {
      genetics.props.onPress();
    });

    expect(mockPush).toHaveBeenCalledWith('/p-genetics_family');
    expect(mockStreamAiQuestion).not.toHaveBeenCalled();
  });

  it('hides the starters once the patient has asked something', async () => {
    const tree = await renderScreen();
    const [starter] = pressableWithLabel(tree, 'FSHD 是一种什么病');
    await act(async () => {
      starter.props.onPress();
    });

    expect(allText(tree)).not.toContain('不知道从哪问起');
    expect(pressableWithLabel(tree, '确诊需要做哪些检查')).toHaveLength(0);
  });

  it('does not show starters over a restored conversation', async () => {
    // A patient coming back to a thread should see the thread, not a
    // fresh-start prompt sitting on top of it.
    mockStore.set(
      'openrd.qna.chatMessages.v1',
      JSON.stringify([
        {
          id: 'u1',
          role: 'user',
          content: '我该怎么锻炼',
          createdAt: new Date().toISOString(),
          status: 'sent',
        },
      ]),
    );
    const tree = await renderScreen();
    expect(allText(tree)).not.toContain('不知道从哪问起');
  });
});
