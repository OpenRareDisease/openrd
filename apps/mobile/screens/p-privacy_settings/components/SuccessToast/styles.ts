import { COLOR } from '../../../../lib/design';
import { StyleSheet, Platform } from 'react-native';

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
    backgroundColor: COLOR.surface,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: COLOR.line,
    ...Platform.select({
      ios: {
        shadowColor: COLOR.accent,
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
    color: COLOR.ink,
    marginLeft: 8,
  },
});
