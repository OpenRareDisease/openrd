import { StyleSheet } from 'react-native';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, HAIRLINE, RADIUS, SPACE, TYPE } from '../../lib/design';

/**
 * 隐私 / 审计记录 — re-pitched on lib/design.ts.
 *
 * This screen is a log, and the previous version refused to look like
 * one. Every entry was a 14pt-radius bordered card floating on a
 * second background colour, and inside each card the metadata was
 * broken into a scatter of bordered mini-chips — a card of cards of
 * cards. Two entries filled the viewport, so the one thing a log is
 * for (scanning down a column and spotting the odd row) was
 * impossible.
 *
 * A log is a ledger: full-bleed rows separated by hairlines, a fixed
 * label column so 调用工具 / 使用字段 line up down the page, and
 * tabular figures so timestamps and latencies form real columns. No
 * card, no fill, no shadow anywhere on this screen — the only colour
 * spent is the status chip and the stripe beside an error, which is
 * exactly what the eye should be hunting for.
 */
export default StyleSheet.create({
  /** Replaces the margins the old chip row carried itself. */
  filterControl: {
    marginBottom: SPACE.md,
  },
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },

  /* Header — a rule, not a raised bar ----------------------------- */
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.gutter,
    paddingVertical: SPACE.md,
    // Was a raised surface with an iOS shadow + Android elevation.
    // Nothing here floats over the content, so a hairline states the
    // boundary at a fraction of the visual cost.
    borderBottomWidth: HAIRLINE,
    borderBottomColor: COLOR.line,
  },
  headerTitle: {
    ...TYPE.heading,
  },
  headerPlaceholder: {
    // Balances the back button so the title stays optically centred.
    width: MIN_TOUCH_TARGET,
  },

  /* Tabs ----------------------------------------------------------- */
  tabRow: {
    flexDirection: 'row',
    borderBottomWidth: HAIRLINE,
    borderBottomColor: COLOR.line,
  },
  tabButton: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    // The underline is the selection indicator; it must not shift the
    // row when it appears, so the inactive state keeps the same 2pt.
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: COLOR.accent,
  },
  tabButtonText: {
    ...TYPE.label,
    color: COLOR.inkMuted,
  },
  tabButtonTextActive: {
    color: COLOR.ink,
    fontWeight: '700',
  },

  /* Explanatory note ---------------------------------------------- */
  helpBlock: {
    paddingHorizontal: SPACE.gutter,
    paddingTop: SPACE.md,
    paddingBottom: SPACE.sm,
  },
  helpText: {
    ...TYPE.caption,
    fontSize: 12,
    lineHeight: 18,
  },

  /* Filters -------------------------------------------------------- */

  scrollContent: {
    paddingBottom: SPACE.xxl,
  },

  /* One log row ---------------------------------------------------- */
  entry: {
    paddingHorizontal: SPACE.gutter,
    paddingVertical: SPACE.md,
    gap: SPACE.xs,
    // Rows on the page, ruled off from each other. Replaces a bordered
    // + rounded + separately-backgrounded card per entry.
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  entryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
  },
  /** The timestamp is what you scan by, so it gets the row's weight. */
  entryTime: {
    ...TYPE.heading,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  /** Same slot on the consent tab, where the flag name leads. */
  entryTitle: {
    ...TYPE.heading,
    fontSize: 14,
    flexShrink: 1,
  },

  /** Status / provenance. The one place a pill still means something. */
  statusChip: {
    paddingHorizontal: SPACE.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    borderWidth: HAIRLINE,
  },
  statusChipText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
  },

  /** 同意等级 / 模式 / 是否用到个人数据 — one dot-separated line
   *  instead of three bordered chips. */
  metaText: {
    ...TYPE.caption,
    fontSize: 12,
    lineHeight: 18,
  },
  metaAccent: {
    color: COLOR.accent,
    fontWeight: '600',
  },

  /** Label column + value column. The fixed label width is the point:
   *  it makes 调用工具 / 使用字段 align down the whole list. */
  defRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.sm,
    marginTop: 2,
  },
  defLabel: {
    width: 52,
    fontSize: 11,
    lineHeight: 18,
    fontWeight: '600',
    color: COLOR.inkMuted,
  },
  defValue: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: COLOR.inkSoft,
    fontVariant: ['tabular-nums'],
  },
  /** A failed tool call, inline in the value column. */
  defValueAlert: {
    color: COLOR.alert,
    fontWeight: '600',
  },

  /* Error detail / note — a stripe, not a tinted box ---------------- */
  noteRow: {
    flexDirection: 'row',
    gap: SPACE.sm,
    marginTop: SPACE.xs,
  },
  noteStripe: {
    width: 2,
    alignSelf: 'stretch',
    borderRadius: 1,
    backgroundColor: COLOR.lineStrong,
  },
  noteStripeAlert: {
    backgroundColor: COLOR.alert,
  },
  noteText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: COLOR.inkSoft,
  },

  /* Provenance footer ---------------------------------------------- */
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACE.sm,
    marginTop: SPACE.xs,
  },
  footText: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 16,
    color: COLOR.inkFaint,
    fontVariant: ['tabular-nums'],
  },
  footTextRight: {
    fontSize: 11,
    lineHeight: 16,
    color: COLOR.inkFaint,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },

  /* Consent transition — 关 → 开 ----------------------------------- */
  transitionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  transitionFrom: {
    ...TYPE.metricSmall,
    fontSize: 15,
    lineHeight: 20,
    color: COLOR.inkFaint,
  },
  /** The new value is the news; colour and weight go here. */
  transitionTo: {
    ...TYPE.metricSmall,
    fontSize: 15,
    lineHeight: 20,
  },

  /* Loading / empty / error ---------------------------------------- */
  stateBlock: {
    paddingVertical: 56,
    paddingHorizontal: SPACE.xl,
    alignItems: 'center',
    gap: SPACE.md,
  },
  stateText: {
    ...TYPE.caption,
    textAlign: 'center',
    lineHeight: 20,
  },
});
