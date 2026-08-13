/**
 * @jest-environment jsdom
 */

/**
 * 问一问 is the second place a citation chip is drawn, and it needs the
 * source grade for the same reason 问答 does — this drawer is reached
 * from a number the patient is already looking at, so its answers are
 * read fastest and with the least context.
 *
 * It is NOT the 问答 chip. It shares `authorityToneFor` and
 * `readAuthorityLabel` and nothing else: the grade is drawn by its own
 * inline `<Text style={[styles.citationChipAuthority, {color: …}]}>`,
 * stacked above the source name rather than prefixed to it, because the
 * pill is capped at 150pt and clamped to one line. So the AuthorityChip
 * tests cover none of this.
 *
 * Rendered through react-native-web against the DOM, like the 问答 test
 * beside it, and split one test per reader for the same reason —
 * SIGHTED off `textContent` and the inline `color`, ASSISTIVE off
 * `accessibleText` plus `reachesAccessibilityTreeFrom`. See
 * p-qna/__tests__/citation-authority.web.test.tsx.
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
import { authorityToneFor } from '../AuthorityChip';
import { accessibleText, reachesAccessibilityTreeFrom } from '../__testutils__/accessible-text';

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

/** The element that PRINTS a string: the deepest node whose own rendered
 *  text is exactly it. Every ancestor also contains it, which is how
 *「the grade is somewhere in the document」proves less than it looks. */
const printing = (container: HTMLElement, text: string): HTMLElement | undefined =>
  Array.from(container.querySelectorAll<HTMLElement>('*')).find(
    (node) => node.children.length === 0 && node.textContent === text,
  );

/** Same colour string the DOM would hold, so a hex in design.ts and the
 *  `rgb(...)` jsdom writes back compare equal. */
const asRendered = (color: string): string => {
  const probe = document.createElement('span');
  probe.style.color = color;
  return probe.style.color;
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

  it('等级是文字，不是颜色 —— 上色的那个节点自己就写着等级', async () => {
    const container = await renderAndAnswer();

    // The drawer paints the grade with `color` only — the pill's `well`
    // background belongs to the whole chip and says nothing about the
    // source. So the whole distinction rides on that one property, and
    // what has to be true is that the node holding it also holds the
    // words.
    for (const grade of ['指南/共识', '病友经验']) {
      const line = printing(container, grade);
      expect(line).toBeDefined();
      expect(line!.style.color).toBe(asRendered(authorityToneFor(grade).color));
    }
    expect(printing(container, '指南/共识')).not.toBe(printing(container, '病友经验'));
  });

  it('等级读屏也读得到', async () => {
    const container = await renderAndAnswer();

    // Not `textContent`: that is blind to `aria-hidden`, which takes the
    // grade out of the accessibility tree and leaves every text node
    // where it was. See __testutils__/accessible-text.ts.
    //
    // Read at the CHIP LINE, not at `document.body`:
    // `accessibleText(container).toContain(grade)` is satisfied by any
    // other node on the page spelling the grade out, and the answer body
    // is the likely one, since knowledge.py hands the model
    //「｜来源等级：指南/共识」in its prompt header.
    //
    // Anchoring is not a strict improvement, so both assertions are
    // here: a read at the line cannot see an ancestor that drops the
    // subtree (`aria-hidden` on the chip `View` leaves the line's own
    // accessible text intact), which the document-wide read did cover.
    // `printing` finds the line by its printed text, so this also pins
    // the grade as a text node — deliberately: the colour test above
    // requires that and fails first on any chip that drops it.
    for (const grade of ['指南/共识', '病友经验']) {
      const line = printing(container, grade);
      expect(line).toBeDefined();
      expect(accessibleText(line!)).toBe(grade);
      expect(reachesAccessibilityTreeFrom(container, line!)).toBe(true);
    }
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
