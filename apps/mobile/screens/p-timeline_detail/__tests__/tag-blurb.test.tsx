/**
 * The blurb under a timeline card's title is the screen's answer to
 * 「这条是什么」. It is drawn from the tag alone — the route hands this
 * screen a title, a timestamp, a tag and sometimes a document id, and
 * nothing else. So a blurb may only say what is true of every record
 * carrying that tag, in every state that record can be in.
 *
 * The 报告 blurb was the one that broke that rule, and each promise it
 * used to make is rendered back here.
 */

import TestRenderer, { act } from 'react-test-renderer';

let mockRouteParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockRouteParams,
}));

// lib/api pulls in session storage, which reaches AsyncStorage at
// module load; jest-expo has no native module for it. Nothing here
// touches the session.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async () => null,
  setItem: async () => undefined,
  removeItem: async () => undefined,
}));

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('SafeAreaView', null, children),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('../../common/feedback/AppDialog', () => ({
  __esModule: true,
  useAppDialog: () => ({ notify: jest.fn(), confirm: jest.fn(async () => true) }),
}));

jest.mock('../api', () => ({
  __esModule: true,
  deleteTimelineRecord: jest.fn(),
}));

import TimelineDetailScreen from '../index';

const mounted: TestRenderer.ReactTestRenderer[] = [];

const render = async (params: Record<string, string>) => {
  mockRouteParams = params;
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<TimelineDetailScreen />);
  });
  mounted.push(tree);
  return tree;
};

const readable = (tree: TestRenderer.ReactTestRenderer): string => {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    walk((node as { children?: unknown }).children ?? []);
  };
  walk(tree.toJSON());
  return out.join(' | ');
};

const reportCard = (extra: Record<string, string> = {}) => ({
  title: '基因检测报告',
  description: '2026-03-12 上传',
  timestamp: '2026-03-12T09:00:00.000Z',
  tag: '报告',
  ...extra,
});

afterEach(async () => {
  for (const tree of mounted.splice(0)) {
    await act(async () => {
      tree.unmount();
    });
  }
});

describe('报告 卡片的说明，不替别的屏幕许诺', () => {
  it('不再说识别结果会自动补进档案', async () => {
    // The autofill reads ONE genetic report — the most recently
    // uploaded — and fills only the profile fields that are still
    // empty. A blood panel changes nothing; the older of two genetic
    // reports changes nothing; a field the patient typed themselves
    // changes nothing. This screen is handed a tag and a timestamp, so
    // it can tell which of those it is looking at exactly never.
    const tree = await render(reportCard());
    const text = readable(tree);
    expect(text).toContain('一份你上传的报告');
    expect(text).not.toContain('自动补进档案');
  });

  it('不再说可以去报告详情里核对或修正', async () => {
    // 修正 is drawn only where the OCR PATCH is accepted — a parse
    // still running, one that failed, and one the pipeline never
    // settled all open a 报告详情 with nothing there to correct.
    const tree = await render(reportCard());
    const text = readable(tree);
    expect(text).not.toContain('核对或修正');
    expect(text).not.toContain('修正');
  });

  it('连去报告详情的入口都可能没有，所以那句话本来就不该无条件说', async () => {
    // The link is drawn from a documentId this screen may not have
    // been given. Without it there is no way from here to the screen
    // the sentence used to send people to.
    const withDoc = await render(reportCard({ documentId: 'doc-1' }));
    expect(readable(withDoc)).toContain('查看报告详情');

    const withoutDoc = await render(reportCard());
    expect(readable(withoutDoc)).not.toContain('查看报告详情');
  });

  it('删除这条要去哪里，还是照说 —— 这句在每种报告上都成立', async () => {
    const tree = await render(reportCard());
    expect(readable(tree)).toContain('报告要在「报告详情」里删除');
  });
});
