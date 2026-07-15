import { StyleSheet, Platform } from 'react-native';
import { CLINICAL_COLORS } from '../../lib/clinical-visuals';

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CLINICAL_COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    backgroundColor: CLINICAL_COLORS.backgroundRaised,
    borderBottomWidth: 1,
    borderBottomColor: CLINICAL_COLORS.border,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  headerTitle: {
    color: CLINICAL_COLORS.text,
    fontSize: 16,
    fontWeight: '800',
  },
  headerPlaceholder: {
    width: 40,
  },
  filterChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 20,
    marginTop: 10,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    backgroundColor: CLINICAL_COLORS.panel,
  },
  filterChipActive: {
    borderColor: CLINICAL_COLORS.accentStrong,
    backgroundColor: CLINICAL_COLORS.accentStrong,
  },
  filterChipText: {
    color: CLINICAL_COLORS.textSoft,
    fontSize: 12,
    fontWeight: '700',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
});
