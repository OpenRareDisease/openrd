/**
 * 我的随访计划 screen — the two failures that would matter here.
 *
 * 1. Rendering the guideline with no record behind it. Six of the
 *    twelve rows are unconditional, so a screen that fell back to
 *    「show the guideline anyway」 when the fetch failed would look
 *    complete and be wrong on exactly the rows that were supposed to
 *    be about this patient. The error state must own the page.
 *
 * 2. Losing the recommendation strength. Level B and Level C are
 *    different instructions (AAN's own key: 「most patients」 vs
 *    「some patients」), and the row this page could most easily
 *    flatten upward is elective shoulder surgery.
 */

import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('../../../lib/api', () => {
  class ApiError extends Error {
    status?: number;
    data?: unknown;
  }
  return {
    __esModule: true,
    ApiError,
    getClinicalPassportSummary: jest.fn(),
    getMyPatientProfile: jest.fn(),
  };
});

// `mock`-prefixed so jest's out-of-scope guard lets the factory close
// over it.
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('react-native-safe-area-context', () => {
  const ReactLocal = require('react');
  return {
    SafeAreaView: ({ children }: { children: React.ReactNode }) =>
      ReactLocal.createElement('SafeAreaView', null, children),
  };
});

jest.mock('../../common/ScreenHeader', () => {
  const ReactLocal = require('react');
  return {
    __esModule: true,
    default: () => ReactLocal.createElement('ScreenHeader', null),
  };
});

// Kept pressable: the anesthesia-card link is the one control on this
// page, and the test drives it rather than reaching into state.
jest.mock('../../common/Button', () => {
  const ReactLocal = require('react');
  const { Text: RNText, TouchableOpacity } = require('react-native');
  return {
    __esModule: true,
    default: ({ label, onPress }: Record<string, never>) =>
      ReactLocal.createElement(
        TouchableOpacity,
        { onPress, accessibilityRole: 'button', accessibilityLabel: label },
        ReactLocal.createElement(RNText, null, label),
      ),
  };
});

import SurveillanceScreen from '../index';
import { ApiError, getClinicalPassportSummary, getMyPatientProfile } from '../../../lib/api';
import type { ClinicalPassportSummary, PatientProfile } from '../../../lib/api';

const asMock = <T,>(fn: T) => fn as unknown as jest.Mock;

const summary = (): ClinicalPassportSummary =>
  ({
    patientName: '张三',
    diagnosis: { confirmation: 'genetic', d4z4Repeats: '3' },
    monitoring: {
      items: [
        {
          key: 'respiratory',
          available: false,
          state: 'absent',
          summary: '暂无肺功能数据',
          latestDate: null,
        },
        {
          key: 'cardiac',
          available: false,
          state: 'absent',
          summary: '暂无心脏检查数据',
          latestDate: null,
        },
      ],
    },
  }) as unknown as ClinicalPassportSummary;

const profile = (): PatientProfile =>
  ({
    dateOfBirth: '1990-04-01',
    followupEvents: [],
    symptomScores: [],
    medications: [],
  }) as unknown as PatientProfile;

const renderScreen = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<SurveillanceScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
};

const allText = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map((node: ReactTestInstance) =>
      Array.isArray(node.props.children)
        ? node.props.children.filter((child: unknown) => typeof child === 'string').join('')
        : typeof node.props.children === 'string'
          ? node.props.children
          : '',
    )
    .join('\n');

beforeEach(() => {
  jest.clearAllMocks();
  asMock(getClinicalPassportSummary).mockResolvedValue(summary());
  asMock(getMyPatientProfile).mockResolvedValue(profile());
});

describe('随访计划页面', () => {
  it('每条推荐都带着自己的强度，B 和 C 都出现', async () => {
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain('Level B · 中等推荐');
    expect(text).toContain('Level C · 弱推荐');
  });

  it('否定推荐带着自己的标记出现在页面上', async () => {
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain('指南不建议常规做');
    expect(text).toContain('不要为了「增肌力」吃这三类药');
  });

  it('每条都有「和医生确认」，没有任何一条以「安排检查」收尾', async () => {
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain('和医生确认');
    expect(text).not.toContain('安排检查');
    expect(text).not.toContain('立即预约');
  });

  it('术前肺功能这一条给出去麻醉卡的入口', async () => {
    const tree = await renderScreen();
    const link = tree.root.findAll(
      (node: ReactTestInstance) => node.props?.accessibilityLabel === '打开麻醉注意事项卡',
    )[0];
    expect(link).toBeTruthy();
    await act(async () => {
      link.props.onPress();
    });
    expect(mockPush).toHaveBeenCalledWith('/p-clinical_passport');
  });

  it('读不到档案时不退化成一份通用指南', async () => {
    asMock(getClinicalPassportSummary).mockRejectedValue(new ApiError('档案服务没响应'));
    const tree = await renderScreen();
    const text = allText(tree);
    expect(text).toContain('暂时对照不了你的记录');
    // The rows themselves must be gone — a page that still listed
    // 「做一次肺功能基线」 would look like it had checked the record.
    expect(text).not.toContain('做一次肺功能基线');
    expect(text).not.toContain('Level B · 中等推荐');
  });
});
