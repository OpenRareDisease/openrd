

import { StyleSheet, Platform } from 'react-native';

export default StyleSheet.create({
  container: {
    marginHorizontal: 24,
    marginBottom: 16,
  },
  dropdown: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#969FFF',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  title: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  formSection: {
    marginBottom: 12,
  },
  label: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 4,
  },
  optionsContainer: {
    gap: 4,
  },
  option: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  selectedOption: {
    backgroundColor: 'rgba(150, 159, 255, 0.2)',
    borderColor: '#969FFF',
  },
  optionText: {
    fontSize: 10,
    color: '#FFFFFF',
  },
  selectedOptionText: {
    color: '#969FFF',
    fontWeight: '500',
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  applyButton: {
    flex: 1,
    backgroundColor: '#969FFF',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  applyButtonText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  resetButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    alignItems: 'center',
  },
  resetButtonText: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.7)',
  },
});

