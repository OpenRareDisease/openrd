/**
 * The default is the feature.
 *
 * A peer story that appears the moment a patient records a fall is a
 * progression alert wearing empathy, and no wording undoes that — the
 * appearance of the card is the message. So the tests below are less
 * about behaviour than about a promise: nothing in story-hooks.ts shows
 * a hook to someone who did not switch it on, including when storage is
 * empty, corrupt, or throwing.
 */

let mockStore = new Map<string, string>();
let mockFailReads = false;
let mockFailWrites = false;

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (key: string) => {
    if (mockFailReads) return Promise.reject(new Error('storage unavailable'));
    return Promise.resolve(mockStore.get(key) ?? null);
  },
  setItem: (key: string, value: string) => {
    if (mockFailWrites) return Promise.reject(new Error('storage full'));
    mockStore.set(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string) => {
    mockStore.delete(key);
    return Promise.resolve();
  },
}));

import {
  STORY_HOOKS_DISMISSED_KEY,
  STORY_HOOKS_ENABLED_KEY,
  areStoryHooksEnabled,
  dismissStoryHook,
  isStoryHookDismissed,
  resetStoryHookDismissals,
  resolveStoryHook,
  setStoryHooksEnabled,
} from '../story-hooks';

beforeEach(() => {
  mockStore = new Map();
  mockFailReads = false;
  mockFailWrites = false;
});

describe('默认关闭', () => {
  it('全新设备上，什么都不显示', async () => {
    // The single most important assertion in this lane.
    expect(await areStoryHooksEnabled()).toBe(false);
    expect(await resolveStoryHook('fall-logged')).toBeNull();
    expect(await resolveStoryHook('stair-test-cannot')).toBeNull();
    expect(await resolveStoryHook('first-afo')).toBeNull();
  });

  it('存的值不是 true（比如旧版本写坏了）也当成关闭', async () => {
    mockStore.set(STORY_HOOKS_ENABLED_KEY, 'maybe');
    expect(await areStoryHooksEnabled()).toBe(false);
    expect(await resolveStoryHook('fall-logged')).toBeNull();
  });

  it('读存储抛错时当成关闭，而不是「先显示再说」', async () => {
    mockStore.set(STORY_HOOKS_ENABLED_KEY, 'true');
    mockFailReads = true;
    expect(await areStoryHooksEnabled()).toBe(false);
    expect(await resolveStoryHook('fall-logged')).toBeNull();
  });

  it('写失败之后，下次读到的还是关闭', async () => {
    mockFailWrites = true;
    await setStoryHooksEnabled(true);
    mockFailWrites = false;
    expect(await areStoryHooksEnabled()).toBe(false);
  });
});

describe('打开之后', () => {
  beforeEach(async () => {
    await setStoryHooksEnabled(true);
  });

  it('三个情境都能拿到故事、摘录和文案', async () => {
    const resolved = await resolveStoryHook('fall-logged');
    expect(resolved).not.toBeNull();
    expect(resolved?.hook.id).toBe('fall-logged');
    expect(resolved?.story.origin.byline.length).toBeGreaterThan(0);
    expect(resolved?.excerpt.text.length).toBeGreaterThan(0);

    expect(await resolveStoryHook('stair-test-cannot')).not.toBeNull();
    expect(await resolveStoryHook('first-afo')).not.toBeNull();
  });

  it('再关掉就立刻不显示了', async () => {
    await setStoryHooksEnabled(false);
    expect(await resolveStoryHook('fall-logged')).toBeNull();
  });
});

describe('一键关掉之后不会再回来', () => {
  beforeEach(async () => {
    await setStoryHooksEnabled(true);
  });

  it('关掉的那一类，第二次记录时也不再出现', async () => {
    // 「Dismiss」 must not mean 「snooze until the next bad day」. A card
    // that returns after the second fall makes the app look like it is
    // keeping count of them.
    await dismissStoryHook('fall-logged');
    expect(await resolveStoryHook('fall-logged')).toBeNull();
    expect(await resolveStoryHook('fall-logged')).toBeNull();
  });

  it('关掉一类不影响其它两类', async () => {
    await dismissStoryHook('fall-logged');
    expect(await resolveStoryHook('stair-test-cannot')).not.toBeNull();
    expect(await resolveStoryHook('first-afo')).not.toBeNull();
  });

  it('重复关同一类不会把它写两遍', async () => {
    await dismissStoryHook('fall-logged');
    await dismissStoryHook('fall-logged');
    expect(JSON.parse(mockStore.get(STORY_HOOKS_DISMISSED_KEY) ?? '[]')).toEqual(['fall-logged']);
  });

  it('总开关关了又开，之前关掉的那一类仍然是关掉的', async () => {
    // Two different decisions. Turning the feature off and on again is
    // not a request to have the dismissed card back.
    await dismissStoryHook('fall-logged');
    await setStoryHooksEnabled(false);
    await setStoryHooksEnabled(true);
    expect(await resolveStoryHook('fall-logged')).toBeNull();
    expect(await resolveStoryHook('stair-test-cannot')).not.toBeNull();
  });

  it('存坏的 dismissed 值不会让已关掉的卡片复活成崩溃', async () => {
    mockStore.set(STORY_HOOKS_DISMISSED_KEY, '{not json');
    expect(await isStoryHookDismissed('fall-logged')).toBe(false);
    expect(await resolveStoryHook('fall-logged')).not.toBeNull();
  });

  it('dismissed 里的陌生 id 被忽略', async () => {
    mockStore.set(STORY_HOOKS_DISMISSED_KEY, JSON.stringify(['fall-logged', 'not-a-hook', 42]));
    expect(await isStoryHookDismissed('fall-logged')).toBe(true);
    expect(await isStoryHookDismissed('first-afo')).toBe(false);
  });

  // The screen test asserts that 病友经验 is the only surface that calls
  // this; here we only assert what the function itself does.
  it('重置之后会重新出现', async () => {
    await dismissStoryHook('fall-logged');
    await resetStoryHookDismissals();
    expect(await resolveStoryHook('fall-logged')).not.toBeNull();
  });
});

describe('内容坏掉时宁可不显示', () => {
  it('未知的情境 id 返回 null', async () => {
    await setStoryHooksEnabled(true);
    // @ts-expect-error deliberately passing an id that is not a hook.
    expect(await resolveStoryHook('made-up-context')).toBeNull();
  });
});
