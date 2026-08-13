/**
 * 孕期时间线 screen — the failures that would actually hurt someone.
 *
 * 1. A date-keyed line that survives the off switch. The most likely
 *    presser of 关闭并删除预产期 is someone whose pregnancy has just
 *    ended. One press must stop every week number on the same frame,
 *    without a dialog and without waiting on storage.
 * 2. The page charging sensitive personal information for content.
 *    All six stages must be readable before anything is entered.
 * 3. Saving a due date without 单独同意, or writing anything at all
 *    just because the screen was opened.
 * 4. Sending the one reader this page was opened up for — not
 *    registered, pregnant or deciding — into a login form she did not
 *    ask for, by offering her a button to a route the gate bounces.
 * 5. Answering a storage failure with 「你的日期填错了」.
 */

import React from 'react';
import TestRenderer, { act, type ReactTestInstance } from 'react-test-renderer';
import { Text, TouchableOpacity } from 'react-native';

const mockReadDueDate = jest.fn();
const mockSaveDueDate = jest.fn();
const mockClearDueDate = jest.fn();

jest.mock('../pregnancy-tracker', () => ({
  __esModule: true,
  PREGNANCY_DUE_DATE_KEY: 'openrd.pregnancy.dueDate',
  readDueDate: (...args: unknown[]) => mockReadDueDate(...args),
  saveDueDate: (...args: unknown[]) => mockSaveDueDate(...args),
  clearDueDate: (...args: unknown[]) => mockClearDueDate(...args),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

// The signed-out reader is the default here, because she is the reader
// this route was made a guest route for.
let mockToken: string | null = null;
let mockProfileStatus = 'loading';
jest.mock('../../../contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({ token: mockToken }),
}));
jest.mock('../../../contexts/ProfileContext', () => ({
  __esModule: true,
  useProfileContext: () => ({ profileStatus: mockProfileStatus }),
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
  return { __esModule: true, default: () => ReactLocal.createElement('ScreenHeader', null) };
});

// Kept pressable — the tests drive the real controls rather than
// reaching into component state.
jest.mock('../../common/Button', () => {
  const ReactLocal = require('react');
  const { Text: RNText, TouchableOpacity: RNTouchable } = require('react-native');
  return {
    __esModule: true,
    default: ({
      label,
      onPress,
      disabled,
    }: {
      label: string;
      onPress: () => void;
      disabled?: boolean;
    }) =>
      ReactLocal.createElement(
        RNTouchable,
        { onPress: disabled ? undefined : onPress, accessibilityState: { disabled: !!disabled } },
        ReactLocal.createElement(RNText, null, label),
      ),
  };
});

jest.mock('../../common/SegmentedControl', () => {
  const ReactLocal = require('react');
  const { Text: RNText, TouchableOpacity: RNTouchable } = require('react-native');
  return {
    __esModule: true,
    default: ({
      segments,
      onChange,
    }: {
      segments: Array<{ key: string; label: string }>;
      onChange: (key: string) => void;
    }) =>
      ReactLocal.createElement(
        'SegmentedControl',
        null,
        segments.map((segment) =>
          ReactLocal.createElement(
            RNTouchable,
            { key: segment.key, onPress: () => onChange(segment.key) },
            ReactLocal.createElement(RNText, null, `SEG:${segment.label}`),
          ),
        ),
      ),
  };
});

jest.mock('../../common/ToggleSwitch', () => {
  const ReactLocal = require('react');
  const { Text: RNText, TouchableOpacity: RNTouchable } = require('react-native');
  return {
    __esModule: true,
    default: ({ isEnabled, onToggle }: { isEnabled: boolean; onToggle: (next: boolean) => void }) =>
      ReactLocal.createElement(
        RNTouchable,
        { onPress: () => onToggle(!isEnabled) },
        ReactLocal.createElement(RNText, null, isEnabled ? 'CONSENT:ON' : 'CONSENT:OFF'),
      ),
  };
});

import PregnancyScreen from '../index';
import {
  PREGNANCY_INTRO,
  PREGNANCY_STAGES,
  PREGNANCY_TRACKER_CLEAR_LABEL,
} from '../../../lib/pregnancy-timeline-content';

const textOf = (tree: TestRenderer.ReactTestRenderer): string =>
  tree.root
    .findAllByType(Text)
    .flatMap((node) =>
      Array.isArray(node.props.children) ? node.props.children : [node.props.children],
    )
    .filter((child): child is string => typeof child === 'string')
    .join('\n');

const pressableWithText = (
  tree: TestRenderer.ReactTestRenderer,
  needle: string,
): ReactTestInstance | null =>
  tree.root
    .findAllByType(TouchableOpacity)
    .find((node) =>
      node.findAllByType(Text).some((label) => String(label.props.children ?? '').includes(needle)),
    ) ?? null;

/** Mounts and flushes the initial readDueDate promise. */
const render = async (): Promise<TestRenderer.ReactTestRenderer> => {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<PregnancyScreen />);
  });
  return tree;
};

const futureDue = (): string => {
  const today = new Date();
  const due = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 100);
  return `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(
    due.getDate(),
  ).padStart(2, '0')}`;
};

beforeEach(() => {
  mockReadDueDate.mockReset().mockResolvedValue(null);
  mockSaveDueDate.mockReset().mockResolvedValue('saved');
  mockClearDueDate.mockReset().mockResolvedValue(true);
  mockPush.mockReset();
  mockToken = null;
  mockProfileStatus = 'loading';
});

describe('没有填过日期时', () => {
  it('全部六个阶段都可以打开，一个字都不用先填', async () => {
    const tree = await render();
    for (const stage of PREGNANCY_STAGES) {
      const tab = pressableWithText(tree, `SEG:${stage.shortTitle}`);
      expect(tab).not.toBeNull();
      await act(async () => {
        tab!.props.onPress();
      });
      const text = textOf(tree);
      // Every item of the opened stage is on screen.
      stage.items.forEach((item) => {
        expect(text).toContain(item.title);
      });
    }
  });

  it('打开页面不写任何东西', async () => {
    await render();
    expect(mockReadDueDate).toHaveBeenCalledTimes(1);
    expect(mockSaveDueDate).not.toHaveBeenCalled();
    expect(mockClearDueDate).not.toHaveBeenCalled();
  });

  it('页面上没有任何孕周读数', async () => {
    const tree = await render();
    expect(textOf(tree)).not.toMatch(/孕 \d+ 周/);
  });

  it('默认打开的是「孕前」，不是猜一个孕期阶段', async () => {
    const tree = await render();
    const text = textOf(tree);
    expect(text).toContain(PREGNANCY_STAGES[0].items[0].title);
  });
});

describe('单独同意是保存的前提', () => {
  it('没打开同意开关时保存按钮点不动，不会写入', async () => {
    const tree = await render();
    const save = pressableWithText(tree, '保存到这台设备');
    expect(save).not.toBeNull();
    expect(save!.props.accessibilityState.disabled).toBe(true);
    await act(async () => {
      save!.props.onPress?.();
    });
    expect(mockSaveDueDate).not.toHaveBeenCalled();
  });

  it('同意 + 填了日期之后才写入，并按填的日期展开对应阶段', async () => {
    const tree = await render();
    const due = futureDue();

    await act(async () => {
      pressableWithText(tree, 'CONSENT:OFF')!.props.onPress();
    });
    const input = tree.root.findByProps({ accessibilityLabel: '预产期，格式为年-月-日' });
    await act(async () => {
      input.props.onChangeText(due);
    });
    await act(async () => {
      pressableWithText(tree, '保存到这台设备')!.props.onPress();
    });

    expect(mockSaveDueDate).toHaveBeenCalledWith(due, expect.any(Date));
    const text = textOf(tree);
    // 100 days out of 280 => 180 days gestation => 25 weeks + 5 days.
    expect(text).toContain('孕 25 周 +5 天');
    expect(text).toContain('孕中期');
  });

  it('日期被拒绝时给出可读的错误，且不显示孕周', async () => {
    mockSaveDueDate.mockResolvedValue('invalid');
    const tree = await render();
    await act(async () => {
      pressableWithText(tree, 'CONSENT:OFF')!.props.onPress();
    });
    const input = tree.root.findByProps({ accessibilityLabel: '预产期，格式为年-月-日' });
    await act(async () => {
      input.props.onChangeText('1999-01-01');
    });
    await act(async () => {
      pressableWithText(tree, '保存到这台设备')!.props.onPress();
    });
    const text = textOf(tree);
    expect(text).toMatch(/看起来不像预产期/);
    expect(text).not.toMatch(/孕 \d+ 周/);
  });
});

describe('存不下的时候', () => {
  const save = async (tree: TestRenderer.ReactTestRenderer) => {
    await act(async () => {
      pressableWithText(tree, 'CONSENT:OFF')!.props.onPress();
    });
    const input = tree.root.findByProps({ accessibilityLabel: '预产期，格式为年-月-日' });
    await act(async () => {
      input.props.onChangeText(futureDue());
    });
    await act(async () => {
      pressableWithText(tree, '保存到这台设备')!.props.onPress();
    });
  };

  it('说的是这台设备存不下，而不是「你的日期填错了」', async () => {
    // Private-mode localStorage, a full phone, storage blocked in the
    // WeChat webview. The date is right; no amount of retyping can
    // make the write succeed, so a message telling her to reformat it
    // is a loop with no exit.
    mockSaveDueDate.mockResolvedValue('storage-error');
    const tree = await render();
    await save(tree);
    const text = textOf(tree);
    expect(text).toContain('存不下');
    expect(text).not.toMatch(/看起来不像预产期/);
    expect(text).not.toMatch(/孕 \d+ 周/);
  });

  it('saveDueDate 抛异常时也读作「没存上」', async () => {
    mockSaveDueDate.mockRejectedValue(new Error('storage gone'));
    const tree = await render();
    await save(tree);
    const text = textOf(tree);
    expect(text).toContain('存不下');
    expect(text).not.toMatch(/看起来不像预产期/);
  });
});

describe('相关的页面：不给没登录的读者一个通向登录墙的按钮', () => {
  const buttonLabels = (tree: TestRenderer.ReactTestRenderer): string[] =>
    tree.root
      .findAllByType(TouchableOpacity)
      .flatMap((node) => node.findAllByType(Text))
      .map((label) => String(label.props.children ?? ''));

  it('没登录时，两个要登录的页面只留说明，不留按钮', async () => {
    const tree = await render();
    const labels = buttonLabels(tree);
    expect(labels).not.toContain('打开「麻醉注意事项卡」');
    expect(labels).not.toContain('打开「我的随访计划」');
    // 遗传与生育 is itself a guest route: that one stays a button.
    expect(labels).toContain('打开「遗传与生育」');

    const text = textOf(tree);
    // The fact survives even though the page behind it does not.
    expect(text).toContain('得先注册登录');
    expect(text).toContain('孕晚期见麻醉科时带上它');
  });

  it('登录了、档案也在时，三个按钮都在，点了就跳', async () => {
    mockToken = 'tok';
    mockProfileStatus = 'ready';
    const tree = await render();
    for (const label of ['打开「遗传与生育」', '打开「麻醉注意事项卡」', '打开「我的随访计划」']) {
      const button = pressableWithText(tree, label);
      expect(button).not.toBeNull();
      await act(async () => {
        button!.props.onPress();
      });
    }
    expect(mockPush.mock.calls.map((call) => call[0])).toEqual([
      '/p-genetics_family',
      '/p-clinical_passport',
      '/p-surveillance',
    ]);
  });

  it('登录了但档案还没建时同样不给按钮 —— 那个跳转会被引导页拦下', async () => {
    mockToken = 'tok';
    mockProfileStatus = 'missing';
    const tree = await render();
    const labels = buttonLabels(tree);
    expect(labels).not.toContain('打开「麻醉注意事项卡」');
    expect(labels).not.toContain('打开「我的随访计划」');
  });

  it('档案探测失败时不收走按钮 —— 路由闸门自己也是放行的', async () => {
    mockToken = 'tok';
    mockProfileStatus = 'error';
    const tree = await render();
    expect(buttonLabels(tree)).toContain('打开「麻醉注意事项卡」');
  });
});

describe('一键关闭', () => {
  const mountWithDate = async () => {
    mockReadDueDate.mockResolvedValue(futureDue());
    return render();
  };

  it('存了日期时，关闭按钮排在孕周读数、页头说明和全部阶段内容之前', async () => {
    // Position is the feature. Someone whose pregnancy just ended must
    // not have to scroll past a checklist to find the off switch.
    //
    // All three anchors are asserted, not just the week: an earlier
    // version of this test only compared the button against the week
    // number, and it stayed green when the whole tracker block was
    // moved below the intro — which is exactly the regression the
    // screen's own comment claims cannot happen.
    const tree = await mountWithDate();
    const labels = tree.root.findAllByType(Text).map((node) => String(node.props.children ?? ''));
    const clearIndex = labels.findIndex((label) => label.includes(PREGNANCY_TRACKER_CLEAR_LABEL));
    const weekIndex = labels.findIndex((label) => /孕 \d+ 周/.test(label));
    const introIndex = labels.findIndex((label) => label.includes(PREGNANCY_INTRO));
    const firstItemIndex = labels.findIndex((label) =>
      label.includes(PREGNANCY_STAGES[0].items[0].title),
    );

    [clearIndex, weekIndex, introIndex].forEach((index) => {
      expect(index).toBeGreaterThanOrEqual(0);
    });
    expect(clearIndex).toBeLessThan(weekIndex);
    expect(clearIndex).toBeLessThan(introIndex);
    if (firstItemIndex >= 0) expect(clearIndex).toBeLessThan(firstItemIndex);
  });

  it('按一次就没了：孕周消失，不再问第二次', async () => {
    const tree = await mountWithDate();
    expect(textOf(tree)).toMatch(/孕 \d+ 周/);

    await act(async () => {
      pressableWithText(tree, PREGNANCY_TRACKER_CLEAR_LABEL)!.props.onPress();
    });

    const text = textOf(tree);
    expect(text).not.toMatch(/孕 \d+ 周/);
    expect(text).toContain('已删除');
    expect(mockClearDueDate).toHaveBeenCalledTimes(1);
    // No confirmation step: the content is gone after ONE press.
    expect(text).not.toMatch(/确定要|是否确认/);
  });

  it('删除后不再把「填写预产期」摆回读者面前', async () => {
    // The setup form reappearing under 产后抑郁筛查 would be the app
    // asking someone to re-confirm a pregnancy that just ended.
    const tree = await mountWithDate();
    await act(async () => {
      pressableWithText(tree, PREGNANCY_TRACKER_CLEAR_LABEL)!.props.onPress();
    });
    expect(pressableWithText(tree, '保存到这台设备')).toBeNull();
    expect(textOf(tree)).not.toContain('把时间线对到你的孕周');
  });

  it('存储删除失败时，界面照样立刻清空', async () => {
    // The screen must not wait on the write. A person who pressed this
    // has stopped consenting whether or not storage cooperated.
    mockClearDueDate.mockRejectedValue(new Error('storage gone'));
    const tree = await mountWithDate();
    await act(async () => {
      pressableWithText(tree, PREGNANCY_TRACKER_CLEAR_LABEL)!.props.onPress();
    });
    expect(textOf(tree)).not.toMatch(/孕 \d+ 周/);
  });

  it('关掉之后六个阶段仍然全都读得到', async () => {
    const tree = await mountWithDate();
    await act(async () => {
      pressableWithText(tree, PREGNANCY_TRACKER_CLEAR_LABEL)!.props.onPress();
    });
    for (const stage of PREGNANCY_STAGES) {
      await act(async () => {
        pressableWithText(tree, `SEG:${stage.shortTitle}`)!.props.onPress();
      });
      expect(textOf(tree)).toContain(stage.items[0].title);
    }
  });
});

describe('读取失败时', () => {
  it('当作没填过处理，不显示任何日期相关内容', async () => {
    mockReadDueDate.mockResolvedValue(null);
    const tree = await render();
    expect(textOf(tree)).not.toMatch(/孕 \d+ 周/);
    expect(textOf(tree)).toContain('把时间线对到你的孕周');
  });
});
