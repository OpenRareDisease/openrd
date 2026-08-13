/**
 * @jest-environment jsdom
 */

/**
 * The citation chip has to say how strong the source is.
 *
 * The API has graded every KB citation since the authority tiers
 * landed, and it shows the model「｜来源等级：指南/共识」in the prompt
 * header. The patient saw none of it: every chip rendered
 * `formatCitationLabel(sourceFile)`, which is the basename only, and
 * the basename is the part of「11.病友经验/forum.pdf」that drops the
 * tier. A forum post and a practice guideline arrived under one answer
 * looking equally authoritative.
 *
 * Rendered through react-native-web against the DOM rather than through
 * react-test-renderer, because this product ships as the Expo web export
 * read in WeChat's browser, and because the assertion is about what
 * reaches a reader: the grade has to be TEXT in the document. A chip
 * that carried the distinction in `backgroundColor` alone would satisfy
 * a props-level assertion and tell a screen-reader user, or anyone with
 * a colour filter on, nothing at all.
 *
 * Two readers, two projections
 * ----------------------------
 * The colour-filtered reader and the screen-reader user are not served
 * by the same assertion, so they get one test each:
 *
 *   - SIGHTED: the node that carries the tone must itself print the
 *     grade. Read off `textContent` and the inline `color`.
 *   - ASSISTIVE: the grade must survive the accessibility tree. Read off
 *     `accessibleText` AT THE CHIP, plus `reachesAccessibilityTreeFrom`
 *     for the ancestors between it and the container — one call sees
 *     what the chip itself drops, the other what an ancestor drops.
 *
 * Neither is read over the whole document: that only proves the string
 * exists somewhere on the page, and this page has a second place it can
 * come from — the answer body, which the model writes from a prompt
 * header carrying「｜来源等级：指南/共识」.
 */

jest.mock('react-native', () => require('react-native-web'));

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'span' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'span');

/**
 * Hand-rolled rather than `react-native-reanimated/mock`: that mock
 * imports the real module for its enums, which pulls the native
 * bindings into a jsdom run. Only the surface this screen's tree
 * touches is stubbed — `Animated.createAnimatedComponent` (press-scale),
 * `Animated.View` (Button, the message list) and the entering animation.
 */
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  // The declarative animation props are builder objects, not DOM
  // values; react-dom throws trying to stringify them onto an element.
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
  // Entering animations are chained builders (`FadeInDown.springify()
  // .damping(…)`), so every property has to answer with the builder
  // again rather than with a fixed set of methods.
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

// Replaced wholesale for the same reason as starters.test.tsx: lib/api
// reaches AsyncStorage through session-storage at import time.
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
import { authorityToneFor } from '../../common/AuthorityChip';
import {
  accessibleText,
  reachesAccessibilityTreeFrom,
} from '../../common/__testutils__/accessible-text';

const { createRoot } = require('react-dom/client') as {
  createRoot: (container: Element) => { render: (node: ReactNode) => void };
};

/**
 * One answer, two sources of very different strength — the pair from
 * the finding: the AANA obstetric-anaesthesia guideline and a post from
 * the 病友经验 folder. Both filenames reduce to a bare title, so the
 * grade is the only thing that can tell them apart.
 */
const STORED_CHAT = [
  {
    id: 'u1',
    role: 'user',
    content: 'FSHD 做手术麻醉有什么风险',
    createdAt: '2026-08-01T00:00:00.000Z',
    status: 'sent',
  },
  {
    id: 'a1',
    role: 'assistant',
    content: '麻醉前要让医生知道你的诊断 [1][2]。',
    createdAt: '2026-08-01T00:00:01.000Z',
    status: 'sent',
    metadata: {
      citations: [
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
        {
          chunkId: 'r1',
          source: 'patient_reports',
          sourceFile: 'uploads/abc123/肌肉MRI报告.pdf',
          chunkIndex: null,
          snippet: '双侧大腿脂肪浸润。',
          // A patient's own report has no ranking — see base.ts.
          authorityLabel: null,
        },
        {
          chunkId: 'w1',
          source: 'medical_kb',
          sourceFile: 'D.ACMG statement.pdf',
          chunkIndex: 7,
          snippet: '基因检测前应做遗传咨询。',
          // Blank-but-truthy. The server normalises this away
          // (context-builder's readAuthorityLabel), so it can only
          // arrive from an older API container or a restored chat —
          // and both are shapes this screen actually receives.
          authorityLabel: '   ',
        },
      ],
    },
  },
];

const renderToDom = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<P_QNA />);
  });
  // The restore reads AsyncStorage in an effect; flush it.
  await act(async () => {
    await Promise.resolve();
  });
  return container;
};

/**
 * The element that PRINTS a grade: the deepest node whose own rendered
 * text is exactly the grade. Anything above it in the tree also contains
 * the string, which is how「the grade is somewhere in the document」ends
 * up proving less than it looks.
 */
const chipPrinting = (container: HTMLElement, grade: string): HTMLElement | undefined =>
  Array.from(container.querySelectorAll<HTMLElement>('*')).find(
    (node) => node.children.length === 0 && node.textContent === grade,
  );

/** Same colour string the DOM would hold, so a hex in design.ts and the
 *  `rgb(...)` jsdom writes back compare equal. */
const asRendered = (color: string): string => {
  const probe = document.createElement('span');
  probe.style.color = color;
  return probe.style.color;
};

const expandCitations = async (container: HTMLElement) => {
  const toggle = Array.from(container.querySelectorAll('[aria-label]')).find((node) =>
    (node.getAttribute('aria-label') ?? '').includes('引用详情'),
  ) as HTMLElement | undefined;
  // Without this the click below throws a bare TypeError and the
  // failure reads as a DOM problem rather than "the citation block
  // never rendered".
  expect(toggle).toBeDefined();
  await act(async () => {
    toggle!.click();
  });
};

describe('web export：引用要带来源等级', () => {
  beforeEach(() => {
    mockStore.clear();
    mockStore.set('openrd.qna.chatMessages.v1', JSON.stringify(STORED_CHAT));
  });

  it('展开引用后，指南和病友经验各自的等级都在 DOM 文本里', async () => {
    const container = await renderToDom();
    await expandCitations(container);

    const text = container.textContent ?? '';
    expect(text).toContain('AANA obstetric anaesthesia');
    expect(text).toContain('指南/共识');
    expect(text).toContain('病友经验');
  });

  it('等级是文字而不是颜色 —— 上色的那个节点自己就写着等级', async () => {
    const container = await renderToDom();
    await expandCitations(container);

    // Not「the grade appears somewhere」— the test above already says
    // that. The claim here is that the node CARRYING THE TONE is the
    // node PRINTING the words, which is what a reader with a colour
    // filter is left with.
    //
    // The mutation this adds coverage for is the tone drifting onto an
    // ancestor — a chip that wraps the grade in a plain inner `Text` and
    // styles the wrapper. The words and the colour land on different
    // nodes then, so the grade stops being readable at a glance beside a
    // long citation title, while every character stays in
    // `container.textContent` and the test above stays green.
    //
    // The chip shapes that DROP the text — the grade moved to an
    // `aria-label`, or the background left to carry it — fail the test
    // above first, on「Expected substring: "指南/共识"」.
    for (const grade of ['指南/共识', '病友经验']) {
      const chip = chipPrinting(container, grade);
      expect(chip).toBeDefined();
      expect(chip!.style.color).toBe(asRendered(authorityToneFor(grade).color));
      expect(chip!.style.backgroundColor).toBe(asRendered(authorityToneFor(grade).backgroundColor));
    }

    // And the tone is redundant rather than the carrier: the two grades
    // are told apart by four different characters whatever the colours
    // do. Pinned here so「both chips print their grade」cannot be
    // satisfied by two chips printing the SAME grade.
    expect(chipPrinting(container, '指南/共识')).not.toBe(chipPrinting(container, '病友经验'));
  });

  it('等级读屏也读得到 —— 不是画给眼睛看完就算', async () => {
    const container = await renderToDom();
    await expandCitations(container);

    // `textContent` cannot answer this: it is blind to `aria-hidden`,
    // which removes the chip from the accessibility tree while leaving
    // every text node in place. See __testutils__/accessible-text.ts.
    //
    // Read at the CHIP, not at the document. A `.toContain(grade)` over
    // `accessibleText(container)` is satisfied by anything on the page
    // spelling the grade out, and the answer body is primed to do so:
    // knowledge.py puts「｜来源等级：指南/共识」in the model's prompt
    // header, so an answer reading「第一条来自指南/共识，第二条是病友
    // 经验。」is a shape this screen really renders. Measured on that
    // pair — chips `aria-hidden`, tiers named in the answer prose — the
    // document-wide assertion passes with no grade reachable by any
    // screen reader; anchored here it fails on the first chip.
    //
    // Anchoring is not a strict improvement over the document-wide read,
    // so both assertions are here. Reading AT the chip cannot see an
    // ancestor that drops the whole subtree — `aria-hidden` on the
    // per-citation `View` leaves `accessibleText(chip)` equal to the
    // grade — hence the reachability check, which the document-wide read
    // did cover. And `chipPrinting` finds the chip by its printed text,
    // so a grade moved to an `aria-label` on a childless node is red
    // here for the wrong reason; that shape is forbidden by the SIGHTED
    // test above, which fails on it first, so the grade is pinned as a
    // TEXT NODE on purpose.
    for (const grade of ['指南/共识', '病友经验']) {
      const chip = chipPrinting(container, grade);
      expect(chip).toBeDefined();
      expect(accessibleText(chip!)).toBe(grade);
      expect(reachesAccessibilityTreeFrom(container, chip!)).toBe(true);
    }
  });

  it('等级不会被折成两个半药丸', async () => {
    const container = await renderToDom();
    await expandCitations(container);

    // The chip is a nested `Text`, i.e. an inline `<span>` inheriting
    // the title line's `white-space: pre-wrap`, and CSS may break
    // between any two Han characters. An inline box that breaks paints
    // its background and radius per fragment
    // (`box-decoration-break: slice`) and puts the horizontal padding
    // only on the outer edges, so「指南/共识」comes back as two
    // half-pills on two lines. Measured in headless Chrome over the 211
    // source names in the live index at five phone widths: 107 of 1,055
    // renders split without this, 0 with it. jsdom does no layout, so
    // what is asserted here is the property that forbids the break.
    for (const grade of ['指南/共识', '病友经验']) {
      const chip = chipPrinting(container, grade)!;
      expect(getComputedStyle(chip).whiteSpace).toBe('nowrap');
    }
  });

  it('没有等级的来源（你自己的报告）不长出一个空 chip', async () => {
    const container = await renderToDom();
    await expandCitations(container);

    const text = container.textContent ?? '';
    expect(text).toContain('肌肉MRI报告');
    // Exactly two graded citations were seeded; a third, blank chip
    // would show up as a stray separator on the report's line.
    expect(text.match(/指南\/共识/g) ?? []).toHaveLength(1);
    expect(text.match(/病友经验/g) ?? []).toHaveLength(1);
  });

  it('一个只有空格的等级既不长 chip，也不留下多余的空格', async () => {
    const container = await renderToDom();
    await expandCitations(container);

    const text = container.textContent ?? '';
    // The separator in front of the chip has to be keyed on the same
    // predicate the chip is. Keyed on raw truthiness,「   」renders no
    // chip but still emits its space, and the line reads
    //「4. ACMG statement  · 段 7」with a hole in it.
    expect(text).toContain('4. ACMG statement · 段 7');
    expect(text).not.toMatch(/ACMG statement {2}/);
  });
});
