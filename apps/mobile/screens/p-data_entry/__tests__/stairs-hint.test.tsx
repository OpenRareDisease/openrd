/**
 * The hint beside 标准化上楼记录, against what the patient actually filed.
 *
 * The hint exists so a patient does not have to re-explain what the
 * baseline already says. That only works if it quotes the right answer
 * back. Migration 022 split the old boolean into three states, and
 * 无法行走 is not 需要辅助: telling a wheelchair user they filed
 *「行动需要辅助」 and asking 「如果今天能走」 is the same fabrication as
 * pre-selecting the toggle would be, in the block whose own comment
 * forbids that.
 *
 * A device is not an answer about walking either — 轮椅 can be listed by
 * someone who answered 可独立行走 and uses it for long distances — so the
 * device branch quotes the device and no ambulation answer at all.
 */

import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

jest.mock('../../../lib/api', () => {
  class ApiError extends Error {
    status?: number;
    data?: unknown;
  }
  return {
    __esModule: true,
    ApiError,
    isConsentRequiredError: () => false,
    addActivityLog: jest.fn(),
    addDailyImpact: jest.fn(),
    addFunctionTest: jest.fn(),
    addFollowupEvent: jest.fn(),
    addPatientMeasurement: jest.fn(),
    addSymptomScore: jest.fn(),
    createSubmission: jest.fn(),
    draftLogEntry: jest.fn(),
    getMyPatientProfile: jest.fn(),
    getInstrumentCatalogue: jest.fn(),
    getInstrumentAdministrations: jest.fn(),
    recordInstrumentAdministration: jest.fn(),
    uploadPatientDocumentsSerially: jest.fn(),
  };
});

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../../../lib/session-storage', () => ({
  getSessionValue: jest.fn().mockResolvedValue(null),
  setSessionValue: jest.fn().mockResolvedValue(undefined),
  removeSessionValue: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      ReactLocal.createElement('SafeAreaView', null, children),
  };
});
jest.mock('../../common/feedback/AppDialog', () => ({
  useAppDialog: () => ({ notify: jest.fn(), confirm: jest.fn() }),
}));
jest.mock('../../common/ScreenHeader', () => {
  const ReactLocal = require('react');
  return { __esModule: true, default: () => ReactLocal.createElement('ScreenHeader') };
});
jest.mock('../../p-privacy_settings/components/SensitiveDataConsentGate', () => {
  const ReactLocal = require('react');
  return {
    __esModule: true,
    default: () => ReactLocal.createElement('SensitiveDataConsentGate'),
    useSensitiveDataConsentGate: () => ({
      ensureSensitiveDataConsent: jest.fn().mockResolvedValue(true),
      gateProps: {},
    }),
  };
});

import DataEntryScreen from '../index';
import * as apiModule from '../../../lib/api';

const mockApi = apiModule as unknown as Record<string, jest.Mock>;

const makeProfile = (currentStatus: Record<string, unknown>) => ({
  id: 'p1',
  fullName: '张三',
  baseline: { currentStatus },
  measurements: [],
  functionTests: [],
  symptomScores: [],
  dailyImpacts: [],
  followupEvents: [],
  activityLogs: [],
  documents: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
});

const mounted: TestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  act(() => {
    while (mounted.length > 0) mounted.pop()?.unmount();
  });
});

beforeEach(() => {
  for (const value of Object.values(mockApi)) {
    if (typeof value === 'function' && 'mockReset' in value) value.mockReset();
  }
  mockApi.getInstrumentCatalogue.mockResolvedValue([]);
  mockApi.getInstrumentAdministrations.mockResolvedValue([]);
});

const allText = (node: ReactTestInstance | string | number | null): string => {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const children = Array.isArray(node.children) ? node.children : [node.children];
  return children.map((child) => allText(child as ReactTestInstance | string | null)).join('');
};

/** The whole 日常记录 form as the patient reads it. */
const screenText = async (currentStatus: Record<string, unknown>) => {
  mockApi.getMyPatientProfile.mockResolvedValue(makeProfile(currentStatus));
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<DataEntryScreen />);
  });
  mounted.push(tree);
  return allText(tree.root);
};

describe('上楼记录的提示只复述患者自己填过的答案', () => {
  it('对填了「无法行走」的人，不说他填过「需要辅助」，也不问「如果今天能走」', async () => {
    const text = await screenText({ independentlyAmbulatory: 'unable', assistiveDevices: [] });

    expect(text).toContain('你在档案里填过无法行走');
    expect(text).not.toContain('你在档案里填过行动需要辅助');
    expect(text).not.toContain('如果今天能走');
    // The point of the branch survives: the button is a record, not a
    // blank, and the seconds field is still there if today was different.
    expect(text).toContain('今天做不了 / 不适用');
    expect(text).toContain('要是今天确实上了台阶，也可以直接填秒数');
  });

  it('对填了「需要辅助」的人，照旧', async () => {
    const text = await screenText({ independentlyAmbulatory: 'assisted', assistiveDevices: [] });

    expect(text).toContain('你在档案里填过行动需要辅助');
    expect(text).toContain('如果今天能走');
    expect(text).not.toContain('你在档案里填过无法行走');
  });

  it('只填了轮椅、行走答的是「可独立行走」时，说的是轮椅，不是一个他没给过的行走答案', async () => {
    const text = await screenText({
      independentlyAmbulatory: 'independent',
      assistiveDevices: ['轮椅'],
    });

    expect(text).toContain('你在档案里填过用轮椅');
    expect(text).not.toContain('你在档案里填过行动需要辅助');
    expect(text).not.toContain('你在档案里填过无法行走');
  });

  it('什么都没填的人拿到的是通用说明，不是任何一句「你填过」', async () => {
    const text = await screenText({});

    expect(text).toContain('请填写这次完成 10 级台阶所用的秒数');
    expect(text).not.toContain('你在档案里填过');
  });
});
