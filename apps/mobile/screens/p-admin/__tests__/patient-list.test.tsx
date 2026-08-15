import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

/**
 * 患者列表, at the surface an operator reads.
 *
 * TWO PROPERTIES, AND THE SECOND IS THE ONE WITH TEETH.
 *
 * 1. The screen renders exactly what the service sends — 张〇 and
 *    139****0001 — and adds no column the server would have to unmask
 *    to fill. What makes a shoulder-surfed list not be a dialable
 *    roster of Chinese FSHD patients is that this stays true.
 *
 * 2. The pager tells the truth about a page count it may not know.
 *    `total` is `number | null`, and the failure this pins is the
 *    tempting one: `total ?? 0` gives 「共 0 人」 over a screen with
 *    twenty people on it, and dividing by the pageSize we ASKED for
 *    rather than the one the server served walks 下一页 into empty
 *    pages on a server that caps it.
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

const mockList = jest.fn();

jest.mock('../../../lib/admin-api', () => {
  const actual = jest.requireActual('../../../lib/admin-api');
  return { ...actual, listAdminPatients: (...args: unknown[]) => mockList(...args) };
});

import { ADMIN_AUDIT_NOTICE_PATIENT_LIST } from '../common';
import AdminPatientListScreen from '../patient-list';

const USER_ID = '11111111-1111-4111-8111-111111111111';

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
    tree = TestRenderer.create(<AdminPatientListScreen />);
    await flush();
  });
  return tree;
};

const pressByLabel = async (tree: TestRenderer.ReactTestRenderer, label: string) => {
  const node = tree.root.find(
    (candidate) =>
      candidate.props?.accessibilityLabel === label &&
      typeof candidate.props?.onPress === 'function' &&
      candidate.props?.disabled !== true,
  );
  await act(async () => {
    node.props.onPress();
    await flush();
  });
};

const findByLabel = (tree: TestRenderer.ReactTestRenderer, label: string) =>
  tree.root.find(
    (candidate) =>
      candidate.props?.accessibilityLabel === label &&
      typeof candidate.props?.onPress === 'function',
  );

/** Rows in the shape `AdminPatientListItem` arrives in — masked. */
const row = (overrides: Record<string, unknown> = {}) => ({
  userId: USER_ID,
  patientCode: 'FSHD-0001',
  maskedName: '张〇',
  maskedPhone: '139****0001',
  role: 'patient',
  isActive: true,
  hasProfile: true,
  registeredAt: '2026-07-01T02:00:00.000Z',
  profileUpdatedAt: '2026-08-01T02:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  mockPush.mockReset();
  mockList.mockReset();
});

describe('the list shows what the server masked, and nothing it did not send', () => {
  it('renders the masked name and phone', async () => {
    mockList.mockResolvedValue({ page: 1, pageSize: 20, total: 1, items: [row()] });
    const screen = textContent((await render()).root);
    expect(screen).toContain('张〇');
    expect(screen).toContain('139****0001');
    expect(screen).toContain('共 1 人');
  });

  it('labels an account with no profile rather than leaving the row bare', async () => {
    mockList.mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 1,
      items: [row({ maskedName: null, hasProfile: false, profileUpdatedAt: null })],
    });
    const screen = textContent((await render()).root);
    expect(screen).toContain('未填姓名');
    expect(screen).toContain('未建档');
  });

  it('opens a row on the id every patient-scoped route is keyed on', async () => {
    mockList.mockResolvedValue({ page: 1, pageSize: 20, total: 1, items: [row()] });
    const tree = await render();
    await pressByLabel(tree, '打开 张〇 的档案');
    expect(mockPush).toHaveBeenCalledWith(`/p-admin_patient?userId=${USER_ID}`);
  });
});

describe('a total the server did not send is not zero and not invented', () => {
  const twenty = Array.from({ length: 20 }, (_, index) => row({ userId: `u-${index}` }));

  it('says how many are on screen and refuses to write 共几人', async () => {
    mockList.mockResolvedValue({ page: 1, pageSize: 20, total: null, items: twenty });
    const screen = textContent((await render()).root);
    expect(screen).toContain('本页 20 人');
    expect(screen).toContain('服务端没有返回总数');
    expect(screen).not.toContain('共 0 人');
    // No denominator either: 「第 1 / 1 页」 over an unknown total is
    // the same invention with a different shape.
    expect(screen).not.toContain('/ 1 页');
  });

  it('still offers 下一页 on a full page, because a full page may not be the last', async () => {
    mockList.mockResolvedValue({ page: 1, pageSize: 20, total: null, items: twenty });
    const tree = await render();
    expect(findByLabel(tree, '下一页').props.disabled).toBe(false);
    await pressByLabel(tree, '下一页');
    expect(mockList).toHaveBeenLastCalledWith({ page: 2, q: '', pageSize: 20 });
  });

  it('stops offering 下一页 once a page comes back short', async () => {
    mockList.mockResolvedValue({ page: 1, pageSize: 20, total: null, items: [row()] });
    const tree = await render();
    expect(findByLabel(tree, '下一页').props.disabled).toBe(true);
  });
});

describe('the page count comes from the size the server served', () => {
  it('uses the served pageSize, not the one this screen asked for', async () => {
    // A server that caps pageSize at 10 while we asked for 20. Dividing
    // 25 by 20 says two pages; the operator would then find page 3
    // unreachable and never know rows were missing.
    mockList.mockResolvedValue({
      page: 1,
      pageSize: 10,
      total: 25,
      items: Array.from({ length: 10 }, (_, index) => row({ userId: `u-${index}` })),
    });
    expect(textContent((await render()).root)).toContain('第 1 / 3 页');
  });
});

describe('searching', () => {
  it('sends the trimmed term and goes back to page 1 from wherever the operator was', async () => {
    mockList.mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 60,
      items: Array.from({ length: 20 }, (_, index) => row({ userId: `u-${index}` })),
    });
    const tree = await render();
    // Walk off page 1 first — otherwise the reset is not exercised at
    // all and this assertion passes with the reset deleted.
    await pressByLabel(tree, '下一页');
    expect(mockList).toHaveBeenLastCalledWith({ page: 2, q: '', pageSize: 20 });

    const input = tree.root.find((candidate) => candidate.props?.accessibilityLabel === '搜索患者');
    await act(async () => {
      input.props.onChangeText(' 张三 ');
      await flush();
    });
    await pressByLabel(tree, '搜索');

    // Staying on page 2 of the previous result set shows an empty page,
    // which an operator reads as 「没有这个人」.
    expect(mockList).toHaveBeenLastCalledWith({ page: 1, q: '张三', pageSize: 20 });
  });

  it('re-fetches an unchanged term on page 1, because the operator asked for fresh data', async () => {
    mockList.mockResolvedValue({ page: 1, pageSize: 20, total: 3, items: [row({})] });
    const tree = await render();
    expect(mockList).toHaveBeenCalledTimes(1);
    await pressByLabel(tree, '搜索');
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(mockList).toHaveBeenLastCalledWith({ page: 1, q: '', pageSize: 20 });
  });

  it('spends one request, and one audit row, on one press of 搜索', async () => {
    // From page 2 with the term unchanged, `setPage(1)` re-runs the
    // effect with exactly the arguments the explicit `load` would use.
    // Firing both writes two `admin.list` rows for one press — two
    // records of an operator looking at the roster when they looked
    // once.
    mockList.mockResolvedValue({
      page: 1,
      pageSize: 20,
      total: 60,
      items: Array.from({ length: 20 }, (_, index) => row({ userId: `u-${index}` })),
    });
    const tree = await render();
    await pressByLabel(tree, '下一页');
    expect(mockList).toHaveBeenCalledTimes(2);

    await pressByLabel(tree, '搜索');
    expect(mockList).toHaveBeenCalledTimes(3);
    expect(mockList).toHaveBeenLastCalledWith({ page: 1, q: '', pageSize: 20 });
  });

  it('says what the search does and does not match when it finds nobody', async () => {
    mockList.mockResolvedValue({ page: 1, pageSize: 20, total: 0, items: [] });
    const tree = await render();
    const input = tree.root.find((candidate) => candidate.props?.accessibilityLabel === '搜索患者');
    await act(async () => {
      input.props.onChangeText('张三');
      await flush();
    });
    await pressByLabel(tree, '搜索');
    const screen = textContent(tree.root);
    expect(screen).toContain('没有匹配「张三」的账号');
    expect(screen).toContain('不匹配病历内容');
  });
});

describe('a failure says which failure it was', () => {
  it('renders the 403 wording rather than a blank list', async () => {
    const { ApiError } = jest.requireActual('../../../lib/api');
    const denied = new ApiError('Forbidden');
    denied.status = 403;
    mockList.mockRejectedValue(denied);
    const screen = textContent((await render()).root);
    expect(screen).toContain('这个账号没有后台权限');
    expect(screen).not.toContain('一个账号也没有');
  });
});

describe('the audit banner is true on a page whose rows name no patient', () => {
  it('draws the notice written for this screen over a list of many patients', async () => {
    // A page of patients is not one patient: `listPatients` is mounted
    // without a `targetParam`, so the row for this screen says which
    // administrator asked for the list and not whose rows came back.
    // The subtitle below already tells an operator where the audited
    // patient read happens — opening one of these rows — and the
    // banner must not contradict it by claiming this page recorded one.
    mockList.mockResolvedValue({ page: 1, pageSize: 20, total: 1, items: [row()] });
    const screen = textContent((await render()).root);
    expect(screen).toContain(ADMIN_AUDIT_NOTICE_PATIENT_LIST);
    expect(screen).not.toContain('看了哪位患者');
    expect(screen).toContain('点开一位患者才会看到完整信息，那一次会记进审计。');
  });
});
