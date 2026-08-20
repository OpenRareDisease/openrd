/**
 * LegalConsentContext — the single read of 「这个账号还欠哪些同意」.
 *
 * The gate in app/_layout and the screen it opens both hang off this
 * one probe, and the two states that are easy to get backwards are what
 * this file pins: a failed read must NOT ask (an API that cannot be
 * read cannot record an acceptance either), and signing out must forget
 * both the debt and the deferral, or the next person on this device
 * inherits a decision they never made.
 */

import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

const mockGetAcceptances = jest.fn();

jest.mock('../../lib/api', () => ({
  __esModule: true,
  getLegalAcceptances: () => mockGetAcceptances(),
}));

let mockToken: string | null = 'token-123';
let mockHydrated = true;

jest.mock('../AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({ token: mockToken, isHydrated: mockHydrated }),
}));

import { LEGAL_DOCUMENTS } from '../../lib/legal-content';
import { LegalConsentProvider, useLegalConsentContext } from '../LegalConsentContext';

let latest: ReturnType<typeof useLegalConsentContext> | null = null;

const Probe = () => {
  latest = useLegalConsentContext();
  return <Text>{latest.status}</Text>;
};

const render = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <LegalConsentProvider>
        <Probe />
      </LegalConsentProvider>,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return tree;
};

const OUTSTANDING = {
  acceptances: [
    { document: LEGAL_DOCUMENTS.privacyPolicy, version: '2026-08-02', acceptedAt: '2026-08-02' },
  ],
  current: { [LEGAL_DOCUMENTS.privacyPolicy]: '2026-08-13' },
  outstanding: [LEGAL_DOCUMENTS.privacyPolicy],
};

beforeEach(() => {
  latest = null;
  mockToken = 'token-123';
  mockHydrated = true;
  mockGetAcceptances.mockReset();
});

it('reports pending with the ask when the ledger says a document was revised', async () => {
  mockGetAcceptances.mockResolvedValue(OUTSTANDING);
  await render();
  expect(latest?.status).toBe('pending');
  expect(latest?.asks.map((ask) => ask.document)).toEqual([LEGAL_DOCUMENTS.privacyPolicy]);
});

it('reports ready when nothing is outstanding', async () => {
  mockGetAcceptances.mockResolvedValue({ acceptances: [], current: {}, outstanding: [] });
  await render();
  expect(latest?.status).toBe('ready');
});

it('fails OPEN when the ledger cannot be read', async () => {
  // Not 'pending'. A patient on a train would otherwise be parked on a
  // consent screen whose only button posts to the same unreachable API.
  mockGetAcceptances.mockRejectedValue(new Error('offline'));
  await render();
  expect(latest?.status).toBe('error');
  expect(latest?.asks).toEqual([]);
});

it('does not probe before the token has hydrated', async () => {
  mockHydrated = false;
  mockGetAcceptances.mockResolvedValue(OUTSTANDING);
  await render();
  expect(mockGetAcceptances).not.toHaveBeenCalled();
  expect(latest?.status).toBe('loading');
});

it('forgets the debt and the deferral when the session ends', async () => {
  mockGetAcceptances.mockResolvedValue(OUTSTANDING);
  const tree = await render();
  await act(async () => {
    latest?.defer();
  });
  expect(latest?.deferred).toBe(true);

  mockToken = null;
  await act(async () => {
    tree.update(
      <LegalConsentProvider>
        <Probe />
      </LegalConsentProvider>,
    );
    await Promise.resolve();
  });
  expect(latest?.status).toBe('loading');
  expect(latest?.deferred).toBe(false);
  expect(latest?.asks).toEqual([]);
});

it('re-reads the ledger on refresh, so an acceptance stops the asking', async () => {
  mockGetAcceptances.mockResolvedValue(OUTSTANDING);
  await render();
  expect(latest?.status).toBe('pending');
  mockGetAcceptances.mockResolvedValue({
    acceptances: [
      { document: LEGAL_DOCUMENTS.privacyPolicy, version: '2026-08-13', acceptedAt: '2026-08-13' },
    ],
    current: { [LEGAL_DOCUMENTS.privacyPolicy]: '2026-08-13' },
    outstanding: [],
  });
  await act(async () => {
    await latest?.refresh();
  });
  expect(latest?.status).toBe('ready');
});
