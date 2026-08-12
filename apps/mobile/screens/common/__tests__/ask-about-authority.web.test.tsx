/**
 * @jest-environment jsdom
 */

/**
 * 问一问 is the second place a citation chip is drawn, and it needs the
 * source grade for the same reason 问答 does.
 *
 * The drawer is reached from a number the patient is already looking at
 * — a report card, a measurement — so its answers are the ones read
 * fastest and with the least context. Its chips are also the tightest:
 * capped at 150pt and clamped to one line, which is why the grade is
 * stacked above the source name here instead of appended to it. A
 * prefix would have pushed the name it qualifies out of the box.
 *
 * Rendered through react-native-web against the DOM, like the 问答 test
 * beside it: this ships as the Expo web export read in WeChat's
 * browser, and the claim under test is that the grade is TEXT a reader
 * (or a screen reader) receives. `authorityToneFor` gives the two
 * grades different colours, and a props-level assertion would happily
 * accept colour as the only carrier.
 */

jest.mock('react-native', () => require('react-native-web'));

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'span' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'span');

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

/**
 * Hand-rolled for the same reason as the 问答 web test:
 * `react-native-reanimated/mock` imports the real module for its enums,
 * which pulls the native bindings into a jsdom run. Only Button's
 * press-scale surface is stubbed — that is all this tree touches.
 */
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
    // eslint's react/display-name fires on the arrow returned from a
    // factory; the mock is a component factory, so name it.
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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async () => null,
  setItem: async () => undefined,
  removeItem: async () => undefined,
}));

jest.mock('../../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  QNA_CHAT_STORAGE_KEY: 'openrd.qna.chatMessages.v1',
  isConsentRequiredError: () => false,
}));

/**
 * The drawer only ever receives citations through the stream's `done`
 * frame, so the test drives the real handler rather than seeding state:
 * capture `onEvent` at subscribe time and hand it the frame the server
 * sends.
 */
type StreamEvent = { type: string; data?: { citations?: unknown[]; answer?: string } };
let emit: ((event: StreamEvent) => void) | null = null;
jest.mock('../../../lib/ai-streaming', () => ({
  streamAiQuestion: (
    _question: string,
    _progressId: string,
    handlers: { onEvent: (event: StreamEvent) => void },
  ) => {
    emit = handlers.onEvent;
    return { close: jest.fn() };
  },
}));

import { act, type ReactNode } from 'react';
import AskAboutDrawer from '../AskAboutDrawer';

const { createRoot } = require('react-dom/client') as {
  createRoot: (container: Element) => { render: (node: ReactNode) => void };
};

/** The finding's own pair: a practice guideline and a forum post, whose
 *  filenames both reduce to a bare title. */
const CITATIONS = [
  {
    chunkId: 'g1',
    source: 'medical_kb',
    sourceFile: 'C.AANA obstetric anaesthesia.pdf',
    chunkIndex: 1,
    snippet: '术前评估应记录呼吸功能。',
    authorityLabel: '指南/共识',
  },
  {
    chunkId: 'c1',
    source: 'medical_kb',
    sourceFile: '11.病友经验/forum.pdf',
    chunkIndex: 2,
    snippet: '我做手术那次麻醉师问得很细。',
    authorityLabel: '病友经验',
  },
];

/**
 * Queries run against `document.body`, not the mount node: the drawer
 * is a react-native `Modal`, which react-native-web portals out of the
 * tree it was rendered into. Reading the mount node instead silently
 * finds nothing and every assertion below would pass for the wrong
 * reason.
 */
const renderAndAnswer = async () => {
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const root = createRoot(mount);
  await act(async () => {
    root.render(<AskAboutDrawer visible onClose={jest.fn()} />);
  });

  // A starter chip is the shortest path into `ask()`.
  const starter = Array.from(document.body.querySelectorAll('*')).find(
    (node) => node.textContent === '这什么意思' && node.children.length === 0,
  ) as HTMLElement | undefined;
  expect(starter).toBeDefined();
  await act(async () => {
    starter!.click();
  });

  expect(emit).toBeTruthy();
  await act(async () => {
    emit!({ type: 'done', data: { citations: CITATIONS, answer: '麻醉前告诉医生你的诊断。' } });
  });
  return document.body;
};

describe('web export：问一问的依据 chip 也要带来源等级', () => {
  beforeEach(() => {
    emit = null;
    document.body.innerHTML = '';
  });

  it('指南和病友经验的等级都出现在 DOM 文本里', async () => {
    const container = await renderAndAnswer();
    const text = container.textContent ?? '';
    expect(text).toContain('AANA obstetric anaesthesia');
    expect(text).toContain('指南/共识');
    expect(text).toContain('病友经验');
  });

  it('等级是文字，不是颜色', async () => {
    const container = await renderAndAnswer();
    container.querySelectorAll('[style]').forEach((node) => node.removeAttribute('style'));
    const stripped = container.textContent ?? '';
    expect(stripped).toContain('指南/共识');
    expect(stripped).toContain('病友经验');
  });

  it('等级不挤掉它要修饰的来源名 —— 两者在同一个 chip 里各占一行', async () => {
    const container = await renderAndAnswer();
    // The chip is one box holding both lines. If the grade had been
    // appended to the clamped title instead, this element would carry
    // only one of the two strings.
    const chip = Array.from(container.querySelectorAll('*')).find((node) => {
      const text = node.textContent ?? '';
      return (
        text.includes('指南/共识') &&
        text.includes('AANA obstetric anaesthesia') &&
        !text.includes('病友经验')
      );
    });
    expect(chip).toBeDefined();
  });
});
