import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

/**
 * 运维概览, at the surface an operator reads.
 *
 * THE PROMISE THIS FILE EXISTS TO PIN is the screen's own subtitle:
 *「取不到的那一项会说自己取不到，不会显示 0」. lib/__tests__/admin-api.test.ts
 * pins the READER — a missing metric parses as `null`. That is not the
 * same assertion: a `null` rendered through a `?? 0` further down is
 * the same defect with a better data model, and this is the page an
 * operator checks INSTEAD of SSHing to the host and running psql.
 *
 * It also pins the two independence properties the page is built on:
 * each block fails on its own, and a queue row the server did not say
 * the owner of does not pretend to open a patient.
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

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      ReactLocal.createElement('SafeAreaView', null, children),
  };
});

jest.mock('../../common/ScreenHeader', () => {
  const ReactLocal = require('react');
  return { __esModule: true, default: () => ReactLocal.createElement('ScreenHeader') };
});

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

const mockHealth = jest.fn();
const mockQueue = jest.fn();
const mockCorpus = jest.fn();
const mockAiUsage = jest.fn();

jest.mock('../../../lib/admin-api', () => {
  const actual = jest.requireActual('../../../lib/admin-api');
  return {
    ...actual,
    getAdminHealth: () => mockHealth(),
    getAdminParseFailureQueue: () => mockQueue(),
    getAdminCorpusStatus: () => mockCorpus(),
    getAdminAiUsage: (...args: unknown[]) => mockAiUsage(...args),
  };
});

import { AdminResponseError } from '../../../lib/admin-api';
import { ADMIN_AUDIT_NOTICE_OVERVIEW } from '../common';
import AdminOverviewScreen from '../index';

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
    tree = TestRenderer.create(<AdminOverviewScreen />);
    await flush();
  });
  return tree;
};

/** The four bodies, in the shape apps/api/src/modules/admin sends. */
const HEALTH = {
  status: 'ok',
  ready: true,
  components: { database: { status: 'ok' } },
};
const QUEUE = { items: [], atCap: false, limit: 50, stuckAfterMinutes: 10 };
const CORPUS = {
  chunkCount: 12842,
  sourceFileCount: 96,
  unembeddedChunkCount: 0,
  embedModels: [{ embedModel: 'bge-large-zh', chunkCount: 12800 }],
  oldestUpdatedAt: '2026-05-01T02:00:00.000Z',
  newestUpdatedAt: '2026-08-01T02:00:00.000Z',
};
const AI_USAGE = {
  windowDays: 7,
  retentionDays: 180,
  totalCalls: 120,
  byStatus: [{ status: 'success', calls: 120, avgLatencyMs: 900 }],
  failureRate: 0,
};

beforeEach(() => {
  mockPush.mockReset();
  mockHealth.mockReset().mockResolvedValue(undefined);
  mockQueue.mockReset().mockResolvedValue(undefined);
  mockCorpus.mockReset().mockResolvedValue(undefined);
  mockAiUsage.mockReset().mockResolvedValue(undefined);
});

const readAll = () => {
  const actual = jest.requireActual('../../../lib/admin-api');
  mockHealth.mockResolvedValue(actual.readAdminHealth(HEALTH));
  mockQueue.mockResolvedValue(actual.readAdminParseFailureQueue(QUEUE));
  mockCorpus.mockResolvedValue(actual.readAdminCorpusStatus(CORPUS));
  mockAiUsage.mockResolvedValue(actual.readAdminAiUsage(AI_USAGE));
  return actual;
};

describe('取不到的那一项会说自己取不到，不会显示 0', () => {
  it('renders a metric the server omitted as 服务端没有返回这一项', async () => {
    const actual = readAll();
    // A build whose server does not compute the unembedded count. The
    // sentence 「没有 embedding 的分块：0 段」 would be the page an
    // operator trusts instead of checking the corpus.
    mockCorpus.mockResolvedValue(
      actual.readAdminCorpusStatus({ ...CORPUS, unembeddedChunkCount: undefined }),
    );
    const screen = textContent((await render()).root);
    expect(screen).toContain('没有 embedding 的分块');
    expect(screen).toContain('服务端没有返回这一项');
    expect(screen).not.toContain('没有 embedding 的分块0 段');
  });

  it('says 0/0 不是 0% rather than printing 0.0%', async () => {
    const actual = readAll();
    mockAiUsage.mockResolvedValue(
      actual.readAdminAiUsage({ ...AI_USAGE, totalCalls: 0, byStatus: [], failureRate: null }),
    );
    const screen = textContent((await render()).root);
    expect(screen).toContain('0/0 不是 0%');
    expect(screen).not.toContain('0.0%');
    // `failureRate: null` here is the server's ANSWER, not a field it
    // failed to send. Printing 「服务端没有返回这一项」 over the sentence
    // that explains the measurement is the page contradicting itself.
    expect(screen).not.toContain('服务端没有返回这一项');
    expect(screen).toContain('窗口内没有可计入的调用');
  });

  it('separates a failureRate the server omitted from a measured 0/0', async () => {
    // Same `null` on the wire, opposite facts. A build whose server does
    // not compute the rate would otherwise have the page assert 「窗口内
    // 没有成功也没有失败的调用」 about a window holding 120 calls.
    const actual = readAll();
    mockAiUsage.mockResolvedValue(actual.readAdminAiUsage({ ...AI_USAGE, failureRate: undefined }));
    const screen = textContent((await render()).root);
    expect(screen).toContain('服务端没有返回这一项');
    expect(screen).not.toContain('0/0 不是 0%');
    expect(screen).toContain('这一项是没到');
  });

  it('does not claim there were calls in the window when the count is missing too', async () => {
    // Both fields absent. The page used to print 「服务端没有返回这一项」
    // for 调用总数 and, two lines down, 「窗口里有计入分母的调用」 for the
    // failure rate — one block saying it did not receive the count and
    // the next one asserting what the count was.
    const actual = readAll();
    mockAiUsage.mockResolvedValue(
      actual.readAdminAiUsage({ ...AI_USAGE, totalCalls: undefined, failureRate: undefined }),
    );
    const screen = textContent((await render()).root);
    expect(screen).toContain('服务端没有返回这一项');
    expect(screen).toContain('连分母是不是 0 都判断不了');
    expect(screen).not.toContain('窗口里有计入分母的调用');
    expect(screen).not.toContain('0/0 不是 0%');
  });

  it('reads a window of nothing but consent_denied as 0/0, not as a missing field', async () => {
    // `attempted = totalCalls - consent_denied`, so the server answers
    // null here too — and it is measured. The count is what tells this
    // case apart from the one above.
    const actual = readAll();
    mockAiUsage.mockResolvedValue(
      actual.readAdminAiUsage({
        ...AI_USAGE,
        totalCalls: 9,
        byStatus: [{ status: 'consent_denied', calls: 9, avgLatencyMs: 12 }],
        failureRate: null,
      }),
    );
    const screen = textContent((await render()).root);
    expect(screen).toContain('窗口内没有可计入的调用');
    expect(screen).not.toContain('服务端没有返回这一项');
  });

  it('does not blame the server for a corpus that is simply empty', async () => {
    // THE STATE EVERY STACK IS IN ON ITS FIRST DAY. `getCorpusStatus`
    // asks `kb_chunks` for totals and for a GROUP BY over `embed_model`;
    // with no rows the totals are zeroes with NULL timestamps and the
    // breakdown is no rows at all. The page rendered both derived rows
    // as 「服务端没有返回这一项」, so the operator standing in front of a
    // freshly deployed stack was told the API was broken and sent to
    // read logs that say nothing.
    const actual = readAll();
    mockCorpus.mockResolvedValue(
      actual.readAdminCorpusStatus({
        chunkCount: 0,
        sourceFileCount: 0,
        unembeddedChunkCount: 0,
        embedModels: [],
        oldestUpdatedAt: null,
        newestUpdatedAt: null,
      }),
    );
    const screen = textContent((await render()).root);
    expect(screen).toContain('语料库里还没有分块');
    expect(screen).toContain('全新部署还没导语料时就是这个样子');
    // The AI block is untouched by this and still renders its own
    // numbers, so 「服务端没有返回这一项」 must be absent because the
    // corpus block stopped saying it — not because nothing else could.
    expect(screen).not.toContain('服务端没有返回这一项');
  });

  it('still says a model list is missing when the corpus is not empty', async () => {
    // The other side of the discriminator: chunks in the table and no
    // breakdown of them means the field did not arrive. 「语料库里还没有
    // 分块」 here would deny the count printed one row above it.
    const actual = readAll();
    mockCorpus.mockResolvedValue(
      actual.readAdminCorpusStatus({ ...CORPUS, embedModels: undefined, newestUpdatedAt: null }),
    );
    const screen = textContent((await render()).root);
    expect(screen).toContain('服务端没有返回这一项');
    expect(screen).not.toContain('语料库里还没有分块');
  });

  it('cannot tell either way when the chunk count itself did not arrive', async () => {
    // No denominator, so no answer. Asserting an empty corpus off a
    // count the page just said it did not receive is the failure the
    // AI block's third case exists for, arriving through the other
    // block.
    const actual = readAll();
    mockCorpus.mockResolvedValue(
      actual.readAdminCorpusStatus({
        ...CORPUS,
        chunkCount: undefined,
        embedModels: [],
        newestUpdatedAt: null,
      }),
    );
    const screen = textContent((await render()).root);
    expect(screen).toContain('服务端没有返回这一项');
    expect(screen).not.toContain('语料库里还没有分块');
  });

  it('still prints a real zero as a number', async () => {
    // The other half of the promise: 「不会显示 0」 is about a MISSING
    // value. A measured zero is a fact and must render.
    readAll();
    const screen = textContent((await render()).root);
    expect(screen).toContain('0.0%');
    expect(screen).toContain('12842 段');
  });
});

describe('each block fails on its own', () => {
  it('renders the other three when one request fails', async () => {
    readAll();
    mockQueue.mockRejectedValue(new AdminResponseError('解析失败队列'));
    const screen = textContent((await render()).root);
    expect(screen).toContain('读不懂服务端的返回');
    // The corpus and AI blocks are untouched by the queue's failure —
    // this is why the page makes four requests instead of one.
    expect(screen).toContain('12842 段');
    expect(screen).toContain('120 次');
  });
});

describe('the parse-failure queue', () => {
  it('says the list was truncated instead of letting a backlog look clear', async () => {
    const actual = readAll();
    mockQueue.mockResolvedValue(
      actual.readAdminParseFailureQueue({
        items: [
          {
            documentId: '22222222-2222-4222-8222-222222222222',
            userId: '11111111-1111-4111-8111-111111111111',
            documentType: 'genetic_report',
            status: 'parse_failed',
            uploadedAt: '2026-08-10T02:00:00.000Z',
          },
        ],
        atCap: true,
        limit: 50,
        stuckAfterMinutes: 10,
      }),
    );
    expect(textContent((await render()).root)).toContain('列表被截断在 50 条');
  });

  it('disables a row whose owner the server did not send, and says why', async () => {
    const actual = readAll();
    mockQueue.mockResolvedValue(
      actual.readAdminParseFailureQueue({
        items: [
          {
            documentId: '22222222-2222-4222-8222-222222222222',
            documentType: 'genetic_report',
            status: 'parse_failed',
            uploadedAt: '2026-08-10T02:00:00.000Z',
          },
        ],
        atCap: false,
        limit: 50,
        stuckAfterMinutes: 10,
      }),
    );
    const tree = await render();
    const row = tree.root.find(
      (node) =>
        typeof node.props?.accessibilityLabel === 'string' &&
        String(node.props.accessibilityLabel).startsWith('打开这份报告所属患者的档案'),
    );
    expect(row.props.disabled).toBe(true);
    await act(async () => {
      row.props.onPress();
      await flush();
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(textContent(tree.root)).toContain('服务端没有返回这份报告属于谁');
  });

  it('opens the owning patient when the server did send one', async () => {
    const actual = readAll();
    mockQueue.mockResolvedValue(
      actual.readAdminParseFailureQueue({
        items: [
          {
            documentId: '22222222-2222-4222-8222-222222222222',
            userId: '11111111-1111-4111-8111-111111111111',
            documentType: 'genetic_report',
            status: 'parse_failed',
            uploadedAt: '2026-08-10T02:00:00.000Z',
          },
        ],
        atCap: false,
        limit: 50,
        stuckAfterMinutes: 10,
      }),
    );
    const tree = await render();
    const row = tree.root.find(
      (node) =>
        typeof node.props?.accessibilityLabel === 'string' &&
        String(node.props.accessibilityLabel).startsWith('打开这份报告所属患者的档案'),
    );
    await act(async () => {
      row.props.onPress();
      await flush();
    });
    expect(mockPush).toHaveBeenCalledWith(
      '/p-admin_patient?userId=11111111-1111-4111-8111-111111111111',
    );
  });
});

describe('§B4 导出 is reachable from here', () => {
  it('offers the full export as its own route rather than a button on this page', async () => {
    readAll();
    const tree = await render();
    const row = tree.root.find(
      (node) =>
        typeof node.props?.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel === '全量导出' &&
        typeof node.props?.onPress === 'function',
    );
    await act(async () => {
      row.props.onPress();
      await flush();
    });
    expect(mockPush).toHaveBeenCalledWith('/p-admin_export');
  });

  it('leads to the patient list', async () => {
    readAll();
    const tree = await render();
    const row = tree.root.find(
      (node) =>
        typeof node.props?.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel === '患者列表' &&
        typeof node.props?.onPress === 'function',
    );
    await act(async () => {
      row.props.onPress();
      await flush();
    });
    expect(mockPush).toHaveBeenCalledWith('/p-admin_patients');
  });
});

describe('总体状态 does not answer for the components', () => {
  it('does not say 组件都还好 over a draining instance whose database is down', async () => {
    // A deploy and a real failure can be true at the same moment — the
    // server has its own test for exactly that state
    // (apps/api/src/routes/health.test.ts, 「reports draining without
    // hiding a real component failure」). The draining branch was
    // written first and answered for the components as well, so this
    // page was the one surface that folded the failure away on the
    // morning it mattered.
    const actual = readAll();
    mockHealth.mockResolvedValue(
      actual.readAdminHealth({
        status: 'error',
        ready: false,
        draining: true,
        components: { database: { status: 'error', detail: 'ECONNREFUSED' } },
      }),
    );
    const screen = textContent((await render()).root);
    expect(screen).not.toContain('组件都还好');
    // The component says what happened to it, one line below.
    expect(screen).toContain('ECONNREFUSED');
    // …and draining is still reported, because it is still true.
    expect(screen).toContain('正在退出（draining）');
  });

  it('still says an ordinary deploy is a deploy', async () => {
    const actual = readAll();
    mockHealth.mockResolvedValue(
      actual.readAdminHealth({
        status: 'degraded',
        ready: false,
        draining: true,
        components: { database: { status: 'ok' } },
      }),
    );
    const screen = textContent((await render()).root);
    expect(screen).toContain('正在退出（draining）');
    expect(screen).toContain('不该再接新流量');
    // 未就绪 is what draining MEANS here, and the page says it once.
    expect(screen).not.toContain('负载均衡应该把它摘掉');
  });
});

describe('the audit banner is true on a page whose rows name no patient', () => {
  it('draws the notice written for this screen, and it promises no patient here', async () => {
    // Everything this screen requests is mounted without a
    // `targetParam` (admin.routes.ts), so every row it writes has
    // `targetUserId: null` — asserted against the real router in
    // apps/api/src/modules/admin/admin.routes.test.ts. The banner used
    // to be one constant drawn on every back-office screen and promised
    // 「看了哪位患者的哪个接口」, which no row on this page could
    // support. Asserting the constant this screen was given is what
    // stops it being handed another screen's promise later.
    readAll();
    const screen = textContent((await render()).root);
    expect(screen).toContain(ADMIN_AUDIT_NOTICE_OVERVIEW);
    expect(screen).not.toContain('看了哪位患者');
  });
});
