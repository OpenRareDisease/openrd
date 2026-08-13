/**
 * @jest-environment jsdom
 */

/**
 * 我想问的问题 ticked by someone who cannot see the ✓.
 *
 * The sibling test file asserts `accessibilityState` on the React tree,
 * which is the right assertion on native and no assertion at all on the
 * channel that ships: react-native-web 0.20 does not forward
 * `accessibilityState` (it appears in neither `forwardedProps` nor
 * `createDOMProps`), so only `aria-checked` reaches the DOM — and ARIA
 * defaults an absent `aria-checked` on `role="checkbox"` to false. This
 * file therefore renders the screen through react-native-web and reads
 * the attributes off the DOM.
 *
 * The ✓ glyph is no fallback: `accessibilityLabel` becomes `aria-label`
 * on the row, and an aria-label overrides subtree text in accessible
 * name computation, so the glyph is never announced.
 */

jest.mock('react-native', () => require('react-native-web'));

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'span' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'span');

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', null, children),
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

/** Doubled for the same reason as in index.test.tsx: lib/api reaches
 *  AsyncStorage at module load and jest-expo has no native module for
 *  it. Nothing here touches the pack. */
jest.mock('../../../lib/referral-pack-api', () => ({
  fetchMyReferralPack: jest.fn(),
  isGeneticallyConfirmed: () => false,
}));

import { act, type ReactNode } from 'react';
import ReferralScreen from '../index';
import { REFERRAL_QUESTIONS } from '../question-sheet';

/** `require` with the shape written out, because `@types/react-dom` is
 *  not a dependency here — the app never imports react-dom itself, only
 *  the web export's bundler does, and a test is no reason to add one. */
const { createRoot } = require('react-dom/client') as {
  createRoot: (container: Element) => { render: (node: ReactNode) => void };
};

const renderToDom = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<ReferralScreen />);
  });
  return container;
};

const rows = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="checkbox"]')) as HTMLElement[];

describe('web export：勾选状态要真的进到 DOM', () => {
  it('一条都没勾的时候，每一行都明确报 aria-checked="false"', async () => {
    const container = await renderToDom();
    const questionRows = rows(container);
    expect(questionRows).toHaveLength(REFERRAL_QUESTIONS.length);
    for (const row of questionRows) {
      expect(row.getAttribute('aria-checked')).toBe('false');
    }
  });

  it('勾过的那一行报 true，其余仍然报 false', async () => {
    const container = await renderToDom();
    const target = REFERRAL_QUESTIONS[0]!.prompt;
    const row = container.querySelector(`[role="checkbox"][aria-label="${target}"]`) as HTMLElement;

    await act(async () => {
      row.click();
    });

    expect(
      container
        .querySelector(`[role="checkbox"][aria-label="${target}"]`)
        ?.getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      rows(container).filter((each) => each.getAttribute('aria-checked') === 'true'),
    ).toHaveLength(1);
  });
});
