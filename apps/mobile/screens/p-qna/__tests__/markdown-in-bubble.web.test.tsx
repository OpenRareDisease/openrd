/**
 * @jest-environment jsdom
 */

/**
 * THE CHAT BUBBLE HAS TO RENDER EVERY MARKDOWN CONSTRUCT THE MODEL WAS
 * PROMISED, and the promise is a specific one.
 *
 * The orchestrator's DEFAULT_SYSTEM_PROMPT (apps/api/src/modules/
 * ai-agents/orchestrator/run.ts, 【排版】) tells the model, naming the
 * parser by path:
 *
 *   客户端会把 Markdown 渲染成真正的排版（apps/mobile/screens/common/
 *   answer-format.ts），所以可以正常使用，不用刻意避开：标题、列表（有序
 *   无序都行）、粗体、斜体、引用、行内代码、链接，都会正确显示。表格也支持，
 *   但手机只有一列宽，会被转成「指标：数值」的逐行形式——所以表格只用两三列，
 *   第一列放指标名，第二列放数值。
 *
 * That paragraph is an instruction the model follows, so every clause of
 * it is a claim this screen owes the patient. A construct the prompt
 * invites and the renderer drops does not fail loudly — the syntax just
 * lands on screen, on the sentence carrying the patient's own numbers.
 * 「**D4Z4 重复数**」 with the asterisks showing was seen in a live
 * bubble, and the run that produced it wrote the label into the FIRST
 * COLUMN OF A TABLE — the one placement the same paragraph asks for.
 *
 * Read off the DOM rather than off `parseAnswer`'s block list, because
 * the parser was never the half that was broken: it returned a clean
 * `pair` and the renderer printed the label as a raw string. A
 * parser-level test is green for the whole of that defect. What is
 * asserted here is what a reader is left with — the characters in the
 * bubble, and the weight on the node carrying them.
 *
 * Through the QnA screen and not through `<AnswerText>` directly: the
 * screen wraps every text run in the citation segmenter, and「formatted」
 * and「citation-linked」have to hold at the same time on the surface that
 * needs both.
 */

jest.mock('react-native', () => require('react-native-web'));

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'span' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'span');

/** See citation-authority.web.test.tsx — same reasoning, same shape. */
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const strip = (props: Record<string, unknown>) => {
    const rest = { ...props };
    delete rest.entering;
    delete rest.exiting;
    delete rest.layout;
    return rest;
  };
  const passthrough = (Component: unknown) => {
    const Wrapped = ({ children, ...rest }: { children?: unknown }) =>
      React.createElement(Component as never, strip(rest), children);
    Wrapped.displayName = 'ReanimatedMock';
    return Wrapped;
  };
  const View = passthrough(require('react-native-web').View);
  const entering: unknown = new Proxy({}, { get: () => () => entering });
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: passthrough },
    createAnimatedComponent: passthrough,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useDerivedValue: (fn: () => unknown) => ({ value: fn() }),
    useAnimatedStyle: (fn: () => unknown) => fn(),
    withSpring: (value: unknown) => value,
    withTiming: (value: unknown) => value,
    FadeIn: entering,
    FadeOut: entering,
    FadeInDown: entering,
  };
});

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

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

jest.mock('../../../lib/ai-streaming', () => ({
  streamAiQuestion: jest.fn(() => ({ close: jest.fn() })),
}));

jest.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'token-123' }),
}));
jest.mock('../../../contexts/ProfileContext', () => ({
  useProfileContext: () => ({ profile: null }),
}));
jest.mock('../../common/feedback/AppDialog', () => ({
  useAppDialog: () => ({ confirm: jest.fn(), notify: jest.fn() }),
}));

jest.mock('../../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  QNA_CHAT_STORAGE_KEY: 'openrd.qna.chatMessages.v1',
  isConsentRequiredError: () => false,
  updateMyConsent: jest.fn(),
}));

jest.mock('../../../lib/consent-epoch', () => ({
  getConsentEpoch: () => Promise.resolve(0),
  bumpConsentEpoch: () => Promise.resolve(1),
}));

import { act, type ReactNode } from 'react';
import P_QNA from '../index';

const { createRoot } = require('react-dom/client') as {
  createRoot: (container: Element) => { render: (node: ReactNode) => void };
};

/**
 * One answer exercising every clause of 【排版】 at once, written the way
 * the model writes when it is following that paragraph: a heading, both
 * list kinds, bold on the patient's own numbers, italic, a blockquote,
 * inline code around an OCR field key, a link, and a two- and a
 * three-column table whose first column names the 指标.
 *
 * The bold inside the table's first column is not decoration added to
 * make a point: 【排版】 asks for bold AND asks for the 指标 to be in
 * column one, and a model told both writes 「| **D4Z4 重复数** | 3 次 |」.
 * That is the run that put asterisks in front of a patient.
 */
const ANSWER = [
  '## 你的基因报告怎么读',
  '',
  '你的 **D4Z4 重复数** 是 3 次，属于 *致病范围*。',
  '',
  '1. 先看重复数',
  '2. 再看单倍型',
  '',
  '- 甲基化值：**95%**',
  '- 单倍型：4qA',
  '',
  '> 这些数字要跟你的主治医生一起看。',
  '',
  '报告里的 `d4z4_repeat_pathogenic` 就是这个数。',
  '',
  '更多说明见 [罕见病诊疗指南](https://example.org/fshd)。',
  '',
  '| 指标 | 你的数值 |',
  '| --- | --- |',
  '| **D4Z4 重复数** | 3 次 |',
  '',
  '| 指标 | 你的数值 | 参考范围 |',
  '| --- | --- | --- |',
  '| 甲基化值 | 95% | >30% |',
].join('\n');

const STORED_CHAT = [
  {
    id: 'u1',
    role: 'user',
    content: '帮我看看基因报告',
    createdAt: '2026-08-01T00:00:00.000Z',
    status: 'sent',
  },
  {
    id: 'a1',
    role: 'assistant',
    content: ANSWER,
    createdAt: '2026-08-01T00:00:01.000Z',
    status: 'sent',
    metadata: { citations: [] },
  },
];

const renderToDom = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<P_QNA />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return container;
};

/** The deepest node whose own rendered text is exactly `text` — the one
 *  that CARRIES the run, rather than any ancestor containing it. */
const nodePrinting = (container: HTMLElement, text: string): HTMLElement | undefined =>
  Array.from(container.querySelectorAll<HTMLElement>('*')).find(
    (node) => node.children.length === 0 && node.textContent === text,
  );

/** Everything the assistant bubble prints. Anchored at the bubble rather
 *  than at the document: the composer, the starter buttons and the
 *  disclaimer all carry text this file has opinions about. */
const answerText = (container: HTMLElement): string => {
  const author = Array.from(container.querySelectorAll<HTMLElement>('*')).find(
    (node) => node.children.length === 0 && node.textContent === 'OpenRD 助手',
  );
  expect(author).toBeDefined();
  const bubble = author!.parentElement;
  expect(bubble).not.toBeNull();
  return bubble!.textContent ?? '';
};

describe('web export：聊天气泡要把 Markdown 渲染成排版', () => {
  beforeEach(() => {
    mockStore.clear();
    mockStore.set('openrd.qna.chatMessages.v1', JSON.stringify(STORED_CHAT));
  });

  it('系统提示答应的每种写法，读者看到的都是排版而不是符号', async () => {
    const container = await renderToDom();
    const text = answerText(container);

    // The syntax characters. Each one is a separate claim in 【排版】,
    // and each one has landed on a patient's screen at least once.
    expect(text).not.toContain('**');
    expect(text).not.toContain('##');
    expect(text).not.toContain('|');
    expect(text).not.toContain('`');
    expect(text).not.toMatch(/\](\(|\[)/);

    // And the content survived the stripping — a renderer that dropped
    // the whole table would pass every assertion above.
    expect(text).toContain('你的基因报告怎么读');
    expect(text).toContain('D4Z4 重复数');
    expect(text).toContain('致病范围');
    expect(text).toContain('先看重复数');
    expect(text).toContain('甲基化值');
    expect(text).toContain('这些数字要跟你的主治医生一起看。');
    expect(text).toContain('d4z4_repeat_pathogenic');
    expect(text).toContain('罕见病诊疗指南');
    expect(text).toContain('3 次');
    // The third column becomes the parenthetical 「指标：数值（表头 值）」.
    expect(text).toContain('95%（参考范围 >30%）');
  });

  it('粗体是真的加粗 —— 星号拿掉了，重量得留下', async () => {
    const container = await renderToDom();

    // The prose run. Stripping the asterisks and rendering the text at
    // body weight satisfies the test above and loses exactly what the
    // model used the markers to say.
    // `getComputedStyle` rather than `.style`: react-native-web resolves
    // a registered `StyleSheet.create` entry to an atomic CLASS and
    // injects the rule into the document, so the inline attribute is
    // empty for every style this component declares statically. Reading
    // `.style.fontWeight` here answers "" whether the weight is applied
    // or not — a green-either-way assertion on the one property the
    // test exists to pin.
    const bold = nodePrinting(container, 'D4Z4 重复数');
    expect(bold).toBeDefined();
    expect(getComputedStyle(bold!).fontWeight).toBe('700');
  });

  it('表格第一列的粗体标签，读者看到的是标签而不是星号', async () => {
    const container = await renderToDom();
    const text = answerText(container);

    // 【排版】 asks for the 指标 in column one and asks for bold, so a
    // bold 指标 is the shape the prompt produces. The label was printed
    // as a raw string, which put 「**D4Z4 重复数**」 in the bubble while
    // the same characters one paragraph above rendered correctly.
    expect(text).toContain('D4Z4 重复数');
    expect(text).not.toContain('*D4Z4');
    expect(text).not.toContain('数**');
  });
});
