/**
 * @jest-environment jsdom
 */

/**
 * 辅具流 answered by someone who cannot see the teal fill.
 *
 * This app ships as a web export opened in phone browsers — very often
 * WeChat's — so `accessibilityState` is not what a screen reader ends
 * up reading: react-native-web 0.20 does not forward it at all (it is
 * absent from both `forwardedProps` and `createDOMProps`), and only
 * `aria-checked` reaches the DOM. A test that asserts the React prop
 * therefore passes while every choice on the shipped build announces
 * the same, which is why this file renders the real component through
 * react-native-web and reads the attributes off the DOM.
 *
 * What it must catch: a patient answering 「你走路时脚尖会拖地吗」 and
 * being unable to hear back which answer she gave, on the flow whose
 * output is her AFO plan.
 */

jest.mock('react-native', () => require('react-native-web'));

import { act, type ReactNode } from 'react';
import OrthosisFlow from '../OrthosisFlow';

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
    root.render(<OrthosisFlow />);
  });
  return container;
};

const radios = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="radio"]')) as HTMLElement[];

describe('web export：选项要把选中状态说出来', () => {
  it('每个选项在 DOM 上都带 aria-checked，没答的时候是 false', async () => {
    const container = await renderToDom();
    const options = radios(container);
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(option.getAttribute('aria-checked')).toBe('false');
    }
  });

  it('点过之后，只有被点的那个报 true，同组其他的报 false', async () => {
    const container = await renderToDom();
    const first = radios(container)[0]!;
    const label = first.getAttribute('aria-label');

    await act(async () => {
      first.click();
    });

    const chosen = container.querySelector(`[aria-label="${label}"][role="radio"]`);
    expect(chosen?.getAttribute('aria-checked')).toBe('true');
    expect(
      radios(container).filter((option) => option.getAttribute('aria-checked') === 'true'),
    ).toHaveLength(1);
  });

  it('每一题的选项被 radiogroup 圈在一起', async () => {
    const container = await renderToDom();
    const groups = Array.from(container.querySelectorAll('[role="radiogroup"]'));
    expect(groups.length).toBeGreaterThan(0);
    // A radio with no owning group is announced without「第几项、共几项」,
    // which on a four-branch guideline ladder is the whole orientation.
    for (const option of radios(container)) {
      expect(option.closest('[role="radiogroup"]')).not.toBeNull();
    }
    for (const group of groups) {
      expect(group.getAttribute('aria-label')).toBeTruthy();
    }
  });
});
