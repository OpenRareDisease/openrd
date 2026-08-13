/**
 * 报告详情 must not announce an erasure the server did not perform.
 *
 * `runDelete` awaited `deletePatientDocument`, discarded the result, and
 * called `notify({title:'已删除', message:'这份报告已移除…'})`
 * unconditionally before navigating to the list. The API answers 200
 * with `storageCleanupStatus: 'failed'` when the blob removal throws:
 * row hard-deleted, scan still in storage, and — because the row was
 * the only pointer to it — nothing can ever find that file again,
 * including the account-deletion purge. A patient was told their
 * genetic report had been erased when it had not.
 *
 * The banner survives the navigation (it lives in the root provider),
 * so the unhappy branch still reaches the reader after `router.replace`.
 * That is why this asserts on `notify` rather than on the tree: by the
 * time the message matters, this screen is gone.
 */

import TestRenderer, { act } from 'react-test-renderer';

const mockDeletePatientDocument = jest.fn();
const mockNotify = jest.fn();
const mockConfirm = jest.fn(async () => true);
const mockReplace = jest.fn();

jest.mock('../../../lib/api', () => {
  class ApiError extends Error {
    status?: number;
    data?: unknown;
  }
  return {
    __esModule: true,
    ApiError,
    deletePatientDocument: (...args: unknown[]) => mockDeletePatientDocument(...args),
    // The screen's own load path. A parsed document with no fields is
    // enough: this file is about the delete button.
    getPatientDocumentOcr: jest.fn(async () => ({
      documentId: 'doc-1',
      status: 'parsed',
      ocrPayload: { fields: {} },
    })),
    getMyConsent: jest.fn(async () => ({ level: 'none' })),
    generatePatientDocumentSummary: jest.fn(),
    patchPatientDocumentOcr: jest.fn(),
    reparsePatientDocument: jest.fn(),
    updateMyConsent: jest.fn(),
  };
});

// lib/consent-epoch reaches AsyncStorage at module load, and jest-expo
// has no native module for it. Nothing here changes consent.
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

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({ documentId: 'doc-1' }),
}));

jest.mock('../../common/feedback/AppDialog', () => ({
  __esModule: true,
  useAppDialog: () => ({ notify: mockNotify, confirm: mockConfirm }),
}));

import ReportDetailScreen from '../index';

const render = async (): Promise<TestRenderer.ReactTestRenderer> => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<ReportDetailScreen />);
  });
  return tree;
};

const pressDelete = async (tree: TestRenderer.ReactTestRenderer) => {
  const [deleteButton] = tree.root.findAll(
    (node) =>
      typeof node.props?.onPress === 'function' &&
      (node.props?.label === '删除这份报告' || node.props?.accessibilityLabel === '删除这份报告'),
  );
  expect(deleteButton).toBeDefined();
  await act(async () => {
    await deleteButton.props.onPress();
  });
};

describe('报告详情 delete tells the truth about the stored file', () => {
  beforeEach(() => {
    mockDeletePatientDocument.mockReset();
    mockNotify.mockReset();
    mockReplace.mockReset();
  });

  it('never says 已移除 when the API reports the cleanup failed', async () => {
    mockDeletePatientDocument.mockResolvedValue({
      documentId: 'doc-1',
      deleted: true,
      storageCleanupStatus: 'failed',
    });

    const tree = await render();
    await pressDelete(tree);

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const banner = mockNotify.mock.calls[0][0] as {
      title: string;
      message: string;
      tone: string;
    };
    expect(banner.message).not.toContain('已移除');
    expect(banner.message).toContain('没能清除');
    expect(banner.tone).toBe('error');
    // The row IS gone, so staying on a detail screen with no document
    // would be its own lie — the navigation is still correct.
    expect(mockReplace).toHaveBeenCalledWith('/p-report_management');
  });

  it('keeps the plain confirmation when the file really was removed', async () => {
    mockDeletePatientDocument.mockResolvedValue({
      documentId: 'doc-1',
      deleted: true,
      storageCleanupStatus: 'removed',
    });

    const tree = await render();
    await pressDelete(tree);

    const banner = mockNotify.mock.calls[0][0] as { message: string; tone: string };
    expect(banner.message).toContain('这份报告已移除');
    expect(banner.tone).toBe('success');
  });

  it('does not upgrade an unknown status to a claim of erasure', async () => {
    mockDeletePatientDocument.mockResolvedValue({ documentId: 'doc-1', deleted: true });

    const tree = await render();
    await pressDelete(tree);

    const banner = mockNotify.mock.calls[0][0] as { message: string };
    expect(banner.message).not.toContain('已移除');
    expect(banner.message).toContain('没有确认');
  });
});
