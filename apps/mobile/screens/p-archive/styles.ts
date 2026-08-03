import { StyleSheet, type TextStyle } from 'react-native';
import { COLOR, HAIRLINE, RADIUS, SPACE, SURFACE, TYPE } from '../../lib/design';

/** Same device as lib/design.ts: annotated so the fontVariant literal
 *  widens to TextStyle's enum rather than `string[]`. */
const TABULAR: TextStyle = { fontVariant: ['tabular-nums'] };

/**
 * 我的档案 + 报告管理 — re-pitched on lib/design.ts.
 *
 * Both screens share this sheet (报告管理 imports it wholesale), so it
 * is written as one vocabulary rather than two.
 *
 * What changed
 * ------------
 * The old sheet stacked eight independent 18–28pt-radius shadowed
 * cards over a gradient page, and nested a second tier of tinted cards
 * inside three of them (console items, report stats, digest items,
 * report dates). Hierarchy came entirely from box nesting, so a
 * patient's actual data — 报告总数, 完整度, 确诊时间 — was set at 12–14pt
 * inside those boxes, smaller and softer than the chrome around it.
 *
 * Now exactly one block is filled: the archive header block, the thing
 * these screens are about. Everything else is set directly on the paper
 * and separated by hairlines, which is what lets the label/value pairs
 * line up into a column the way a record should. Values carry
 * TYPE.metric* with tabular figures; labels recede to TYPE.caption.
 *
 * Also removed: ~56 orphaned keys left behind when the chart section
 * moved to 病程 (timeline*, chart*, trend*, visualizationChart*,
 * summaryCard/Grid/Text, toggle*, background*, focus*, inlineAction*,
 * consoleAction*, card, reportGrid, emptyText). Verified unused by both
 * consumers before deleting.
 */
export default StyleSheet.create({
  /** Replaces the margins the old category chip row carried itself. */
  categoryControl: {
    marginBottom: SPACE.lg,
  },
  container: {
    flex: 1,
    backgroundColor: COLOR.paper,
  },
  /** Kept so a screen can drop <LinearGradient> for a plain <View>
   *  without changing its JSX shape. */
  backgroundGradient: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 120,
  },

  /* Header -------------------------------------------------------- */
  header: {
    paddingHorizontal: SPACE.gutter,
    paddingTop: SPACE.md,
    paddingBottom: SPACE.sm,
    gap: SPACE.md,
  },
  /** ScreenHeader carries the app-wide gutter and vertical rhythm of
   *  its own; `header` above already supplies both, so the shared row
   *  is flattened here rather than paying for the padding twice and
   *  pushing the title off the app's left margin. */
  screenHeaderRow: {
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: SPACE.md,
  },
  /** Same row, but with nothing on the left to balance against — the
   *  page title moved up into ScreenHeader. */
  headerActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: SPACE.md,
  },
  headerLead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    flex: 1,
  },
  /** Whose record this is, set under the title rather than in a
   *  second filled block. */
  pageSubtitle: {
    marginTop: 2,
    ...TYPE.caption,
  },

  /* Sections — set on the page, not boxed --------------------------- */
  crossLinkSection: {
    marginHorizontal: SPACE.gutter,
    marginTop: SPACE.section,
  },
  section: {
    paddingHorizontal: SPACE.gutter,
    marginTop: SPACE.section,
  },
  sectionHeader: {
    marginBottom: SPACE.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  sectionTitle: {
    ...TYPE.title,
  },
  sectionSubtitle: {
    marginTop: SPACE.xs,
    ...TYPE.caption,
  },

  /* The one filled block: who this record belongs to ---------------- */
  heroCard: {
    ...SURFACE.cardAccent,
    padding: SPACE.lg,
  },
  heroTitle: {
    ...TYPE.display,
  },
  /** The passport ID. Tabular so it reads as an identifier. */
  heroMeta: {
    marginTop: SPACE.xs,
    ...TYPE.label,
    color: COLOR.inkMuted,
    ...TABULAR,
  },
  heroSummary: {
    marginTop: SPACE.md,
    ...TYPE.body,
  },

  /* Stat row inside the hero — columns, not nested cards ------------ */
  reportStatGrid: {
    marginTop: SPACE.lg,
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.accentLine,
    flexDirection: 'row',
    gap: SPACE.md,
  },
  reportStatCard: {
    flex: 1,
  },
  /** The number is the point, so it gets the size and the tabular
   *  figures; the label underneath recedes. */
  reportStatValue: {
    ...TYPE.metricSmall,
    fontSize: 21,
    lineHeight: 26,
  },
  reportStatLabel: {
    marginTop: SPACE.xs,
    ...TYPE.caption,
  },

  /* 我的数据资产 ---------------------------------------------------- */
  assetCard: {
    gap: SPACE.md,
  },
  assetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: SPACE.md,
  },
  assetTitle: {
    ...TYPE.title,
  },
  assetPercent: {
    ...TYPE.metric,
  },
  /** A thin instrument bar rather than an 8pt pill — it reports a
   *  measurement, it is not a control. */
  assetProgressTrack: {
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLOR.well,
    overflow: 'hidden',
  },
  assetProgressFill: {
    height: '100%',
    borderRadius: 2.5,
    backgroundColor: COLOR.accent,
  },
  assetGapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  assetGapLead: {
    ...TYPE.caption,
  },
  assetGapDone: {
    ...TYPE.caption,
  },
  assetSignalList: {
    gap: SPACE.xs,
  },
  assetSignalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  assetSignalDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  assetSignalDotOk: {
    backgroundColor: COLOR.good,
  },
  assetSignalDotWarn: {
    backgroundColor: COLOR.warn,
  },
  assetSignalText: {
    flex: 1,
    ...TYPE.caption,
    color: COLOR.inkSoft,
  },

  /* Archive sub-page navigation — rows on the page ------------------ */
  /** Every row carries its own top rule, so the list reads as a table
   *  and needs no surrounding box. */

  /* 档案控制台 — label/value pairs in one aligned column ------------- */
  consoleStack: {
    gap: SPACE.lg,
  },
  consoleCard: {
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.lineStrong,
  },
  consoleTitle: {
    ...TYPE.heading,
    marginBottom: SPACE.xs,
  },
  consoleItemGrid: {
    marginTop: SPACE.xs,
  },
  consoleItemCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: SPACE.md,
    paddingVertical: SPACE.sm,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  /** Fixed width so every value on the screen starts on the same
   *  vertical — the whole reason to use a rule-separated list. */
  consoleItemLabel: {
    width: 84,
    ...TYPE.caption,
  },
  consoleItemValue: {
    flex: 1,
    ...TYPE.bodyStrong,
  },
  consoleItemValueAccent: {
    color: COLOR.accent,
    ...TABULAR,
  },

  /* Cross-link to 病程 ---------------------------------------------- */

  /* 记录摘要 -------------------------------------------------------- */
  visualizationDigestCard: {
    marginTop: SPACE.xs,
  },
  visualizationDigestItem: {
    paddingVertical: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    gap: SPACE.xs,
  },
  visualizationDigestTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: SPACE.md,
    alignItems: 'center',
  },
  visualizationDigestTitle: {
    flex: 1,
    ...TYPE.heading,
  },
  visualizationDigestValue: {
    ...TYPE.metricSmall,
  },
  visualizationDigestText: {
    ...TYPE.caption,
  },
  /** A genuine status chip — the pill shape is the meaning here. */
  summaryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACE.sm,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
  },
  summaryBadgeText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },

  /* 报告管理 — hero stats block ------------------------------------- */
  /** 报告管理's single filled block, the counterpart to `heroCard` on
   *  我的档案. The two screens never render both. */
  reportHeroCard: {
    ...SURFACE.cardAccent,
    padding: SPACE.lg,
  },
  reportHeroMeta: {
    marginTop: SPACE.md,
    paddingTop: SPACE.md,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.accentLine,
    ...TYPE.caption,
  },

  /* 报告管理 — category filter -------------------------------------- */
  /** Selected reads as solid accent, not as another tint — a filter
   *  has to be unambiguous at a glance. */
  /** Plain tabular figures, not a badge inside a chip. */

  /* 报告管理 — one report per rule-separated block ------------------- */
  reportManagerList: {
    marginTop: SPACE.lg,
  },
  reportManagerCard: {
    paddingVertical: SPACE.lg,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
  },
  reportManagerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.sm,
  },
  reportManagerTitle: {
    flex: 1,
    ...TYPE.heading,
  },
  /** A genuine status chip: outlined, so the caller's semantic tone
   *  reads on both the border and the text without a third tint. */
  reportStatusBadge: {
    paddingHorizontal: SPACE.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    borderWidth: HAIRLINE,
    borderColor: COLOR.lineStrong,
  },
  reportStatusBadgeText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    color: COLOR.inkSoft,
  },
  /** 分类 · 类型 on one muted line — they were two pills restating the
   *  same catalog entry. */
  reportManagerMeta: {
    marginTop: SPACE.sm,
    ...TYPE.caption,
  },
  reportDateRow: {
    marginTop: SPACE.md,
    flexDirection: 'row',
    gap: SPACE.xl,
  },
  reportDateCard: {
    flex: 1,
  },
  reportDateLabel: {
    ...TYPE.caption,
  },
  reportDateValue: {
    marginTop: 2,
    ...TYPE.metricSmall,
    fontSize: 16,
    lineHeight: 22,
  },
  reportManagerSummary: {
    marginTop: SPACE.md,
    ...TYPE.body,
    fontSize: 14,
    lineHeight: 21,
  },
  reportFileText: {
    marginTop: SPACE.sm,
    ...TYPE.caption,
    fontSize: 12,
    color: COLOR.inkFaint,
  },
  reportActionRow: {
    marginTop: SPACE.md,
    flexDirection: 'row',
    gap: SPACE.sm,
  },

  /* States ---------------------------------------------------------- */
  /** White, never tinted: the accented hero is the one filled block,
   *  and an error must not compete with it for the same colour. */
  stateWrap: {
    ...SURFACE.card,
    padding: SPACE.lg,
    alignItems: 'flex-start',
    gap: SPACE.md,
  },
  stateText: {
    ...TYPE.body,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACE.md,
    backgroundColor: COLOR.paper,
  },
  loadingText: {
    ...TYPE.caption,
  },
});
