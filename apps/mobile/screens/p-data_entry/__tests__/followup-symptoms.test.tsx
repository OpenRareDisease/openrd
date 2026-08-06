/**
 * 疼痛 and 疲劳 on the daily form, and 功能分级自评.
 *
 * WHAT WAS WRONG
 * --------------
 * `SYMPTOM_KEYS` on the API has carried `pain` and `fatigue` since the
 * schema was written and `patient_symptom_scores` has always had
 * scale_min / scale_max, but the followup form wrote only
 * `sleep_quality` and the stairs ADL. Production is exactly that shape:
 * a stack of sleep rows and a handful of pain rows, for a disease where
 * pain and fatigue are among the most commonly reported problems. The
 * 2010 ENMC consensus on FSHD standards of care and the Dutch guideline
 * both say to ask at every visit. Nothing on the server needed to
 * change — the form simply never asked.
 *
 * WHAT MUST NOT REGRESS
 * ---------------------
 *  - Asking is not the same as answering. An untouched field writes NO
 *    row: 0 on this scale means「一点都不疼」and posting it on behalf of
 *    a patient who said nothing is a fabricated reading.
 *  - The abstention is still recorded — the submission summary says
 *   「疼痛：本次未评价」so a gap does not read later as「不疼」.
 *  - Nothing about pain or fatigue can block the save. The guideline
 *    asks the form to ask, not to hold the rest of the record hostage.
 */

import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

// The jest.fn()s are built inside the factory rather than referenced
// from an outer const: babel hoists `import` above every `const`, so an
// outer object is still undefined when the factory runs, and spreading
// it yields an api module with none of its functions.
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

const mockNotify = jest.fn();
// Shared instance so a test can assert the gate was consulted before a
// grade was stored — the POST is behind the same sensitiveDataConsent
// middleware as every other write on this screen.
const mockEnsureConsent = jest.fn();
jest.mock('../../common/feedback/AppDialog', () => ({
  useAppDialog: () => ({ notify: mockNotify, confirm: jest.fn() }),
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
      ensureSensitiveDataConsent: mockEnsureConsent,
      gateProps: {},
    }),
  };
});

import DataEntryScreen from '../index';
import * as apiModule from '../../../lib/api';
import type { InstrumentCatalogueEntry } from '../../../lib/api';

const mockApi = apiModule as unknown as Record<string, jest.Mock>;

/** A stand-in for what `/profiles/me/instruments` actually serves. The
 *  wording here is the SERVER's — this bundle carries no copy of it,
 *  which is the property the tests below are really pinning. */
const BROOKE_LEVELS = [
  { value: 1, labelZh: '双臂能沿着完整的圆弧举到头顶碰在一起。', sourceEn: null },
  { value: 2, labelZh: '要先弯起手肘或借助其他部位代偿，才能举过头顶。', sourceEn: null },
  { value: 3, labelZh: '手举不到头顶，但能把一杯约 240 毫升的水端到嘴边。', sourceEn: null },
];

const CATALOGUE: InstrumentCatalogueEntry[] = [
  {
    key: 'brooke_upper_extremity',
    version: 'v1',
    nameZh: 'Brooke 上肢功能分级',
    descriptionZh: '国际通用的上肢功能分级。',
    licenceStatus: 'free_with_attribution',
    sourceCitation: 'Brooke MH, et al. Muscle Nerve. 1981;4(3):186-97.',
    scoreMin: 1,
    scoreMax: 6,
    higherIsWorse: true,
    recallPeriod: 'current',
    adminMinutes: 2,
    limitationsZh: ['这个分级最初是为杜氏肌营养不良设计的，进展慢的类型会长期停在同一等级。'],
    selfReportEvidenceZh: 'Brooke 分级自评与医生评估的一致性为 ICC 0.66（95% CI 0.58-0.72）。',
    items: [
      {
        code: 'brooke_grade',
        version: 'v1',
        promptZh: '请选择最符合你目前上肢/手臂情况的一条',
        levels: BROOKE_LEVELS,
      },
    ],
  },
];

const PROFILE = {
  id: 'p1',
  fullName: '张三',
  measurements: [],
  functionTests: [],
  symptomScores: [],
  dailyImpacts: [],
  followupEvents: [],
  activityLogs: [],
  documents: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mounted: TestRenderer.ReactTestRenderer[] = [];

const render = async () => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<DataEntryScreen />);
  });
  mounted.push(tree);
  return tree;
};

afterEach(() => {
  act(() => {
    while (mounted.length > 0) mounted.pop()?.unmount();
  });
});

beforeEach(() => {
  for (const value of Object.values(mockApi)) {
    if (typeof value === 'function' && 'mockReset' in value) value.mockReset();
  }
  mockNotify.mockClear();
  mockEnsureConsent.mockClear();
  mockEnsureConsent.mockResolvedValue(true);
  for (const key of [
    'addActivityLog',
    'addDailyImpact',
    'addFunctionTest',
    'addFollowupEvent',
    'addPatientMeasurement',
    'addSymptomScore',
    'recordInstrumentAdministration',
  ]) {
    mockApi[key].mockResolvedValue({});
  }
  mockApi.getMyPatientProfile.mockResolvedValue(PROFILE);
  mockApi.getInstrumentCatalogue.mockResolvedValue(CATALOGUE);
  mockApi.getInstrumentAdministrations.mockResolvedValue([]);
  mockApi.createSubmission.mockResolvedValue({ id: 'sub-1' });
});

const allText = (node: ReactTestInstance | string | number | null): string => {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const children = Array.isArray(node.children) ? node.children : [node.children];
  return children.map((child) => allText(child as ReactTestInstance | string | null)).join('');
};

const byLabel = (tree: TestRenderer.ReactTestRenderer, label: string): ReactTestInstance => {
  const match = tree.root
    .findAll((node) => typeof node.props?.onPress === 'function', { deep: false })
    .find((node) => node.props?.accessibilityLabel === label);
  if (!match) throw new Error(`no pressable labelled ${label}`);
  return match;
};

const press = (node: ReactTestInstance) => {
  act(() => {
    node.props.onPress();
  });
};

/** Fill the stair field so the form is submittable, then submit. */
const submitFollowup = async (tree: TestRenderer.ReactTestRenderer) => {
  press(byLabel(tree, '今天做不了 10 级台阶，本次不填用时'));
  const save = tree.root
    .findAll((node) => typeof node.props?.onPress === 'function', { deep: false })
    .find((node) => allText(node).includes('完成今日记录'));
  await act(async () => {
    save!.props.onPress();
  });
};

const symptomPosts = () =>
  mockApi.addSymptomScore.mock.calls.map(([payload]) => payload as Record<string, unknown>);

describe('the daily form asks about pain and fatigue', () => {
  it('renders both questions with the guideline that requires them', async () => {
    const tree = await render();
    const text = allText(tree.root);
    expect(text).toContain('最近一周疼痛程度');
    expect(text).toContain('最近一周疲劳程度');
    expect(text).toContain('ENMC');
  });

  it('prints the direction, because sleep on the same screen runs the other way', async () => {
    const tree = await render();
    const text = allText(tree.root);
    // sleep: 0 是几乎没睡好 (bad); pain: 0 是完全不疼 (good).
    expect(text).toContain('0 表示几乎没睡好');
    expect(text).toContain('0 表示完全不疼');
    expect(text).toContain('0 表示一点都不累');
  });

  it('shows an em dash rather than 0 before either is answered', async () => {
    const tree = await render();
    expect(allText(tree.root)).toContain('还没评价，可以跳过');
  });
});

describe('asking is not answering', () => {
  it('writes no pain or fatigue row when the patient never touched them', async () => {
    const tree = await render();
    await submitFollowup(tree);

    const keys = symptomPosts().map((payload) => payload.symptomKey);
    expect(keys).toContain('sleep_quality');
    expect(keys).not.toContain('pain');
    expect(keys).not.toContain('fatigue');
  });

  it('still records the abstention in the submission summary', async () => {
    const tree = await render();
    await submitFollowup(tree);

    const [summaryPayload] = mockApi.createSubmission.mock.calls[0] as [
      { summary: string; changedSinceLast: boolean },
    ];
    expect(summaryPayload.summary).toContain('疼痛：本次未评价');
    expect(summaryPayload.summary).toContain('疲劳：本次未评价');
  });

  it('does not block the save — the rest of the record still goes through', async () => {
    const tree = await render();
    await submitFollowup(tree);
    expect(mockApi.createSubmission).toHaveBeenCalledTimes(1);
    expect(mockApi.addFunctionTest).toHaveBeenCalledTimes(1);
  });
});

describe('answering writes the row', () => {
  it('posts pain with its scale bounds and its direction note', async () => {
    const tree = await render();
    press(byLabel(tree, '最近一周疼痛程度中等，4 到 6 分'));
    await submitFollowup(tree);

    const pain = symptomPosts().find((payload) => payload.symptomKey === 'pain');
    expect(pain).toMatchObject({
      symptomKey: 'pain',
      score: 5,
      scaleMin: 0,
      scaleMax: 10,
      submissionId: 'sub-1',
    });
    // The direction travels with the row, the way sleep's does — a
    // later reader of the raw table cannot otherwise tell 8 分疼痛 from
    // 8 分睡得好.
    expect(String(pain!.notes)).toContain('0=没有疼痛');
  });

  it('posts fatigue independently of pain', async () => {
    const tree = await render();
    press(byLabel(tree, '最近一周疲劳程度很累，7 到 9 分'));
    await submitFollowup(tree);

    const keys = symptomPosts().map((payload) => payload.symptomKey);
    expect(keys).toContain('fatigue');
    expect(keys).not.toContain('pain');
    const fatigue = symptomPosts().find((payload) => payload.symptomKey === 'fatigue');
    expect(fatigue!.score).toBe(8);
  });

  it('records a real 0 — 「一点都不疼」 is an answer, not a blank', async () => {
    const tree = await render();
    press(byLabel(tree, '最近一周疼痛程度没有，0 到 0 分'));
    await submitFollowup(tree);

    const pain = symptomPosts().find((payload) => payload.symptomKey === 'pain');
    expect(pain).toBeDefined();
    expect(pain!.score).toBe(0);
    const [summaryPayload] = mockApi.createSubmission.mock.calls[0] as [{ summary: string }];
    expect(summaryPayload.summary).toContain('疼痛 0/10');
  });

  it('lets the stepper reach 0 from unanswered in one press', async () => {
    const tree = await render();
    press(byLabel(tree, '最近一周疼痛程度加 1 分'));
    await submitFollowup(tree);
    const pain = symptomPosts().find((payload) => payload.symptomKey === 'pain');
    expect(pain!.score).toBe(0);
  });
});

describe('功能分级自评', () => {
  const openInstrumentMode = async (tree: TestRenderer.ReactTestRenderer) => {
    const row = tree.root
      .findAll((node) => typeof node.props?.onPress === 'function', { deep: false })
      .find((node) => allText(node).includes('功能分级自评'));
    await act(async () => {
      row!.props.onPress();
    });
  };

  const openBrooke = async (tree: TestRenderer.ReactTestRenderer) => {
    await openInstrumentMode(tree);
    press(byLabel(tree, 'Brooke 上肢功能分级'));
  };

  it('renders the scale it fetched, and says nothing has to be attempted now', async () => {
    const tree = await render();
    await openBrooke(tree);
    const text = allText(tree.root);
    expect(mockApi.getInstrumentCatalogue).toHaveBeenCalled();
    // The prompt is the SERVER's wording, not a phrase from this bundle.
    expect(text).toContain('请选择最符合你目前上肢/手臂情况的一条');
    expect(text).toContain('现在不用起身、不用抬手去试');
  });

  it('shows every level as a sentence, never as a bare number', async () => {
    const tree = await render();
    await openBrooke(tree);
    const text = allText(tree.root);
    for (const level of BROOKE_LEVELS) {
      expect(text).toContain(level.labelZh);
    }
  });

  it('prints the scale caveats and the citation with the picker', async () => {
    // The catalogue serves limitationsZh and selfReportEvidenceZh
    // alongside the anchors precisely so a client cannot render one
    // without the other: a Brooke grade that has not moved in three
    // years is a floor effect, not a stable disease.
    const tree = await render();
    await openBrooke(tree);
    const text = allText(tree.root);
    expect(text).toContain('进展慢的类型会长期停在同一等级');
    expect(text).toContain('ICC 0.66');
    expect(text).toContain('Muscle Nerve. 1981');
  });

  it('posts {instrumentKey, responses:[{itemCode, responseValue}]}', async () => {
    const tree = await render();
    await openBrooke(tree);
    press(byLabel(tree, `3 级 · ${BROOKE_LEVELS[2].labelZh}`));

    const save = tree.root
      .findAll((node) => typeof node.props?.onPress === 'function', { deep: false })
      .find((node) => node.props?.accessibilityLabel === '保存Brooke 上肢功能分级');
    await act(async () => {
      save!.props.onPress();
    });

    expect(mockApi.recordInstrumentAdministration).toHaveBeenCalledWith({
      instrumentKey: 'brooke_upper_extremity',
      responses: [{ itemCode: 'brooke_grade', responseValue: 3 }],
      source: 'self',
    });
  });

  it('still saves when the history read fails — 上次 is a nicety, 今天 is the record', async () => {
    mockApi.getInstrumentAdministrations.mockRejectedValue(new Error('404'));
    const tree = await render();
    await openBrooke(tree);
    expect(allText(tree.root)).toContain(BROOKE_LEVELS[0].labelZh);
  });

  it('offers no picker at all when the anchors cannot be fetched', async () => {
    // Without the catalogue there are no sentences, and a column of
    // bare numbers is not something a patient can answer honestly.
    // Saying so is the correct screen; guessing the wording is not.
    mockApi.getInstrumentCatalogue.mockRejectedValue(new Error('读不到'));
    const tree = await render();
    await openInstrumentMode(tree);
    const text = allText(tree.root);
    expect(text).toContain('分级量表暂时读不出来');
    expect(text).not.toContain('请选择最符合你目前上肢/手臂情况的一条');
    for (const level of BROOKE_LEVELS) {
      expect(text).not.toContain(level.labelZh);
    }
  });

  it('asks for sensitive-data consent before storing a grade', async () => {
    const tree = await render();
    await openBrooke(tree);
    press(byLabel(tree, `3 级 · ${BROOKE_LEVELS[2].labelZh}`));
    const save = tree.root
      .findAll((node) => typeof node.props?.onPress === 'function', { deep: false })
      .find((node) => node.props?.accessibilityLabel === '保存Brooke 上肢功能分级');
    await act(async () => {
      save!.props.onPress();
    });
    expect(mockEnsureConsent).toHaveBeenCalled();
  });
});
