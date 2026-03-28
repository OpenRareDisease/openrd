import { Platform, StyleSheet } from 'react-native';
import { CLINICAL_COLORS, CLINICAL_TINTS } from '../../lib/clinical-visuals';

const cardShadow = Platform.select({
  ios: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 30,
  },
  android: {
    elevation: 8,
  },
});

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CLINICAL_COLORS.background,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CLINICAL_COLORS.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 11,
    letterSpacing: 1.2,
  },
  headerTitle: {
    marginTop: 2,
    color: CLINICAL_COLORS.text,
    fontSize: 18,
    fontWeight: '800',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  heroCard: {
    borderRadius: 24,
    padding: 20,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    marginBottom: 14,
    ...cardShadow,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  kindPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: CLINICAL_TINTS.accentStrong,
  },
  kindPillText: {
    color: CLINICAL_COLORS.accentStrong,
    fontSize: 12,
    fontWeight: '700',
  },
  statusText: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  heroTitle: {
    color: CLINICAL_COLORS.text,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
  },
  heroDescription: {
    marginTop: 8,
    color: CLINICAL_COLORS.textSoft,
    fontSize: 12,
    lineHeight: 18,
  },
  highlightGrid: {
    marginTop: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  highlightItem: {
    width: '47%',
    padding: 12,
    borderRadius: 16,
    backgroundColor: CLINICAL_COLORS.panelMuted,
  },
  highlightLabel: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
  },
  highlightValue: {
    marginTop: 6,
    color: CLINICAL_COLORS.text,
    fontSize: 15,
    fontWeight: '700',
  },
  card: {
    borderRadius: 22,
    padding: 18,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    marginBottom: 14,
    ...cardShadow,
  },
  sectionHeader: {
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    color: CLINICAL_COLORS.text,
    fontSize: 16,
    fontWeight: '800',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: 8,
  },
  toggleChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: CLINICAL_COLORS.overlay,
  },
  toggleChipActive: {
    backgroundColor: CLINICAL_TINTS.accentSoft,
    borderWidth: 1,
    borderColor: CLINICAL_TINTS.accentBorder,
  },
  toggleChipText: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  toggleChipTextActive: {
    color: CLINICAL_COLORS.text,
  },
  tagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  summaryTag: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: CLINICAL_TINTS.accentSurface,
  },
  summaryTagText: {
    color: CLINICAL_COLORS.textSoft,
    fontSize: 12,
  },
  structuredGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  structuredItem: {
    width: '47%',
    padding: 12,
    borderRadius: 16,
    backgroundColor: CLINICAL_COLORS.panelMuted,
  },
  structuredLabel: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
  },
  structuredValue: {
    marginTop: 6,
    color: CLINICAL_COLORS.text,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '700',
  },
  button: {
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CLINICAL_COLORS.accent,
  },
  buttonText: {
    color: CLINICAL_COLORS.text,
    fontWeight: '800',
  },
  summaryText: {
    color: CLINICAL_COLORS.textSoft,
    fontSize: 14,
    lineHeight: 21,
  },
  smallText: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  codeBlock: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
  },
  codeText: {
    color: CLINICAL_COLORS.textSoft,
    fontSize: 12,
    lineHeight: 16,
  },
  toggleLink: {
    marginTop: 8,
  },
  toggleLinkText: {
    color: CLINICAL_COLORS.accent,
    fontSize: 13,
    fontWeight: '700',
  },
  inlineState: {
    marginTop: 4,
    alignItems: 'center',
    gap: 8,
  },
});
