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
});
