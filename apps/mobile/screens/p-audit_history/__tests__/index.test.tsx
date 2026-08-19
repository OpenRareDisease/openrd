/**
 * Regression tests for the audit history screen's lazy-load effect.
 *
 * The original review of PR #41 caught a guard bug: when the user
 * opens the consent tab and the first fetch fails, the effect would
 * re-fire on every state-update cycle (because `consentLoaded`
 * stayed false on failure paths), turning a single bad request into
 * an unbounded retry storm. The fix added `!consentError` to the
 * guard so manual retry stays the only way to re-trigger a fetch
 * after a failure. This file pins both the guard logic and a few
 * adjacent behaviours so they don't silently regress.
 */

import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';

// Mock the API module BEFORE importing the screen so the module-load
// time `instanceof ApiError` references resolve against the mocked
// class, not the real one.
jest.mock('../../../lib/api', () => {
  class ApiError extends Error {
    status?: number;
    data?: unknown;
  }
  return {
    __esModule: true,
    ApiError,
    getMyAuditHistory: jest.fn(),
    getMyConsentHistory: jest.fn(),
  };
});

jest.mock('@expo/vector-icons', () => ({
  FontAwesome6: 'FontAwesome6',
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('SafeAreaView', null, children),
  };
});

jest.mock('../../common/ScreenBackButton', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: () => React.createElement('ScreenBackButton'),
  };
});

// Imported after the mocks so the screen wires up against them.

import AuditHistoryScreen from '../index';

import { ApiError, getMyAuditHistory, getMyConsentHistory } from '../../../lib/api';

const asMock = <T extends (...args: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock;

const flushMicrotasks = async () => {
  // Two microtask boundaries: one for the awaited fetch, one for
  // the resulting setState's effect cleanup. Mirrors the pattern in
  // the existing SystemMonitoringPanels test.
  await Promise.resolve();
  await Promise.resolve();
};

/** Recursively concatenate every string child under `node` so we can
 *  identify a tab by the literal Chinese label rendered inside it.
 *  JSON.stringify trips over the fiber graph's circular refs, so we
 *  walk the tree by hand instead. */
const textContent = (node: ReactTestInstance | string | number | null): string => {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const children = Array.isArray(node.children) ? node.children : [node.children];
  return children.map((c) => textContent(c as ReactTestInstance | string | number | null)).join('');
};

const findTabByLabel = (root: ReactTestInstance, label: string): ReactTestInstance => {
  const tabs = root.findAllByType(TouchableOpacity);
  for (const tab of tabs) {
    if (textContent(tab).includes(label)) return tab;
  }
  throw new Error(`Tab with label "${label}" not found`);
};

const renderScreen = async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(AuditHistoryScreen));
  });
  await act(async () => {
    await flushMicrotasks();
  });
  return renderer;
};

beforeEach(() => {
  asMock(getMyAuditHistory).mockReset();
  asMock(getMyConsentHistory).mockReset();
  // AI tab always loads on mount; satisfy it with an empty page so
  // it doesn't interfere with the consent-tab assertions below.
  asMock(getMyAuditHistory).mockResolvedValue({
    success: true,
    data: { items: [], count: 0, hasMore: false },
  });
});

describe('AuditHistoryScreen consent tab lazy-load effect', () => {
  it('does not retry the consent fetch after a 500 failure', async () => {
    // Simulate a transient server error. The bug under test would
    // have the effect re-fire forever; the fix makes this exactly
    // one call until the user taps "重试".
    const err = new ApiError('boom');
    err.status = 500;
    asMock(getMyConsentHistory).mockRejectedValue(err);

    const renderer = await renderScreen();

    const consentTab = findTabByLabel(renderer.root, '同意变更历史');
    await act(async () => {
      consentTab.props.onPress();
    });
    // Let the rejected fetch settle and the resulting setState
    // chain (loading → error → loading-cleared) re-run the effect.
    await act(async () => {
      await flushMicrotasks();
    });

    expect(asMock(getMyConsentHistory)).toHaveBeenCalledTimes(1);

    // A second flush proves the effect isn't queued up for the next
    // microtask either — without the !consentError guard, this is
    // where the retry storm shows up.
    await act(async () => {
      await flushMicrotasks();
    });
    expect(asMock(getMyConsentHistory)).toHaveBeenCalledTimes(1);
  });

  it('does not retry the consent fetch after the 404 "no profile" branch', async () => {
    // The PR description explicitly highlights the 404 path. It's
    // the worst case for a retry loop because a missing profile row
    // never spontaneously appears — the loop would be permanent.
    const err = new ApiError('not found');
    err.status = 404;
    asMock(getMyConsentHistory).mockRejectedValue(err);

    const renderer = await renderScreen();

    const consentTab = findTabByLabel(renderer.root, '同意变更历史');
    await act(async () => {
      consentTab.props.onPress();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(asMock(getMyConsentHistory)).toHaveBeenCalledTimes(1);
  });

  it('does not fetch consent history on first mount (lazy load is intact)', async () => {
    asMock(getMyConsentHistory).mockResolvedValue({ events: [] });

    await renderScreen();

    // We landed on the AI tab; the consent fetch must wait.
    expect(asMock(getMyConsentHistory)).not.toHaveBeenCalled();
    // The AI tab itself did fetch.
    expect(asMock(getMyAuditHistory)).toHaveBeenCalledTimes(1);
  });

  it('fetches consent history exactly once on first tab open (success path)', async () => {
    asMock(getMyConsentHistory).mockResolvedValue({ events: [] });

    const renderer = await renderScreen();
    const consentTab = findTabByLabel(renderer.root, '同意变更历史');

    await act(async () => {
      consentTab.props.onPress();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(asMock(getMyConsentHistory)).toHaveBeenCalledTimes(1);

    // Switching back to AI then back to consent again must not
    // re-fetch — consentLoaded keeps the effect quiescent.
    const aiTab = findTabByLabel(renderer.root, 'AI 调用记录');
    await act(async () => {
      aiTab.props.onPress();
    });
    await act(async () => {
      consentTab.props.onPress();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(asMock(getMyConsentHistory)).toHaveBeenCalledTimes(1);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════
 * THE PAGE A PATIENT IS SENT TO IN ORDER TO CHECK WHAT THE AI WAS GIVEN
 * MUST NOT ANSWER IN WIRE VOCABULARY.
 * ══════════════════════════════════════════════════════════════════════
 *
 * 调用工具 printed the tool's registered id and 使用字段 printed the
 * API's allowlist keys, joined with 、 under Chinese labels. The product
 * owns the table for exactly these two vocabularies —
 * `humanizeToolName` / `humanizeFieldKeys` in screens/p-qna/humanize.ts,
 * with `humanize-allowlist-parity.test.ts` holding it against the
 * server's own lists in both directions — and this screen was the one
 * place that did not use it.
 *
 * SYNTHETIC. The entry below carries no patient value at all: an audit
 * row is metadata (which tool, which field NAMES, how long), which is
 * the whole reason this page can exist.
 */
describe('AuditHistoryScreen 用产品自己的说法，而不是线上标识符', () => {
  const auditEntry = {
    id: 'a1',
    createdAt: '2026-08-05T00:00:00.000Z',
    status: 'success',
    consentLevel: 'basic',
    redactionMode: 'strict',
    usedPersonalData: true,
    toolsCalled: [
      { toolCallId: 't1', name: 'get_my_profile', status: 'success', chunkCount: 1, latencyMs: 12 },
      {
        toolCallId: 't2',
        name: 'search_medical_kb',
        status: 'success',
        chunkCount: 3,
        latencyMs: 8,
      },
    ],
    fieldsUsed: ['d4z4_clinical', 'methylation_origin', 'reportDate_year'],
    errorDetail: null,
    llmProvider: 'siliconflow',
    llmModel: 'test-model',
    latencyMs: 900,
    historyMessageCount: 0,
  };

  const renderWithEntry = async () => {
    asMock(getMyAuditHistory).mockResolvedValue({
      success: true,
      data: { items: [auditEntry], count: 1, hasMore: false },
    });
    const renderer = await renderScreen();
    return textContent(renderer.root);
  };

  it('工具名印中文，不印 get_my_profile', async () => {
    const text = await renderWithEntry();
    expect(text).toContain('读取你的健康档案');
    expect(text).toContain('检索 FSHD 知识库');
    expect(text).not.toContain('get_my_profile');
    expect(text).not.toContain('search_medical_kb');
  });

  it('字段名印中文，并且把 _clinical / _origin 收回到它说的那一格上', async () => {
    const text = await renderWithEntry();
    expect(text).toContain('D4Z4 基因结果');
    expect(text).toContain('甲基化结果');
    expect(text).toContain('报告年份');
    for (const key of auditEntry.fieldsUsed) {
      expect(text).not.toContain(key);
    }
  });

  it('认不出来的 key 仍然原样保留 —— 少一条映射不等于少一条记录', async () => {
    asMock(getMyAuditHistory).mockResolvedValue({
      success: true,
      data: {
        items: [{ ...auditEntry, toolsCalled: [], fieldsUsed: ['someKeyTheApiHasNotShippedYet'] }],
        count: 1,
        hasMore: false,
      },
    });
    const renderer = await renderScreen();
    expect(textContent(renderer.root)).toContain('someKeyTheApiHasNotShippedYet');
  });
});
