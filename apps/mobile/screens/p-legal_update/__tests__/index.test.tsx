import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { StyleSheet } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../../lib/a11y';

/**
 * 隐私政策更新 — the screen that keeps §9's promise.
 *
 * THE FOUR PROPERTIES PINNED HERE, in the order they matter to the
 * person reading the screen:
 *
 * 1. It says WHAT CHANGED, in the sentence a patient can act on —
 *    「管理员可以查阅你的档案」 — not just a version number.
 * 2. Accepting writes the ledger through the one writer
 *    (`recordLegalAcceptance`), at the version this build displayed.
 * 3. A write that fails does NOT walk the patient onward. An
 *    acceptance that was not recorded is not an acceptance.
 * 4. Declining is not a lockout: it defers, it returns the patient to
 *    their own records, and the screen names the export and the
 *    deletion the privacy policy already promises.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: () => Promise.resolve(null),
  setItem: () => Promise.resolve(),
  removeItem: () => Promise.resolve(),
  multiRemove: () => Promise.resolve(),
}));

jest.mock('expo-secure-store', () => ({
  getItemAsync: () => Promise.resolve(null),
  setItemAsync: () => Promise.resolve(),
  deleteItemAsync: () => Promise.resolve(),
  isAvailableAsync: () => Promise.resolve(false),
}));

const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      ReactLocal.createElement('SafeAreaView', null, children),
  };
});

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const mockRecord = jest.fn();

jest.mock('../../../lib/api', () => {
  const actual = jest.requireActual('../../../lib/api');
  return {
    ...actual,
    recordLegalAcceptance: (...args: unknown[]) => mockRecord(...args),
  };
});

const mockDefer = jest.fn();
const mockRefresh = jest.fn();
let mockStatus: 'loading' | 'ready' | 'pending' | 'error' = 'pending';
let mockAsks: unknown[] = [];

jest.mock('../../../contexts/LegalConsentContext', () => ({
  useLegalConsentContext: () => ({
    status: mockStatus,
    asks: mockAsks,
    deferred: false,
    defer: mockDefer,
    refresh: mockRefresh,
  }),
}));

import { ApiError } from '../../../lib/api';
import { LEGAL_DOCUMENTS } from '../../../lib/legal-content';
import { buildConsentAsks } from '../../../lib/legal-updates';
import LegalUpdateScreen from '../index';

const textContent = (node: ReactTestInstance | string | number | null): string => {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const children = Array.isArray(node.children) ? node.children : [node.children];
  return children.map((child) => textContent(child as ReactTestInstance)).join('');
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const render = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<LegalUpdateScreen />);
    await flush();
  });
  return tree;
};

/** Press the Button whose visible label matches. Buttons here are
 *  screens/common/Button, i.e. a Pressable carrying accessibilityRole
 *  'button' and the label as a child Text. */
const press = async (tree: TestRenderer.ReactTestRenderer, label: string) => {
  const target = tree.root
    .findAll((node) => typeof node.type !== 'string' && node.props?.label === label)
    .find((node) => typeof node.props?.onPress === 'function');
  if (!target) throw new Error(`no button labelled ${label}`);
  await act(async () => {
    target.props.onPress();
    await flush();
  });
};

/** The real shape, built from the real notes — the screen is only
 *  honest if what it renders came out of lib/legal-updates.ts. */
const privacyAsk = () =>
  buildConsentAsks({
    acceptances: [
      { document: LEGAL_DOCUMENTS.privacyPolicy, version: '2026-08-02', acceptedAt: '2026-08-02' },
    ],
    outstanding: [LEGAL_DOCUMENTS.privacyPolicy],
  });

const guardianAsk = () =>
  buildConsentAsks({
    acceptances: [
      {
        document: LEGAL_DOCUMENTS.guardianConsent,
        version: '2026-08-02',
        acceptedAt: '2026-08-02',
      },
    ],
    outstanding: [LEGAL_DOCUMENTS.guardianConsent],
  });

beforeEach(() => {
  mockReplace.mockReset();
  mockRecord.mockReset().mockResolvedValue({});
  mockDefer.mockReset();
  mockRefresh.mockReset().mockResolvedValue(undefined);
  mockStatus = 'pending';
  mockAsks = privacyAsk();
});

describe('它告诉患者改的是什么，而不只是版本号变了', () => {
  it('names the back office and the two versions', async () => {
    const screen = textContent((await render()).root);
    expect(screen).toContain('管理员');
    expect(screen).toContain('查阅你的档案');
    expect(screen).toContain('你上次同意的是 2026-08-02 版，现在是 2026-08-13 版。');
    expect(screen).toContain('管理员代填');
    expect(screen).toContain('服务端会拒绝代填');
  });

  it('keeps the full text one press away rather than on the page by default', async () => {
    const tree = await render();
    // §10's own heading, which only exists in the full document.
    expect(textContent(tree.root)).not.toContain('10. 我们自己的人什么时候会看到你的档案');
    await press(tree, '展开《隐私政策》全文');
    expect(textContent(tree.root)).toContain('10. 我们自己的人什么时候会看到你的档案');
  });

  it('says so plainly when there is nothing to diff against', async () => {
    mockAsks = buildConsentAsks({
      acceptances: [],
      outstanding: [LEGAL_DOCUMENTS.privacyPolicy],
    });
    const screen = textContent((await render()).root);
    expect(screen).toContain('没有你同意这份文件的记录');
    expect(screen).not.toContain('你上次同意的是');
    // 「更新了」 would be false for an account that never accepted it:
    // nothing updated, a record is missing.
    expect(screen).not.toContain('更新了，想先跟你说一声');
    expect(screen).toContain('还差你一次确认');
  });

  it('admits it when a revision has no summary rather than showing an empty card', async () => {
    // The real shape in the dev database: the one acceptance row on
    // record is `sensitive_data_consent` at version 'v1', from before
    // versions were dates. Measured with
    //   SELECT document, version, count(*) FROM legal_document_acceptances GROUP BY 1,2;
    // → sensitive_data_consent | v1 | 1
    mockAsks = buildConsentAsks({
      acceptances: [
        { document: LEGAL_DOCUMENTS.sensitiveData, version: 'v1', acceptedAt: '2026-08-07' },
      ],
      outstanding: [LEGAL_DOCUMENTS.sensitiveData],
    });
    const screen = textContent((await render()).root);
    expect(screen).toContain('你上次同意的是 v1 版，现在是 2026-08-02 版。');
    expect(screen).toContain('没有写下摘要');
    expect(screen).not.toContain('这一版改了什么');
  });
});

describe('同意走的是原来那条账本，不是一个新的开关', () => {
  it('records the version this build displayed, then re-reads the ledger', async () => {
    const tree = await render();
    await press(tree, '我读完了，同意这一版');
    expect(mockRecord).toHaveBeenCalledWith(LEGAL_DOCUMENTS.privacyPolicy, '2026-08-13');
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/p-home');
  });

  it('does not walk the patient onward when the write failed', async () => {
    const failure = new ApiError('保存失败');
    failure.status = 500;
    mockRecord.mockRejectedValue(failure);
    const tree = await render();
    await press(tree, '我读完了，同意这一版');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(textContent(tree.root)).toContain('保存失败');
  });

  it('asks the second document before leaving when two were revised', async () => {
    mockAsks = buildConsentAsks({
      acceptances: [
        {
          document: LEGAL_DOCUMENTS.privacyPolicy,
          version: '2026-08-02',
          acceptedAt: '2026-08-02',
        },
        {
          document: LEGAL_DOCUMENTS.guardianConsent,
          version: '2026-08-02',
          acceptedAt: '2026-08-02',
        },
      ],
      outstanding: [LEGAL_DOCUMENTS.privacyPolicy, LEGAL_DOCUMENTS.guardianConsent],
    });
    const tree = await render();
    expect(textContent(tree.root)).toContain('这次有 2 份文件要确认，这是第 1 份');
    await press(tree, '我读完了，同意这一版');
    expect(mockReplace).not.toHaveBeenCalled();
    const screen = textContent(tree.root);
    expect(screen).toContain('儿童个人信息处理规则');
    expect(screen).toContain('这是第 2 份');
  });

  it('asks a guardian as a guardian', async () => {
    mockAsks = guardianAsk();
    const tree = await render();
    const screen = textContent(tree.root);
    expect(screen).toContain('我是监护人，代为同意这一版');
    // The opening sentence has to name whose record this is: a guardian
    // is not the patient, and 「跟你的病历」 tells them the wrong thing
    // about the wrong person.
    expect(screen).toContain('跟这位患儿的档案直接有关');
    expect(screen).not.toContain('跟你的病历直接有关');
    await press(tree, '我是监护人，代为同意这一版');
    expect(mockRecord).toHaveBeenCalledWith(LEGAL_DOCUMENTS.guardianConsent, '2026-08-13');
  });
});

describe('不同意不会把人锁在外面', () => {
  it('defers and returns the patient to their own records', async () => {
    const tree = await render();
    await press(tree, '暂不同意');
    // Deferral BEFORE the navigation, or the gate replaces the
    // destination with this screen again.
    expect(mockDefer).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/p-home');
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it('names the export and the deletion the policy promises, and can reach them', async () => {
    const tree = await render();
    const screen = textContent(tree.root);
    expect(screen).toContain('导出我的数据');
    expect(screen).toContain('注销账号');
    expect(screen).toContain('7 天冷静期');
    await press(tree, '去「我的」，导出或注销');
    expect(mockDefer).toHaveBeenCalled();
    // 我的 (app/(tabs)/p-settings.tsx) is where both controls live.
    expect(mockReplace).toHaveBeenCalledWith('/p-settings');
  });

  it('does not claim that refusing stops the back office reading the record', async () => {
    // Nothing in the API keys admin access off this ledger, so a
    // sentence promising that would be a promise the code does not
    // keep. What the screen may say is what is true.
    const screen = textContent((await render()).root);
    expect(screen).not.toContain('不同意后管理员');
    expect(screen).toContain('不同意不会锁住你的账号');
  });
});

describe('拒绝的那个控件不是一条小灰字', () => {
  const drawnBox = (tree: TestRenderer.ReactTestRenderer, label: string) => {
    const pressable = tree.root
      .findAll(
        (node) =>
          node.props?.accessibilityLabel === label && typeof node.props?.onPressIn === 'function',
        { deep: false },
      )
      .at(0);
    expect(pressable).toBeDefined();
    return StyleSheet.flatten(pressable?.props.style as never) as {
      minHeight?: number;
      alignSelf?: string;
    };
  };

  it('draws 暂不同意 the same width as 同意, not shrunk to its label', async () => {
    // 暂不同意 is the `plain` variant, whose base style is
    // `alignSelf: 'flex-start'` — i.e. a box that shrinks to the words
    // unless the screen stretches it. `stretch` is what makes the
    // refusal the same size as the acceptance, which is the whole
    // claim in this screen's comment, and on the web export the drawn
    // box IS the hit box (Button.tsx: hitSlop is not read there).
    const tree = await render();
    const decline = drawnBox(tree, '暂不同意');
    const accept = drawnBox(tree, '我读完了，同意这一版');
    expect(decline.alignSelf).toBe('stretch');
    expect(decline.alignSelf).toBe(accept.alignSelf);
    expect(decline.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(accept.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });
});

describe('直接打开这个地址时不装样子', () => {
  it('says it is still reading rather than 「没有更新」', async () => {
    mockStatus = 'loading';
    mockAsks = [];
    expect(textContent((await render()).root)).toContain('正在读取你的授权记录');
  });

  it('says the read failed rather than 「没有需要重新确认的条款」', async () => {
    // Reachable: 隐私设置 offers a way in off its own successful read,
    // and this context's probe may have failed at app open. Saying
    // 「没有」 there would answer a question we could not ask.
    mockStatus = 'error';
    mockAsks = [];
    const tree = await render();
    const screen = textContent(tree.root);
    expect(screen).toContain('现在读不到你的授权记录');
    expect(screen).not.toContain('没有需要重新确认的条款');
    await press(tree, '重试');
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('tells a patient with nothing outstanding exactly that', async () => {
    mockStatus = 'ready';
    mockAsks = [];
    const screen = textContent((await render()).root);
    expect(screen).toContain('没有需要重新确认的条款');
  });
});
