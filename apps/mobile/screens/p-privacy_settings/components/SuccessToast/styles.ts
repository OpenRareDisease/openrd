import { StyleSheet, Platform } from 'react-native';
import { CLINICAL_COLORS } from '../../../../lib/clinical-visuals';

export default StyleSheet.create({
  toastContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 80,
    paddingHorizontal: 16,
  },
  toastContent: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CLINICAL_COLORS.panel,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    ...Platform.select({
      ios: {
        shadowColor: CLINICAL_COLORS.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  toastMessage: {
    fontSize: 14,
    color: CLINICAL_COLORS.text,
    marginLeft: 8,
  },
});
