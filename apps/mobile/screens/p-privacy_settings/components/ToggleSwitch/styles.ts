import { StyleSheet, Platform } from 'react-native';
import { CLINICAL_COLORS, CLINICAL_TINTS } from '../../../../lib/clinical-visuals';

export default StyleSheet.create({
  toggleSwitch: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: CLINICAL_TINTS.neutralSoft,
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleSwitchActive: {
    backgroundColor: CLINICAL_COLORS.accent,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: CLINICAL_COLORS.text,
    alignSelf: 'flex-start',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 4,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  toggleThumbActive: {
    alignSelf: 'flex-end',
  },
});
