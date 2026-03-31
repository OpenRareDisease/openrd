import { Platform, StyleSheet } from 'react-native';
import { CLINICAL_COLORS, CLINICAL_TINTS } from '../../lib/clinical-visuals';

const cardShadow =
  Platform.select({
    ios: {
      shadowColor: '#182B36',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.1,
      shadowRadius: 24,
    },
    android: {
      elevation: 5,
    },
    default: {},
  }) ?? {};

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CLINICAL_COLORS.background,
  },
  backgroundGradient: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
  },
  headerLead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  eyebrow: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 11,
    letterSpacing: 1.1,
  },
  pageTitle: {
    marginTop: 4,
    color: CLINICAL_COLORS.text,
    fontSize: 20,
    fontWeight: '800',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 14,
  },
  heroCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    ...cardShadow,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
  },
  tagPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: CLINICAL_TINTS.accentSoft,
    borderWidth: 1,
    borderColor: CLINICAL_TINTS.accentBorder,
  },
  tagPillText: {
    color: CLINICAL_COLORS.text,
    fontSize: 11,
    fontWeight: '800',
  },
  heroTime: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 12,
  },
  heroTitle: {
    marginTop: 14,
    color: CLINICAL_COLORS.text,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '800',
  },
  heroDescription: {
    marginTop: 8,
    color: CLINICAL_COLORS.textSoft,
    fontSize: 13,
    lineHeight: 20,
  },
  card: {
    borderRadius: 22,
    padding: 16,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    ...cardShadow,
  },
  cardTitle: {
    color: CLINICAL_COLORS.text,
    fontSize: 16,
    fontWeight: '800',
  },
  cardText: {
    marginTop: 10,
    color: CLINICAL_COLORS.textSoft,
    fontSize: 14,
    lineHeight: 22,
  },
  metaGrid: {
    marginTop: 12,
    gap: 10,
  },
  metaCard: {
    borderRadius: 16,
    padding: 14,
    backgroundColor: 'rgba(248, 242, 234, 0.8)',
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
  },
  metaLabel: {
    color: CLINICAL_COLORS.textMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  metaValue: {
    marginTop: 8,
    color: CLINICAL_COLORS.text,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '800',
  },
  primaryAction: {
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: CLINICAL_COLORS.accentStrong,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    ...cardShadow,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
});
