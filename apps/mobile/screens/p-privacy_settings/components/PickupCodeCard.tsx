import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { buildQrMatrix, qrPath } from '../qr';
import { COLOR } from '../../../lib/design';
import { formatPickupCode, PICKUP_MAX_ATTEMPTS } from '../../../lib/passport-share';

/**
 * What the patient holds up across the desk.
 *
 * The shape of this card is the whole design argument. FSHD takes
 * sustained grip and a raised arm first, so the phone should be up for
 * seconds, not a minute, and whatever is on it has to be readable at
 * the other person's distance in one look. Hence: the code enormous
 * and split into two spoken groups, the QR beside it rather than
 * instead of it, and every instruction below the fold where it does
 * not compete.
 *
 * THE QR CARRIES THE PAGE ADDRESS, NOT THE CODE. See lib/passport-share
 * (`buildPickupUrl`) for why — a URL with the credential in it is a
 * credential in a browser history, a proxy log and a Referer header,
 * and it would turn two factors into one.
 *
 * `qrUrl` may be null: on native there is no origin, and a QR pointing
 * at the wrong host is worse than no QR because nobody can tell why it
 * failed. The card then shows the code alone, which still works — the
 * doctor types the address once.
 *
 * THE CLOCK RUNS. It used to be a `minutesLeft: number` prop computed
 * once at mint, and this card stays mounted — so a code generated in
 * the waiting room and shown to the doctor twelve minutes later still
 * read 「约 15 分钟内有效」, which is untrue at the exact moment it
 * matters. It ticks now, and it says 「已过期」 at zero.
 */
export type PickupCodeCardProps = {
  code: string;
  qrUrl: string | null;
  /** The server's expiry for THIS code, ISO-8601. Used only when the
   *  response carried no `ttlMinutes` — see `budgetFor`. */
  expiresAt: string;
  /**
   * The server's own PICKUP_TTL_MINUTES for this code, or null when the
   * response did not carry a usable one. Null is a real state here and
   * the card renders it as one; it must never be turned into a number
   * on the way in.
   */
  ttlMinutes: number | null;
  /** The server's own MAX_PICKUP_ATTEMPTS, or null. */
  maxAttempts: number | null;
};

/** Quiet zone, in modules. The standard asks for four, and a QR with
 *  no margin against a coloured card is one a camera hunts for. */
const QUIET = 4;
const QR_PIXELS = 132;

/** How long this card believes the code has, from the moment it
 *  mounted — which is the moment the code was minted. */
type PickupLife =
  | { kind: 'live'; minutes: number }
  | { kind: 'expired'; minutes: null }
  | { kind: 'unknown'; minutes: null };

/**
 * How many milliseconds the code gets, measured from mount.
 *
 * `ttlMinutes` FIRST, and `expiresAt` only as a fallback, because the
 * failure this has to survive is a wrong device clock. These handsets
 * are mid-range Android as often as iPhone and their clocks drift; a
 * device running twenty minutes fast makes `expiresAt - Date.now()`
 * negative for a code the server minted one second ago. Counting down
 * from the TTL the server stated, using locally measured elapsed time,
 * depends on the clock's RATE and not on its offset.
 *
 * Returns null — never a default duration — when neither source gives
 * an answer. The caller renders that as 「不知道」. The previous code
 * fell back to the literal 15, which is a claim about a patient's live
 * credential that nothing on the device supported.
 */
const budgetFor = (ttlMinutes: number | null, expiresAt: string, now: number): number | null => {
  if (ttlMinutes !== null && Number.isFinite(ttlMinutes) && ttlMinutes > 0) {
    return ttlMinutes * 60_000;
  }
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline)) return null;
  const left = deadline - now;
  // Already non-positive for a code that was just minted means the two
  // clocks disagree, not that the code is dead. We cannot measure it,
  // so we say so.
  return left > 0 ? left : null;
};

const lifeOf = (budgetMs: number | null, elapsedMs: number): PickupLife => {
  if (budgetMs === null) return { kind: 'unknown', minutes: null };
  const left = budgetMs - elapsedMs;
  if (left <= 0) return { kind: 'expired', minutes: null };
  // Ceil, and never below 1: the last 59 seconds are still usable, and
  // 「约 0 分钟」 would send a patient to regenerate a working code.
  return { kind: 'live', minutes: Math.max(1, Math.ceil(left / 60_000)) };
};

/** One phrase, used both on screen and in the accessibility label, so a
 *  screen-reader user and a sighted user are never told different
 *  things about the same code. */
const lifeText = (life: PickupLife): string => {
  if (life.kind === 'live') return `约 ${life.minutes} 分钟内有效 · 只能用一次`;
  if (life.kind === 'expired') return '已过期，请重新生成';
  return '有效时间未知 · 只能用一次；打不开就当场再生成一个';
};

const PickupCodeCard = ({
  code,
  qrUrl,
  expiresAt,
  ttlMinutes,
  maxAttempts,
}: PickupCodeCardProps) => {
  const qr = useMemo(() => (qrUrl ? buildQrMatrix(qrUrl) : null), [qrUrl]);
  const path = useMemo(() => (qr ? qrPath(qr) : ''), [qr]);
  const span = qr ? qr.size + QUIET * 2 : 0;
  const shown = formatPickupCode(code);

  /**
   * When this card started counting for THE CODE IT IS SHOWING.
   *
   * Rebased whenever `code` changes, not fixed at mount. The screen also
   * keys this component on `code`, so in practice a new code is a new
   * mount — but relying on that made the countdown's correctness a
   * caller convention, and the first version of this component shipped
   * without it:
   *
   *   the patient reads the code out, the doctor mishears a character,
   *   the patient taps again. Props updated on the same instance, this
   *   stayed pinned to the FIRST mint, and a code the server had just
   *   given a full fifteen minutes rendered 「约 1 分钟内有效」 and then
   *   「已过期，请重新生成」. The patient regenerates — and regenerating
   *   supersedes the code that was still good. A loop, in a consulting
   *   room, built out of two individually correct fixes.
   *
   * So the component is correct on its own now. The key stays as
   * belt-and-braces, not as the mechanism.
   */
  const mountedAt = useRef(Date.now());
  const countingFor = useRef(code);
  if (countingFor.current !== code) {
    countingFor.current = code;
    mountedAt.current = Date.now();
  }
  // Deliberately not a useMemo. It reads `mountedAt.current`, which the
  // block above rebases on a new code, so a correct dependency list has
  // to include `code` — and exhaustive-deps cannot see through a ref, so
  // it calls that dependency unnecessary and the warning pushes the next
  // person to delete it. Deleted, a re-mint carrying the same `expiresAt`
  // would keep the previous code's budget while the elapsed clock
  // restarted at zero: the fallback branch's version of the very bug the
  // rebase exists to fix.
  //
  // `budgetFor` is arithmetic over three values, so the memo bought
  // nothing except somewhere for the dependency list to be wrong. The
  // result is a number (or null), so the tick effect below still sees a
  // stable dependency across renders.
  const budgetMs = budgetFor(ttlMinutes, expiresAt, mountedAt.current);
  const [life, setLife] = useState<PickupLife>(() => lifeOf(budgetMs, 0));

  useEffect(() => {
    if (budgetMs === null) {
      setLife({ kind: 'unknown', minutes: null });
      return;
    }
    // A holder rather than a bare `let`, so `tick` can close over the
    // handle that schedules it and stop itself at zero.
    const handle: { id?: ReturnType<typeof setInterval> } = {};
    const stop = () => {
      if (handle.id !== undefined) clearInterval(handle.id);
    };
    const tick = () => {
      // Elapsed since this card started counting FOR THIS CODE — see
      // `countingFor`. Not since the effect ran, so an unrelated prop
      // change mid-life cannot silently hand the code a fresh fifteen
      // minutes; and not since first mount, so a genuinely new code is
      // not counted down under its predecessor's clock.
      const next = lifeOf(budgetMs, Date.now() - mountedAt.current);
      // Returning the previous object when nothing visible changed lets
      // React bail out of the render. This screen already re-renders on
      // four other subscriptions and does not need 900 extra renders per
      // fifteen minutes to move a number that changes 15 times.
      setLife((prev) => (prev.kind === next.kind && prev.minutes === next.minutes ? prev : next));
      if (next.kind === 'expired') stop();
    };
    handle.id = setInterval(tick, 1000);
    tick();
    return stop;
    // `code` is a dependency even though the body does not read it: it
    // is what `mountedAt` was rebased against, and without it a second
    // mint with the same TTL leaves budgetMs unchanged, the effect does
    // not re-run, and the card shows the previous code's remaining time
    // until the next tick — which is the second someone is holding the
    // phone out to a doctor.
  }, [budgetMs, code]);

  const lifeLabel = lifeText(life);
  // The client's mirrored constant is an acceptable fallback HERE and
  // not for the clock: how many wrong birthdates burn a code is a fixed
  // rule of the feature, while the minutes left are a fact about this
  // one code that decays while the card is on screen.
  const attempts = maxAttempts ?? PICKUP_MAX_ATTEMPTS;

  return (
    <View
      style={styles.card}
      accessible
      accessibilityRole="summary"
      // Spelled out with separators so a screen reader does not run the
      // eight characters together — this is read aloud to a doctor.
      accessibilityLabel={`取件码 ${code.split('').join(' ')}，${lifeLabel}`}
    >
      <Text style={styles.title}>把这一屏给医生看</Text>

      <View style={styles.row}>
        <View style={styles.codeBlock}>
          <Text
            style={styles.code}
            selectable
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {shown}
          </Text>
          <Text style={life.kind === 'live' ? styles.life : styles.lifeWarn}>{lifeLabel}</Text>
        </View>

        {qr ? (
          <View style={styles.qrBox}>
            <Svg width={QR_PIXELS} height={QR_PIXELS} viewBox={`0 0 ${span} ${span}`}>
              {/* The quiet zone has to be painted, not assumed: this
                  card sits on a tinted surface and a QR flush against
                  it is one a camera will not lock onto. */}
              <Rect x={0} y={0} width={span} height={span} fill="#FFFFFF" />
              <Path d={path} fill="#000000" transform={`translate(${QUIET}, ${QUIET})`} />
            </Svg>
            <Text style={styles.qrCaption}>扫码打开输入页</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.steps}>
        医生那边要做两件事：打开{qr ? '扫码得到的' : ' 本站的 '}取件页，输入上面的取件码，
        再输入你的出生日期（8 位数字）。出生日期是用来确认他打开的是你的记录。
      </Text>
      <Text style={styles.warn}>
        这个取件码只显示这一次，关掉就看不到了。被取走一次就失效；出生日期输错 {attempts} 次也会作废
        —— 都可以当场再生成一个。
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLOR.surfaceAccent,
    borderRadius: 10,
    padding: 14,
    marginTop: 12,
    marginBottom: 12,
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
    color: COLOR.ink,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  codeBlock: {
    flex: 1,
  },
  /**
   * 30px, monospace, tabular. Read out loud from a phone held at
   * someone else's reading distance, by a person whose face and
   * shoulders this disease has already weakened — 「读大一点」 is not a
   * style preference here.
   */
  code: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: 2,
    fontWeight: '700',
    color: COLOR.ink,
  },
  life: {
    fontSize: 12.5,
    lineHeight: 18,
    color: COLOR.inkMuted,
    marginTop: 4,
  },
  /** Expired and unknown are not the quiet grey the countdown gets: the
   *  patient is about to read this code out to someone. */
  lifeWarn: {
    fontSize: 12.5,
    lineHeight: 18,
    color: COLOR.warn,
    fontWeight: '600',
    marginTop: 4,
  },
  qrBox: {
    alignItems: 'center',
  },
  qrCaption: {
    fontSize: 11.5,
    color: COLOR.inkMuted,
    marginTop: 4,
  },
  steps: {
    fontSize: 13,
    lineHeight: 20,
    color: COLOR.inkSoft,
    marginTop: 12,
  },
  warn: {
    fontSize: 12.5,
    lineHeight: 19,
    color: COLOR.inkMuted,
    marginTop: 8,
  },
});

export default PickupCodeCard;
