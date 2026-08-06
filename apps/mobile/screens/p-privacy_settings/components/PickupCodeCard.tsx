import { useMemo } from 'react';
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
 */
export type PickupCodeCardProps = {
  code: string;
  qrUrl: string | null;
  /** Whole minutes left, already rounded by the caller so this stays a
   *  pure render and does not need a clock of its own. */
  minutesLeft: number;
};

/** Quiet zone, in modules. The standard asks for four, and a QR with
 *  no margin against a coloured card is one a camera hunts for. */
const QUIET = 4;
const QR_PIXELS = 132;

const PickupCodeCard = ({ code, qrUrl, minutesLeft }: PickupCodeCardProps) => {
  const qr = useMemo(() => (qrUrl ? buildQrMatrix(qrUrl) : null), [qrUrl]);
  const path = useMemo(() => (qr ? qrPath(qr) : ''), [qr]);
  const span = qr ? qr.size + QUIET * 2 : 0;
  const shown = formatPickupCode(code);

  return (
    <View
      style={styles.card}
      accessible
      accessibilityRole="summary"
      // Spelled out with separators so a screen reader does not run the
      // eight characters together — this is read aloud to a doctor.
      accessibilityLabel={`取件码 ${code.split('').join(' ')}，约 ${minutesLeft} 分钟内有效，只能用一次`}
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
          <Text style={styles.life}>约 {minutesLeft} 分钟内有效 · 只能用一次</Text>
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
        这个取件码只显示这一次，关掉就看不到了。被取走一次就失效；出生日期输错 {PICKUP_MAX_ATTEMPTS}{' '}
        次也会作废 —— 都可以当场再生成一个。
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
