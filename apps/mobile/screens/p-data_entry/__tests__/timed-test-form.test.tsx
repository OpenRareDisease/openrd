/**
 * 在家计时测试, as the patient meets it.
 *
 * The four behaviours worth a test are the four that are invisible in
 * a screenshot: the safety question actually gates the standing tests,
 * the elapsed time is reconstructed from wall-clock stamps rather than
 * from ticks, a run the app itself distrusts cannot be graded
 * 按方案完成, and what reaches the API carries the grade.
 */

import { StyleSheet } from 'react-native';
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
import { decodeProtocolField, type PreviousReading } from '../../../lib/timed-test-protocols';

const mounted: TestRenderer.ReactTestRenderer[] = [];

type Profile = Parameters<typeof TimedTestForm>[0]['profile'];

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

// Type-only usage, so the import earns its place and a rename of the
// exported shape breaks here rather than silently at a call site.
const _previousReadingShape: PreviousReading | null = null;
void _previousReadingShape;
