/**
 * 在家计时测试, as the patient meets it.
 *
 * The four behaviours worth a test are the four that are invisible in
 * a screenshot: the safety question actually gates the standing tests,
 * the elapsed time is reconstructed from wall-clock stamps rather than
 * from ticks, a run the app itself distrusts cannot be graded
 * 按方案完成, and what reaches the API carries the grade.
 */

import { StyleSheet, TextInput } from 'react-native';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';

// `mock`-prefixed so the factory below may close over them: jest hoists
// jest.mock above the declarations and refuses any other out-of-scope
// name.
const mockAddFunctionTest = jest.fn().mockResolvedValue({ id: 'ft-1' });
const mockCreateSubmission = jest.fn().mockResolvedValue({ id: 'sub-1' });

jest.mock('../../../lib/api', () => ({
  __esModule: true,
  addFunctionTest: (...args: unknown[]) => mockAddFunctionTest(...args),
  createSubmission: (...args: unknown[]) => mockCreateSubmission(...args),
}));

const addFunctionTest = mockAddFunctionTest;
const createSubmission = mockCreateSubmission;

jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

/**
 * The device's store, in memory.
 *
 * A real round trip rather than a spy: the unfinished-save record is
 * written as JSON and read back by a parser that rejects shapes it does
 * not recognise, so a test that only checked「setSessionValue was
 * called」would pass over a record that can never be read again.
 * `mock`-prefixed for the same hoisting reason as the API mocks above.
 */
const mockSessionStore = new Map<string, string>();

jest.mock('../../../lib/session-storage', () => ({
  __esModule: true,
  // Reads the map when the promise settles, not when the call is made.
  // Neither AsyncStorage nor SecureStore promises to capture the value
  // at call time, and the difference is the whole point of the
  // hydration gate: a mount that writes its empty map before the read
  // has settled is a mount that erases the record it was about to
  // recover. Capturing at call time would make that gate untestable and
  // therefore deletable.
  getSessionValue: (key: string) => Promise.resolve().then(() => mockSessionStore.get(key) ?? null),
  setSessionValue: (key: string, value: string | null) => {
    if (value === null) mockSessionStore.delete(key);
    else mockSessionStore.set(key, value);
    return Promise.resolve();
  },
  removeSessionValue: (key: string) => {
    mockSessionStore.delete(key);
    return Promise.resolve();
  },
}));

/** Every AppState listener the component registered, so a test can play
 *  the part of the OS backgrounding the webview. */
const appStateHandlers: Array<(state: string) => void> = [];

jest.mock('react-native/Libraries/AppState/AppState', () => ({
  __esModule: true,
  default: {
    currentState: 'active',
    addEventListener: (_event: string, handler: (state: string) => void) => {
      appStateHandlers.push(handler);
      return {
        remove: () => {
          const index = appStateHandlers.indexOf(handler);
          if (index >= 0) appStateHandlers.splice(index, 1);
        },
      };
    },
  },
}));

import TimedTestForm from '../TimedTestForm';
import { DATA_ENTRY_DRAFT_KEYS, PATIENT_SCOPED_SECURE_KEYS } from '../../../lib/draft-keys';
import { decodeProtocolField, type PreviousReading } from '../../../lib/timed-test-protocols';

const PENDING_SAVES_KEY = DATA_ENTRY_DRAFT_KEYS.timedPendingSaves;

const mounted: TestRenderer.ReactTestRenderer[] = [];

type Props = Parameters<typeof TimedTestForm>[0];
type Profile = Props['profile'];

const makeProfile = (overrides: Record<string, unknown> = {}): Profile =>
  ({
    followupEvents: [],
    functionTests: [],
    ...overrides,
  }) as unknown as Profile;

const render = async (profile: Profile = makeProfile()) => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<TimedTestForm profile={profile} />);
  });
  mounted.push(tree);
  return tree;
};

afterEach(() => {
  act(() => {
    while (mounted.length > 0) mounted.pop()?.unmount();
  });
  jest.clearAllMocks();
  jest.useRealTimers();
  // The store is the device, and every test gets a fresh one. Without
  // this a half-finished save leaks into the next test as a locked row.
  mockSessionStore.clear();
});

const allText = (node: ReactTestInstance | string | number | null): string => {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  const children = Array.isArray(node.children) ? node.children : [node.children];
  return children.map((child) => allText(child as ReactTestInstance | string | null)).join('');
};

/** A touchable the patient can actually hit, found by the label a
 *  screen reader would announce. */
const control = (tree: TestRenderer.ReactTestRenderer, label: string): ReactTestInstance =>
  tree.root.find(
    (node) =>
      typeof node.props?.onPress === 'function' &&
      typeof node.props?.onPressIn === 'function' &&
      node.props?.accessibilityLabel === label,
  );

const maybeControl = (
  tree: TestRenderer.ReactTestRenderer,
  label: string,
): ReactTestInstance | undefined =>
  tree.root.findAll(
    (node) =>
      typeof node.props?.onPress === 'function' &&
      typeof node.props?.onPressIn === 'function' &&
      node.props?.accessibilityLabel === label,
  )[0];

const press = (node: ReactTestInstance) => {
  act(() => {
    node.props.onPress();
  });
};

describe('the companion question comes before anything else', () => {
  it('asks it on mount, every time', async () => {
    const text = allText((await render()).root);
    expect(text).toContain('今天旁边有人吗？');
    // The reason, with its source. Not「为了安全」.
    expect(text).toContain('六倍');
    expect(text).toContain('Horlings');
  });

  it('does not open a standing test before it is answered', async () => {
    const tree = await render();
    press(control(tree, '5 次起坐'));
    // The card stays shut: no protocol section, no timer.
    expect(allText(tree.root)).not.toContain('口令（照着念）');
  });

  it('still opens 握力, which is done sitting down', async () => {
    const tree = await render();
    press(control(tree, '握力（选做）'));
    expect(allText(tree.root)).toContain('用力握');
  });

  it('opens the standing tests once someone is beside them', async () => {
    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '5 次起坐'));
    const text = allText(tree.root);
    expect(text).toContain('口令（照着念）');
    // The verbatim command, and the aid rule with it.
    expect(text).toContain('站起来、坐下，做五次');
    expect(text).toContain('辅具怎么算');
  });

  it('says what someone home alone can still do, rather than just refusing', async () => {
    const tree = await render();
    press(control(tree, '只有我一个人'));
    const text = allText(tree.root);
    expect(text).toContain('握力');
    expect(text).toContain('日常记录');
  });
});

describe('a recent fall closes the longest walk', () => {
  const profileWithFall = () =>
    makeProfile({
      followupEvents: [
        { eventType: 'fall', occurredAt: new Date().toISOString().slice(0, 10), severity: 'mild' },
      ],
    });

  it('withholds the 6-minute walk and says why, in place of the card', async () => {
    const tree = await render(profileWithFall());
    press(control(tree, '有人在旁边'));
    const text = allText(tree.root);
    expect(text).toContain('6 分钟步行今天不提供');
    expect(text).toContain('30 米走廊');
    // Not silently gone: it names the way back.
    expect(text).toContain('康复科医生');
    // And it is not tappable at all.
    expect(maybeControl(tree, '6 分钟步行（有条件时）')).toBeUndefined();
  });

  it('keeps the 2-minute walk, with the fall named on the card', async () => {
    const tree = await render(profileWithFall());
    press(control(tree, '有人在旁边'));
    press(control(tree, '2 分钟步行'));
    expect(allText(tree.root)).toContain('档案里记着');
  });
});

describe('elapsed time is reconstructed from timestamps', () => {
  it('reports the full duration even when no tick ever fired', async () => {
    // This is the WeChat case: the page is backgrounded for the whole
    // test, so the 100 ms interval is throttled to nothing. An
    // accumulating timer reports ~0 here. Nothing below advances jest's
    // timers — only the clock moves.
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000_000);

    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '5 次起坐'));
    press(control(tree, '开始5 次起坐计时'));

    nowSpy.mockReturnValue(1_000_000 + 13_700);
    press(control(tree, '停止计时'));

    expect(allText(tree.root)).toContain('本次用时 13.7 秒');
    nowSpy.mockRestore();
  });

  it('sends the reconstructed seconds, not a tick count', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(2_000_000);

    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '5 次起坐'));
    press(control(tree, '开始5 次起坐计时'));
    nowSpy.mockReturnValue(2_000_000 + 21_400);
    press(control(tree, '停止计时'));
    press(
      control(tree, '按方案完成：场地、姿势、辅具、口令都和卡片上一样。只有这一档会画进趋势线。'),
    );

    await act(async () => {
      control(tree, '保存5 次起坐').props.onPress();
    });

    expect(addFunctionTest).toHaveBeenCalledTimes(1);
    const payload = addFunctionTest.mock.calls[0][0];
    expect(payload.measuredValue).toBe(21.4);
    expect(payload.testType).toBe('sit_to_stand');
    expect(payload.unit).toBe('sec');
    expect(decodeProtocolField(payload.protocol)).toEqual({
      testId: 'sit_to_stand_5x',
      grade: 'per_protocol',
    });
    expect(payload.submissionId).toBe('sub-1');
    nowSpy.mockRestore();
  });

  it('refuses to save a run the app itself distrusts', async () => {
    // Started the timer, phone locked, opened the app again after
    // dinner. Without the guard this offers to save 「1847.3 秒」 as a
    // five-times sit-to-stand.
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(3_000_000);

    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '5 次起坐'));
    press(control(tree, '开始5 次起坐计时'));
    nowSpy.mockReturnValue(3_000_000 + 45 * 60 * 1000);
    press(control(tree, '停止计时'));

    const text = allText(tree.root);
    expect(text).toContain('忘了按停');
    // 按方案完成 is still on screen — the patient must be able to see
    // what they cannot have and why — but pressing it does nothing.
    press(
      control(tree, '按方案完成：场地、姿势、辅具、口令都和卡片上一样。只有这一档会画进趋势线。'),
    );
    await act(async () => {
      control(tree, '保存5 次起坐').props.onPress();
    });
    expect(addFunctionTest).not.toHaveBeenCalled();
    nowSpy.mockRestore();
  });
});

describe('a countdown that expired while the page was hidden', () => {
  it('clamps to the exact window rather than to the moment the patient came back', async () => {
    // WeChat suspended the page three seconds into a 30-second sit-to-
    // stand and gave it back 45 minutes later. Clamping to「now」 would
    // record a 45-minute run and then flag it as a forgotten stop —
    // absurd advice for a test that ends itself.
    jest.useFakeTimers();
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(4_000_000);

    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '30 秒坐站'));
    press(control(tree, '开始30 秒坐站计时'));

    nowSpy.mockReturnValue(4_000_000 + 45 * 60 * 1000);
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    const text = allText(tree.root);
    expect(text).toContain('计时结束');
    expect(text).not.toContain('忘了按停');
    nowSpy.mockRestore();
  });

  it('refuses the 按方案完成 grade, because nobody heard the end', async () => {
    // The interruption is recorded on the run at the moment it happens;
    // by the time the patient is looking at the screen again there is no
    // evidence left that it occurred.
    jest.useFakeTimers();
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(5_000_000);

    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '30 秒坐站'));
    press(control(tree, '开始30 秒坐站计时'));

    act(() => {
      appStateHandlers.forEach((handler) => handler('background'));
    });
    nowSpy.mockReturnValue(5_000_000 + 40_000);
    await act(async () => {
      jest.advanceTimersByTime(200);
    });

    expect(allText(tree.root)).toContain('你听不到结束的提示音');
    nowSpy.mockRestore();
  });
});

describe('the stop target', () => {
  it('is full width and much larger than the platform minimum', async () => {
    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '5 次起坐'));
    press(control(tree, '开始5 次起坐计时'));

    const stop = control(tree, '停止计时');
    // StyleSheet.create hands back registered ids, not objects, so the
    // style has to be flattened before anything can be read off it.
    const flattened = (StyleSheet.flatten(stop.props.style) ?? {}) as Record<string, unknown>;

    // The patient is out of breath, braced on furniture, and not
    // looking at the screen.
    expect(flattened.width).toBe('100%');
    expect(Number(flattened.minHeight)).toBeGreaterThanOrEqual(120);
  });

  it('is the only control in its row while the timer runs', async () => {
    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '5 次起坐'));
    press(control(tree, '开始5 次起坐计时'));
    // No 重新计一次 and no 开始 beside it to hit by mistake.
    expect(maybeControl(tree, '重新计时')).toBeUndefined();
    expect(maybeControl(tree, '开始5 次起坐计时')).toBeUndefined();
  });
});

describe('the submission id is checked, not asserted', () => {
  it('refuses to post a measurement when the id did not come back', async () => {
    // apiRequest's type parameter is an unchecked assertion and it does
    // not unwrap the `data` envelope, so `submission.id` being a string
    // is a hope until something looks. Posting with an undefined
    // submissionId would silently orphan the row from the visit it
    // belongs to, and nothing on screen would say so.
    createSubmission.mockResolvedValueOnce({ data: { id: 'sub-9' } });

    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '30 秒坐站'));
    press(control(tree, '今天做不了这一项'));
    press(control(tree, '自由记录：没照卡片做，随手记一个。同样是你的数据，同样不进趋势线。'));
    await act(async () => {
      control(tree, '保存30 秒坐站').props.onPress();
    });

    expect(addFunctionTest).not.toHaveBeenCalled();
    expect(allText(tree.root)).toContain('没有返回这次记录的编号');
  });
});

describe('今天做不了 is a record, not a blank', () => {
  it('saves a row with no value and no unit', async () => {
    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '30 秒坐站'));
    press(control(tree, '今天做不了这一项'));
    press(
      control(
        tree,
        '条件不完整：做了，但有地方不一样（比如距离不够、用手撑了、中途停了）。会存下来，也会显示，但不会和别的次数放在一条趋势线上比。',
      ),
    );
    await act(async () => {
      control(tree, '保存30 秒坐站').props.onPress();
    });

    expect(addFunctionTest).toHaveBeenCalledTimes(1);
    const payload = addFunctionTest.mock.calls[0][0];
    expect(payload.notApplicable).toBe(true);
    expect(payload.measuredValue).toBeNull();
    expect(payload.unit).toBeNull();
  });
});

describe('四项抗重力', () => {
  it('writes one row per item, each carrying its own anchor sentence', async () => {
    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '四项抗重力'));
    press(control(tree, '坐 → 站：不用手撑、不用扶，一次就完成'));
    press(control(tree, '下一级台阶：今天做不了'));
    press(
      control(tree, '按方案完成：场地、姿势、辅具、口令都和卡片上一样。只有这一档会画进趋势线。'),
    );

    await act(async () => {
      control(tree, '保存四项抗重力').props.onPress();
    });

    expect(addFunctionTest).toHaveBeenCalledTimes(2);
    const notes = addFunctionTest.mock.calls.map((call) => call[0].notes as string);
    expect(notes.some((note) => note.includes('坐 → 站') && note.includes('不用手撑'))).toBe(true);
    expect(notes.some((note) => note.includes('下一级') && note.includes('今天做不了'))).toBe(true);
    // A summed 0-8 score would be a scale nobody published.
    for (const call of addFunctionTest.mock.calls) {
      expect([0, 1, 2]).toContain(call[0].measuredValue);
    }
  });

  it('says on screen that the three bands are ours, not the guideline’s', async () => {
    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '四项抗重力'));
    const text = allText(tree.root);
    expect(text).toContain('指南只给了四个动作、没有给评分标准');
    expect(text).toContain('Rijken');
  });
});

describe('the previous reading', () => {
  it('shows last time’s venue and aid so the conditions can be reproduced', async () => {
    const profile = makeProfile({
      functionTests: [
        {
          testType: 'ten_meter_walk',
          measuredValue: 15.8,
          protocol: 'tt1|ten_meter_walk|per_protocol|10 米步行·按方案完成',
          deviceUsed: '手杖',
          notes: '测量地点：小区连廊',
          performedAt: '2026-06-01T02:00:00.000Z',
        },
      ],
    });
    const tree = await render(profile);
    press(control(tree, '有人在旁边'));
    press(control(tree, '10 米步行'));
    const text = allText(tree.root);
    expect(text).toContain('2026-06-01');
    expect(text).toContain('小区连廊');
    expect(text).toContain('手杖');
  });

  it('warns when the aid changed, because that breaks the comparison', async () => {
    const profile = makeProfile({
      functionTests: [
        {
          testType: 'ten_meter_walk',
          measuredValue: 15.8,
          protocol: 'tt1|ten_meter_walk|per_protocol|10 米步行·按方案完成',
          deviceUsed: '手杖',
          notes: null,
          performedAt: '2026-06-01T02:00:00.000Z',
        },
      ],
    });
    const tree = await render(profile);
    press(control(tree, '有人在旁边'));
    press(control(tree, '10 米步行'));
    press(control(tree, '什么都没用'));
    expect(allText(tree.root)).toContain('两次条件不一样');
  });
});

describe('the 10 metre measuring card', () => {
  it('rides with the walk, and refuses to let 8 metres be called 10', async () => {
    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '10 米步行'));
    const text = allText(tree.root);
    expect(text).toContain('怎么量出 10 米');
    expect(text).toContain('A4');
    expect(text).toContain('别把 8 米当成 10 米填');
  });
});

describe('a half-finished 四项抗重力 save', () => {
  const PER_PROTOCOL = '按方案完成：场地、姿势、辅具、口令都和卡片上一样。只有这一档会画进趋势线。';

  const answerAllFour = (tree: TestRenderer.ReactTestRenderer) => {
    press(control(tree, '有人在旁边'));
    press(control(tree, '四项抗重力'));
    press(control(tree, '坐 → 站：不用手撑、不用扶，一次就完成'));
    press(control(tree, '站 → 坐：不用手撑、不用扶，一次就完成'));
    press(control(tree, '上一级台阶：要用手撑腿、扶扶手或者借一下惯性才能完成'));
    press(control(tree, '下一级台阶：今天做不了'));
    press(control(tree, PER_PROTOCOL));
  };

  /** One item's POST drops on the way out; the other three commit. */
  const dropOneItem = () => {
    addFunctionTest.mockImplementation((payload: { notes?: unknown }) =>
      typeof payload?.notes === 'string' && payload.notes.includes('下一级台阶')
        ? Promise.reject(new Error('网络不稳定，这次没有传上去。'))
        : Promise.resolve({ id: 'ft' }),
    );
  };

  afterEach(() => {
    // clearAllMocks keeps implementations, so a rejection installed here
    // would follow the suite into every test after it.
    addFunctionTest.mockReset().mockResolvedValue({ id: 'ft-1' });
    createSubmission.mockReset().mockResolvedValue({ id: 'sub-1' });
  });

  it('says which items landed, and re-sends only the one that did not', async () => {
    // Four separate POSTs on a weak connection. Promise.all would reject
    // on the first failure while its siblings kept going and committed,
    // so the patient would be told the whole save failed over rows that
    // are already stored — and addFunctionTest is a bare INSERT with no
    // unique constraint, so pressing 保存 again would store them twice.
    dropOneItem();

    const tree = await render();
    answerAllFour(tree);
    await act(async () => {
      control(tree, '保存四项抗重力').props.onPress();
    });

    expect(addFunctionTest).toHaveBeenCalledTimes(4);
    expect(allText(tree.root)).toContain('下一级台阶 没存上，其余 3 项已经存上了');

    addFunctionTest.mockResolvedValue({ id: 'ft-4' });
    await act(async () => {
      control(tree, '保存四项抗重力').props.onPress();
    });

    // One more POST, not four.
    expect(addFunctionTest).toHaveBeenCalledTimes(5);
    const resent = addFunctionTest.mock.calls[4][0];
    expect(resent.notes).toContain('下一级台阶');
    // And it joins the visit the first attempt opened, rather than
    // hanging off a second one created minutes later.
    expect(createSubmission).toHaveBeenCalledTimes(1);
    expect(resent.submissionId).toBe('sub-1');
    expect(allText(tree.root)).toContain('已保存四项抗重力');
  });

  it('locks the items already stored, so the screen agrees with the record', async () => {
    dropOneItem();

    const tree = await render();
    answerAllFour(tree);
    await act(async () => {
      control(tree, '保存四项抗重力').props.onPress();
    });

    // Editable answers for rows the retry will never send again would be
    // a screen that disagrees with what is stored.
    expect(control(tree, '坐 → 站：不用手撑、不用扶，一次就完成').props.disabled).toBe(true);
    expect(control(tree, '下一级台阶：今天做不了').props.disabled).toBe(false);
    expect(allText(tree.root)).toContain('这一项刚才已经存上了');
  });

  /** Answer the four, save, and have 下一级台阶 drop. */
  const saveWithOneDropped = async (tree: TestRenderer.ReactTestRenderer) => {
    dropOneItem();
    answerAllFour(tree);
    await act(async () => {
      control(tree, '保存四项抗重力').props.onPress();
    });
    expect(addFunctionTest).toHaveBeenCalledTimes(4);
  };

  it('still knows what landed after the card is closed and reopened', async () => {
    // The locked rows leave no way to change an answer, so closing the
    // card is the escape the patient can see. If that threw away which
    // items are already on the server, reopening would re-arm the exact
    // double post the retry exists to prevent — and `addFunctionTest` is
    // a bare INSERT, so the duplicate rows would be permanent.
    const tree = await render();
    await saveWithOneDropped(tree);

    press(control(tree, '四项抗重力')); // collapse
    press(control(tree, '四项抗重力')); // and back

    expect(allText(tree.root)).toContain('这一项刚才已经存上了');
    const landedRow = control(tree, '坐 → 站：不用手撑、不用扶，一次就完成');
    expect(landedRow.props.disabled).toBe(true);
    // Showing the answer it landed with, not a blank row calling itself
    // stored.
    expect(landedRow.props.accessibilityState.selected).toBe(true);

    addFunctionTest.mockResolvedValue({ id: 'ft-4' });
    press(control(tree, '下一级台阶：今天做不了'));
    // The grade came back with the rest of the session — not re-picked
    // here, because the row that is about to be sent has to describe the
    // same conditions as the three already stored.
    await act(async () => {
      control(tree, '保存四项抗重力').props.onPress();
    });

    expect(addFunctionTest).toHaveBeenCalledTimes(5);
    const resent = addFunctionTest.mock.calls[4][0];
    expect(resent.notes).toContain('下一级台阶');
    expect(decodeProtocolField(resent.protocol)?.grade).toBe('per_protocol');
    // One visit, not two on the same day.
    expect(createSubmission).toHaveBeenCalledTimes(1);
    expect(resent.submissionId).toBe('sub-1');
    expect(allText(tree.root)).toContain('已保存四项抗重力');
  });

  it('survives the whole component being unmounted, not just the card closing', async () => {
    // Three separate gestures unmount this component, and they are the
    // three ways out of a card that will not let you change your
    // answers: the mode picker (日常记录 and back), 返回 / the phone's
    // back gesture, and a WeChat X5 reload. Nothing about them is
    // distinguishable from here — they all end in a fresh mount with an
    // empty memory — so one test covers all three, and it passes NOTHING
    // between the two mounts except the device's store.
    const tree = await render();
    await saveWithOneDropped(tree);

    act(() => {
      tree.unmount();
      mounted.pop();
    });

    const again = await render();
    press(control(again, '有人在旁边'));
    press(control(again, '四项抗重力'));
    expect(allText(again.root)).toContain('这一项刚才已经存上了');
    const landedRow = control(again, '坐 → 站：不用手撑、不用扶，一次就完成');
    expect(landedRow.props.disabled).toBe(true);
    expect(landedRow.props.accessibilityState.selected).toBe(true);

    addFunctionTest.mockResolvedValue({ id: 'ft-4' });
    press(control(again, '下一级台阶：今天做不了'));
    await act(async () => {
      control(again, '保存四项抗重力').props.onPress();
    });

    // One POST on the second visit, not four, and no second visit id.
    expect(addFunctionTest).toHaveBeenCalledTimes(5);
    expect(createSubmission).toHaveBeenCalledTimes(1);
    expect(addFunctionTest.mock.calls[4][0].submissionId).toBe('sub-1');
  });

  it('writes the record to a key a sign-out sweeps', async () => {
    // Asserted against the key the component actually wrote, not against
    // the constant it was supposed to use. Surviving navigation is only
    // safe because the same persistence is inside the logout sweep: this
    // record names one person's visit id and the answers they gave, and
    // FSHD is autosomal dominant, so several affected members of one
    // family on one phone is the ordinary case for this cohort.
    const tree = await render();
    await saveWithOneDropped(tree);

    const written = [...mockSessionStore.keys()];
    expect(written).toHaveLength(1);
    for (const key of written) {
      expect(PATIENT_SCOPED_SECURE_KEYS).toContain(key);
    }
  });

  it('keeps a visit id that has no landed items across an unmount', async () => {
    // The non-三项 path writes a record with an empty `savedItems`: the
    // visit was opened, the single row failed. Nothing is locked on the
    // reopened card, so this is invisible on screen — the only evidence
    // is that the retry does not open a second visit for the same test.
    createSubmission.mockResolvedValue({ id: 'sub-grip' });
    addFunctionTest.mockRejectedValue(new Error('网络不稳定，这次没有传上去。'));

    const tree = await render();
    press(control(tree, '握力（选做）'));
    press(control(tree, '自由记录：没照卡片做，随手记一个。同样是你的数据，同样不进趋势线。'));
    act(() => {
      // The reading, then the venue note — this is the first TextInput.
      tree.root.findAllByType(TextInput)[0].props.onChangeText('28');
    });
    await act(async () => {
      control(tree, '保存握力（选做）').props.onPress();
    });
    expect(createSubmission).toHaveBeenCalledTimes(1);

    act(() => {
      tree.unmount();
      mounted.pop();
    });

    addFunctionTest.mockReset().mockResolvedValue({ id: 'ft-grip' });
    const again = await render();
    press(control(again, '握力（选做）'));
    // The conditions came back with the visit, so the row that is about
    // to be sent describes the session the visit was opened for.
    act(() => {
      again.root.findAllByType(TextInput)[0].props.onChangeText('28');
    });
    await act(async () => {
      control(again, '保存握力（选做）').props.onPress();
    });

    expect(addFunctionTest).toHaveBeenCalledTimes(1);
    expect(addFunctionTest.mock.calls[0][0].submissionId).toBe('sub-grip');
    expect(createSubmission).toHaveBeenCalledTimes(1);
  });

  it('forgets the record once the last item lands, so the next session is its own visit', async () => {
    // Left behind, the record would lock the next session's rows against
    // a visit that is already closed and restore that session's grade,
    // aids and venue over today's — the failure the clear on the success
    // path exists to prevent.
    const tree = await render();
    await saveWithOneDropped(tree);

    addFunctionTest.mockResolvedValue({ id: 'ft-4' });
    press(control(tree, '下一级台阶：今天做不了'));
    await act(async () => {
      control(tree, '保存四项抗重力').props.onPress();
    });
    expect(allText(tree.root)).toContain('已保存四项抗重力');
    expect(mockSessionStore.get(PENDING_SAVES_KEY)).toBeUndefined();

    // Tomorrow, same card.
    createSubmission.mockResolvedValue({ id: 'sub-2' });
    press(control(tree, '四项抗重力'));
    const text = allText(tree.root);
    expect(text).not.toContain('这一项刚才已经存上了');
    expect(control(tree, '坐 → 站：不用手撑、不用扶，一次就完成').props.disabled).toBe(false);

    press(control(tree, '坐 → 站：不用手撑、不用扶，一次就完成'));
    press(control(tree, PER_PROTOCOL));
    await act(async () => {
      control(tree, '保存四项抗重力').props.onPress();
    });

    expect(createSubmission).toHaveBeenCalledTimes(2);
    expect(addFunctionTest).toHaveBeenCalledTimes(6);
    expect(addFunctionTest.mock.calls[5][0].submissionId).toBe('sub-2');
  });

  it('refuses to print 已保存 when the reopened card has nothing new to send', async () => {
    // The reopened card shows the three landed answers again, so「4 项里
    //至少选一项」is satisfied by rows that are already stored. Saving
    // there would send nothing and still report success over a record
    // that is still missing 下一级台阶.
    const tree = await render();
    await saveWithOneDropped(tree);

    press(control(tree, '四项抗重力'));
    press(control(tree, '四项抗重力'));
    await act(async () => {
      control(tree, '保存四项抗重力').props.onPress();
    });

    expect(addFunctionTest).toHaveBeenCalledTimes(4);
    const text = allText(tree.root);
    expect(text).toContain('其中 3 项刚才已经存上了');
    expect(text).toContain('还有 1 项没选答案');
    expect(text).not.toContain('已保存四项抗重力');
  });

  it('counts the landed and the outstanding rather than assuming three and one', async () => {
    // One item landed, three did not. 「剩下的那一项」 was true for the
    // case above and a fabricated count for this one, which is the same
    // defect as any other number the app states without having.
    addFunctionTest.mockImplementation((payload: { notes?: unknown }) =>
      typeof payload?.notes === 'string' && payload.notes.includes('坐 → 站')
        ? Promise.resolve({ id: 'ft' })
        : Promise.reject(new Error('网络不稳定，这次没有传上去。')),
    );

    const tree = await render();
    answerAllFour(tree);
    await act(async () => {
      control(tree, '保存四项抗重力').props.onPress();
    });
    expect(allText(tree.root)).toContain('其余 1 项已经存上了');

    press(control(tree, '四项抗重力'));
    press(control(tree, '四项抗重力'));
    await act(async () => {
      control(tree, '保存四项抗重力').props.onPress();
    });

    const text = allText(tree.root);
    expect(text).toContain('其中 1 项刚才已经存上了');
    expect(text).toContain('还有 3 项没选答案');
    expect(text).not.toContain('剩下的那一项');
  });

  /** What the store holds after a half-finished save, with one field
   *  replaced by something this build cannot make sense of. */
  const storeRecord = (entry: Record<string, unknown>) => {
    mockSessionStore.set(PENDING_SAVES_KEY, JSON.stringify({ anti_gravity_four: entry }));
  };

  const validStoredEntry = {
    submissionId: 'sub-old',
    savedItems: { sit_to_stand: 2 },
    grade: 'per_protocol',
    aidKeys: ['cane'],
    venueNote: '家里客厅',
  };

  const unreadableRecords: Array<[string, Record<string, unknown>]> = [
    ['a grade this build no longer defines', { ...validStoredEntry, grade: 'roughly_ok' }],
    ['no grade at all', { ...validStoredEntry, grade: undefined }],
    ['no visit id', { ...validStoredEntry, submissionId: '' }],
    ['a visit id that is not a string', { ...validStoredEntry, submissionId: 7 }],
  ];

  it.each(unreadableRecords)('drops a stored record with %s', async (_label, entry) => {
    // The record is replayed into buildFunctionTestPayload and into the
    // disabled state of the answer rows, so a shape that survived an app
    // upgrade cannot be trusted the way an object this session built
    // can. Dropping it costs a duplicate row; keeping it would post a
    // grade the server does not know, or lock a row against a visit that
    // cannot be named.
    storeRecord(entry);

    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '四项抗重力'));
    expect(allText(tree.root)).not.toContain('这一项刚才已经存上了');
    expect(control(tree, '坐 → 站：不用手撑、不用扶，一次就完成').props.disabled).toBe(false);
  });

  it('drops only the items it cannot read, and keeps the visit', async () => {
    // A junk entry inside `savedItems` must not cost the whole record:
    // the visit id and the items that ARE readable are what stop the
    // retry from opening a second visit and re-posting stored rows.
    storeRecord({
      ...validStoredEntry,
      savedItems: { sit_to_stand: 2, not_an_item: 1, step_up: 99, stand_to_sit: 'yes' },
    });

    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '四项抗重力'));

    const landedRow = control(tree, '坐 → 站：不用手撑、不用扶，一次就完成');
    expect(landedRow.props.disabled).toBe(true);
    expect(landedRow.props.accessibilityState.selected).toBe(true);
    // 99 is not one of the three states and「站 → 坐: 'yes'」is not a
    // number, so neither locks a row.
    expect(control(tree, '上一级台阶：今天做不了').props.disabled).toBe(false);
    expect(control(tree, '站 → 坐：今天做不了').props.disabled).toBe(false);

    press(control(tree, '站 → 坐：今天做不了'));
    press(control(tree, '上一级台阶：今天做不了'));
    press(control(tree, '下一级台阶：今天做不了'));
    await act(async () => {
      control(tree, '保存四项抗重力').props.onPress();
    });

    // Three POSTs — everything but the one item that was readable — all
    // on the visit the first attempt opened.
    expect(addFunctionTest).toHaveBeenCalledTimes(3);
    expect(createSubmission).not.toHaveBeenCalled();
    for (const call of addFunctionTest.mock.calls) {
      expect(call[0].submissionId).toBe('sub-old');
    }
  });
});

describe('a control that is going to ignore the press does not answer it', () => {
  // react-native-web's TouchableOpacity reads `props.disabled` and
  // ignores `aria-disabled`, and the web export is the shipping
  // platform. With the aria attribute alone the control still scales and
  // brightens under the thumb — feedback the patient reads as「按上了」
  // for a press the handler is about to drop.
  it('marks the blocked 按方案完成 row disabled, not merely aria-disabled', async () => {
    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(4_000_000);

    const tree = await render();
    press(control(tree, '有人在旁边'));
    press(control(tree, '5 次起坐'));
    press(control(tree, '开始5 次起坐计时'));
    nowSpy.mockReturnValue(4_000_000 + 45 * 60 * 1000);
    press(control(tree, '停止计时'));

    const blocked = control(
      tree,
      '按方案完成：场地、姿势、辅具、口令都和卡片上一样。只有这一档会画进趋势线。',
    );
    expect(blocked.props.disabled).toBe(true);
    expect(blocked.props['aria-disabled']).toBe(true);
    // The grades that do work are untouched.
    expect(
      control(tree, '自由记录：没照卡片做，随手记一个。同样是你的数据，同样不进趋势线。').props
        .disabled,
    ).toBe(false);
    nowSpy.mockRestore();
  });

  it('marks a test still waiting on the companion answer disabled', async () => {
    const tree = await render();
    expect(control(tree, '30 秒坐站').props.disabled).toBe(true);
    press(control(tree, '有人在旁边'));
    expect(control(tree, '30 秒坐站').props.disabled).toBe(false);
  });
});

// Type-only usage, so the import earns its place and a rename of the
// exported shape breaks here rather than silently at a call site.
const _previousReadingShape: PreviousReading | null = null;
void _previousReadingShape;
