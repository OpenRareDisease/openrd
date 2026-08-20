/**
 * 隐私设置 → 有条款需要你重新确认.
 *
 * The gate in app/_layout asks on entry and 暂不同意 defers the ask for
 * the session. Without a way back, a patient who wanted to think about
 * it would have to close and reopen the app to be asked again — and the
 * ledger this screen already prints is exactly where they would look.
 * This row runs the same computation the gate runs (`buildConsentAsks`)
 * over this screen's OWN fetch — a different read from the gate's,
 * whose context probes once per session. The two can therefore
 * disagree, which is why 看看改了什么 goes to a screen that re-reads the
 * ledger on mount rather than answering from the session snapshot.
 */

import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

const mockGetAcceptances = jest.fn();

jest.mock('../../../lib/api', () => ({
  __esModule: true,
  ApiError: class ApiError extends Error {},
  getLegalAcceptances: () => mockGetAcceptances(),
  withdrawLegalAcceptance: () => Promise.resolve(undefined),
  getMyConsent: () => Promise.reject(new Error('not part of this test')),
  getMySharingPreferences: () => Promise.reject(new Error('not part of this test')),
  getSubmissionTimeline: () => Promise.resolve({ total: 0 }),
  updateMyConsent: () => Promise.resolve(undefined),
  updateMySharingPreferences: () => Promise.resolve(undefined),
}));

jest.mock('../../../lib/passport-share-api', () => ({
  __esModule: true,
  listPassportShares: () => Promise.resolve([]),
  revokePassportShare: jest.fn(),
  createPassportShare: jest.fn(),
  createPassportPickup: jest.fn(),
}));

jest.mock('../../../lib/consent-epoch', () => ({ __esModule: true, bumpConsentEpoch: jest.fn() }));

jest.mock('../../common/feedback/AppDialog', () => ({
  __esModule: true,
  useAppDialog: () => ({ confirm: jest.fn(), notify: jest.fn() }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ __esModule: true, useRouter: () => ({ push: mockPush }) }));

jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      ReactLocal.createElement('SafeAreaView', null, children),
  };
});

jest.mock('../../common/ScreenHeader', () => {
  const ReactLocal = require('react');
  return { __esModule: true, default: () => ReactLocal.createElement('ScreenHeader', null) };
});

jest.mock('../../common/Icon', () => {
  const ReactLocal = require('react');
  return { __esModule: true, default: () => ReactLocal.createElement('Icon', null) };
});

jest.mock('../../common/ToggleSwitch', () => {
  const ReactLocal = require('react');
  return { __esModule: true, default: () => ReactLocal.createElement('ToggleSwitch', null) };
});

jest.mock('../components/PickupCodeCard', () => ({ __esModule: true, default: () => null }));

import { LEGAL_DOCUMENTS } from '../../../lib/legal-content';
import PrivacySettingsScreen from '../index';

const textContent = (node: ReactTestInstance | string | number | null): string => {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const children = Array.isArray(node.children) ? node.children : [node.children];
  return children.map((child) => textContent(child as ReactTestInstance)).join('');
};

const render = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PrivacySettingsScreen />);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree;
};

beforeEach(() => {
  mockPush.mockReset();
  mockGetAcceptances.mockReset();
});

it('offers a way back into a re-consent the patient put off', async () => {
  mockGetAcceptances.mockResolvedValue({
    acceptances: [
      { document: LEGAL_DOCUMENTS.privacyPolicy, version: '2026-08-02', acceptedAt: '2026-08-02' },
    ],
    current: { [LEGAL_DOCUMENTS.privacyPolicy]: '2026-08-13' },
    outstanding: [LEGAL_DOCUMENTS.privacyPolicy],
  });
  const tree = await render();
  const screen = textContent(tree.root);
  expect(screen).toContain('有条款等你确认');
  expect(screen).toContain('按《隐私政策》第 9 条要重新征得你的同意');
  expect(screen).toContain('《隐私政策》');
  expect(screen).toContain('不同意不会锁住你的账号');

  const button = tree.root
    .findAll((node) => typeof node.type !== 'string' && node.props?.label === '看看改了什么')
    .find((node) => typeof node.props?.onPress === 'function');
  expect(button).toBeDefined();
  await act(async () => {
    button?.props.onPress();
  });
  expect(mockPush).toHaveBeenCalledWith('/p-legal_update');
});

it('does not call a missing record a change', async () => {
  // The dev database's real state: 40 accounts, zero rows in
  // legal_document_acceptances for privacy_policy. Measured with a
  // LATERAL join over app_users on 2026-08-13. Those accounts owe a
  // first acceptance, not a re-consent, and 「改过一处实质变更」 would
  // be false about them.
  mockGetAcceptances.mockResolvedValue({
    acceptances: [],
    current: { [LEGAL_DOCUMENTS.privacyPolicy]: '2026-08-13' },
    outstanding: [LEGAL_DOCUMENTS.privacyPolicy],
  });
  const screen = textContent((await render()).root);
  expect(screen).toContain('有条款等你确认');
  expect(screen).not.toContain('改过一处实质变更');
  expect(screen).toContain('还等你确认一次');
});

it('does not park the withdrawn sensitive-data consent in 待确认', async () => {
  // 撤回敏感信息处理同意 lives on this same screen, and the confirm
  // dialog promises 「需要时可以再次同意」 — at the point the data is
  // needed, which is where SensitiveDataConsentGate asks (p-data_entry,
  // p-falls, p-register_profile). The server reports the withdrawn
  // document as outstanding again, so without the guard in
  // buildConsentAsks this section would ask for it back the moment the
  // withdrawal finished.
  mockGetAcceptances.mockResolvedValue({
    acceptances: [
      { document: LEGAL_DOCUMENTS.privacyPolicy, version: '2026-08-13', acceptedAt: '2026-08-13' },
    ],
    current: { [LEGAL_DOCUMENTS.privacyPolicy]: '2026-08-13' },
    outstanding: [LEGAL_DOCUMENTS.sensitiveData],
  });
  const screen = textContent((await render()).root);
  expect(screen).not.toContain('有条款等你确认');
  expect(screen).not.toContain('敏感个人信息处理单独同意》还等你确认');
});

it('says nothing when nothing is outstanding', async () => {
  mockGetAcceptances.mockResolvedValue({
    acceptances: [
      { document: LEGAL_DOCUMENTS.privacyPolicy, version: '2026-08-13', acceptedAt: '2026-08-13' },
    ],
    current: { [LEGAL_DOCUMENTS.privacyPolicy]: '2026-08-13' },
    outstanding: [],
  });
  expect(textContent((await render()).root)).not.toContain('有条款等你确认');
});
