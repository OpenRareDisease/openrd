/**
 * 报告管理 must not swallow a failed storage cleanup.
 *
 * `runDeleteReport` awaited `deletePatientDocument` and threw the result
 * away. When the API answered 200 with `storageCleanupStatus: 'failed'`
 * — the row hard-deleted, the scan still in object storage — the row
 * simply vanished from the list and nothing was said. The patient's
 * only evidence was the disappearance, which reads as「删掉了」.
 *
 * Two things are pinned here, and the second is the one that broke in
 * review: the notice has to survive `loadData`, which clears
 * `listNotice` on every successful refetch. Setting it before the
 * reload would wipe it.
 */

import TestRenderer, { act } from 'react-test-renderer';

const mockDeletePatientDocument = jest.fn();
const mockGetMyPatientProfile = jest.fn();

jest.mock('../../../lib/api', () => {
  class ApiError extends Error {
    status?: number;
    data?: unknown;
  }
  return {
    __esModule: true,
    ApiError,
    getMyPatientProfile: (...args: unknown[]) => mockGetMyPatientProfile(...args),
    deletePatientDocument: (...args: unknown[]) => mockDeletePatientDocument(...args),
  };
});

jest.mock('@expo/vector-icons', () => ({ FontAwesome6: 'FontAwesome6' }));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      React.createElement('SafeAreaView', null, children),
  };
});

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(callback, [callback]);
    },
  };
});

jest.mock('../../common/feedback/AppDialog', () => ({
  __esModule: true,
  useAppDialog: () => ({ notify: jest.fn(), confirm: jest.fn(async () => true) }),
}));

import ReportManagementScreen from '../index';

const PROFILE = {
  preferredName: '小明',
  documents: [
    {
      id: 'doc-1',
      documentType: 'genetic_report',
      title: '基因检测 2026',
      fileName: 'genetic.pdf',
      status: 'parsed',
      uploadedAt: '2026-05-01T00:00:00.000Z',
      ocrPayload: null,
    },
  ],
};

const render = async (): Promise<TestRenderer.ReactTestRenderer> => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<ReportManagementScreen />);
  });
  return tree;
};

const allText = (tree: TestRenderer.ReactTestRenderer): string =>
  tree.root
    .findAll((node) => String(node.type) === 'Text')
    .flatMap((node) => node.children)
    .filter((child): child is string => typeof child === 'string')
    .join(' | ');

const pressDelete = async (tree: TestRenderer.ReactTestRenderer) => {
  const [deleteButton] = tree.root.findAll(
    (node) =>
      typeof node.props?.onPress === 'function' &&
      node.props?.accessibilityLabel === '删除基因检测 2026',
  );
  expect(deleteButton).toBeDefined();
  await act(async () => {
    deleteButton.props.onPress();
  });
};

describe('报告管理 delete tells the truth about the stored file', () => {
  beforeEach(() => {
    mockGetMyPatientProfile.mockReset();
    mockGetMyPatientProfile.mockResolvedValue(PROFILE);
    mockDeletePatientDocument.mockReset();
  });

  it('says so when the API reports the file was not erased', async () => {
    mockDeletePatientDocument.mockResolvedValue({
      documentId: 'doc-1',
      deleted: true,
      storageCleanupStatus: 'failed',
    });

    const tree = await render();
    await pressDelete(tree);

    const text = allText(tree);
    expect(mockDeletePatientDocument).toHaveBeenCalledWith('doc-1');
    expect(text).toContain('没能清除');
    // The reload runs between the delete and the notice; if the notice
    // were set first, this is the assertion that would go quiet.
    expect(mockGetMyPatientProfile).toHaveBeenCalledTimes(2);
  });

  it('stays quiet on a clean delete — the row leaving the list is the receipt', async () => {
    mockDeletePatientDocument.mockResolvedValue({
      documentId: 'doc-1',
      deleted: true,
      storageCleanupStatus: 'removed',
    });
    mockGetMyPatientProfile.mockResolvedValueOnce(PROFILE).mockResolvedValue({
      preferredName: '小明',
      documents: [],
    });

    const tree = await render();
    await pressDelete(tree);

    const text = allText(tree);
    expect(text).not.toContain('没能清除');
    expect(text).not.toContain('删除失败');
  });

  it('does not read a missing status as a clean erase', async () => {
    // A server that renamed or dropped the field. The row is gone; what
    // happened to the file is unknown, and unknown is not「已移除」.
    mockDeletePatientDocument.mockResolvedValue({ documentId: 'doc-1', deleted: true });

    const tree = await render();
    await pressDelete(tree);

    expect(allText(tree)).toContain('没有确认');
  });
});
