import TestRenderer, { act } from 'react-test-renderer';

import PickupCodeCard from '../components/PickupCodeCard';

/**
 * The card the patient holds up across a consulting-room desk.
 *
 * The defect these pin was live: `minutesLeft` was computed once at
 * mint and handed in as a prop, and the card stays mounted for as long
 * as the patient leaves the screen open. A code generated in the
 * waiting room and shown to the doctor twelve minutes later still read
 * 「约 15 分钟内有效」 — a false statement about a live credential, made
 * at the exact moment it mattered.
 *
 * The second half was worse in a quieter way: the else branch of the
 * old ternary was the literal 15, so an unparseable expiry, or a device
 * clock running ahead of the server (routine on the mid-range Android
 * handsets this product targets), printed fifteen minutes the device
 * had no evidence for.
 */

// Host-component strings, the same shape the rest of this repo mocks
// native modules with. The QR is not what these tests are about — the
// card's clock is — and react-native-svg's real renderer needs a native
// module jest-expo does not provide.
jest.mock('react-native-svg', () => ({
  __esModule: true,
  default: 'Svg',
  Path: 'Path',
  Rect: 'Rect',
}));

const MINT = new Date('2026-08-05T12:00:00.000Z').getTime();

const render = (props: Partial<React.ComponentProps<typeof PickupCodeCard>> = {}) => {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <PickupCodeCard
        code="K7F39QTM"
        qrUrl={null}
        expiresAt="2026-08-05T12:15:00.000Z"
        ttlMinutes={15}
        maxAttempts={3}
        {...props}
      />,
    );
  });
  return tree;
};

/** Every string the card renders, concatenated in tree order. Flattened
 *  rather than JSON-stringified because RN splits an interpolated
 *  sentence into several children, and 「输错 {n} 次」 is exactly such a
 *  sentence. */
const flatten = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (node && typeof node === 'object') return flatten((node as { children?: unknown }).children);
  return '';
};

const text = (tree: TestRenderer.ReactTestRenderer): string => flatten(tree.toJSON());

/** The accessibility label on the card's root — what a screen reader
 *  reads out, which must agree with what is on screen. */
const label = (tree: TestRenderer.ReactTestRenderer): string =>
  String(
    tree.root.findAll((n) => typeof n.props?.accessibilityLabel === 'string')[0].props
      .accessibilityLabel,
  );

/** Jest's modern fake timers move `Date.now()` along with the timer
 *  queue, which is what makes this test meaningful: the card measures
 *  elapsed time with Date.now(), not with a tick count. */
const advance = (ms: number) => {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(MINT);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('时钟是走的', () => {
  it('刚生成时说 15 分钟', () => {
    const tree = render();
    expect(text(tree)).toContain('约 15 分钟内有效');
  });

  it('挂着不动过了十二分钟，它不会还说 15 分钟', () => {
    // The exact failure: waiting room → consulting room, same mounted
    // card, and the old one still asserted the number it was born with.
    const tree = render();
    advance(12 * 60_000);
    const shown = text(tree);
    expect(shown).not.toContain('约 15 分钟内有效');
    expect(shown).toContain('约 3 分钟内有效');
  });

  it('到点就说已过期，而不是继续报一个数', () => {
    const tree = render();
    advance(15 * 60_000 + 1_000);
    const shown = text(tree);
    expect(shown).toContain('已过期，请重新生成');
    expect(shown).not.toMatch(/约 \d+ 分钟内有效/);
  });

  it('最后不到一分钟仍然算能用 —— 不会说「约 0 分钟」', () => {
    const tree = render();
    advance(14 * 60_000 + 30_000);
    expect(text(tree)).toContain('约 1 分钟内有效');
  });

  it('屏幕上和读屏器读出来的是同一句话', () => {
    const tree = render();
    advance(12 * 60_000);
    expect(label(tree)).toContain('约 3 分钟内有效');
    // And the code is still spelled out character by character, because
    // this is read aloud to a doctor.
    expect(label(tree)).toContain('K 7 F 3 9 Q T M');
  });

  it('过期后不再每秒重算 —— 定时器自己停掉', () => {
    render();
    advance(15 * 60_000 + 2_000);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('不知道就说不知道，绝不报一个 15', () => {
  it('expiresAt 读不出来且没有 ttlMinutes 时是「未知」，不是 15 分钟', () => {
    const tree = render({ ttlMinutes: null, expiresAt: 'not a date' });
    const shown = text(tree);
    expect(shown).toContain('有效时间未知');
    expect(shown).not.toContain('15 分钟');
    expect(shown).not.toMatch(/约 \d+ 分钟内有效/);
  });

  it('设备时钟快过服务器时也是「未知」，不是「已过期」', () => {
    // A code the server minted one second ago is not expired. If the
    // handset's clock is twenty minutes fast, expiresAt - now is
    // negative and the honest answer is that we cannot measure it —
    // telling the patient 「已过期」 would send them to regenerate a
    // perfectly good code, and again, and again.
    const tree = render({ ttlMinutes: null, expiresAt: '2026-08-05T11:45:00.000Z' });
    const shown = text(tree);
    expect(shown).toContain('有效时间未知');
    expect(shown).not.toContain('已过期');
  });

  it('有 ttlMinutes 时时钟偏移完全不影响倒计时', () => {
    // The reason ttlMinutes is preferred over expiresAt: counting down
    // from the TTL the server stated uses only locally measured elapsed
    // time, so an absolute clock offset cannot touch it.
    const tree = render({ ttlMinutes: 15, expiresAt: '2026-08-05T11:45:00.000Z' });
    expect(text(tree)).toContain('约 15 分钟内有效');
    advance(60_000);
    expect(text(tree)).toContain('约 14 分钟内有效');
  });
});

describe('次数用服务器给的，服务器没给才用本地常量', () => {
  it('服务器说 5 次就写 5 次', () => {
    expect(text(render({ maxAttempts: 5 }))).toContain('出生日期输错 5');
  });

  it('服务器没说时回落到本地常量，而不是留白', () => {
    expect(text(render({ maxAttempts: null }))).toContain('出生日期输错 3');
  });
});

describe('同一屏内第二次生成', () => {
  /**
   * The exact path supersede-on-mint exists to serve: the patient reads
   * the code out, the doctor mishears a character, they tap again.
   *
   * The countdown pins its start to mount. If the caller renders this
   * card without keying it on the code, React updates props on the same
   * instance, the mount timestamp stays at the FIRST mint, and the new
   * code — which the server just gave a full TTL — counts down from
   * whatever was left of the old one. It then tells the patient
   * 「已过期，请重新生成」, they regenerate, and that supersedes the code
   * that was still good. Two correct fixes composing into a loop.
   *
   * So this asserts the contract the screen has to honour, from both
   * sides: keyed remount is right, prop-update alone is not.
   */
  const SECOND_MINT_AFTER_MS = 14 * 60_000;

  it('按 code 重新挂载时，新码拿到完整的有效期', () => {
    const tree = render();
    advance(SECOND_MINT_AFTER_MS);

    // What the screen does: `key={freshPickup.code}` — a new code is a
    // new mount, so a fresh renderer is the faithful simulation.
    act(() => tree.unmount());
    const second = render({ code: 'BBBB2222', expiresAt: '2026-08-05T12:29:00.000Z' });
    expect(text(second)).toContain('约 15 分钟内有效');
    expect(text(second)).not.toContain('已过期');

    advance(2 * 60_000);
    expect(text(second)).toContain('约 13 分钟内有效');
    expect(text(second)).not.toContain('已过期');
  });

  it('只更新 props、不重新挂载时也要算对 —— 正确性不能挂在调用方的约定上', () => {
    // The screen does pass a key, so this path should not occur. It is
    // pinned anyway because the first version of this component made
    // the countdown's correctness a caller convention, and a caller
    // convention is exactly what nobody checks in review.
    const tree = render();
    advance(SECOND_MINT_AFTER_MS);
    act(() => {
      tree.update(
        <PickupCodeCard
          code="BBBB2222"
          qrUrl={null}
          expiresAt="2026-08-05T12:29:00.000Z"
          ttlMinutes={15}
          maxAttempts={3}
        />,
      );
    });
    expect(text(tree)).toContain('约 15 分钟内有效');
    expect(text(tree)).not.toContain('已过期');

    advance(2 * 60_000);
    expect(text(tree)).toContain('约 13 分钟内有效');
  });

  it('同一个 code 重渲染时不会把倒计时推回去', () => {
    // The rebase keys on the code changing, not on any render.
    const tree = render();
    advance(5 * 60_000);
    act(() => {
      tree.update(
        <PickupCodeCard
          code="K7F39QTM"
          qrUrl={null}
          expiresAt="2026-08-05T12:15:00.000Z"
          ttlMinutes={15}
          maxAttempts={3}
        />,
      );
    });
    expect(text(tree)).toContain('约 10 分钟内有效');
  });
});
