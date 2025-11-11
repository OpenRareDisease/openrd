

import { StyleSheet, Platform } from 'react-native';

export default StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginHorizontal: 24,
    marginBottom: 12,
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
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerLeft: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  institution: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 6,
  },
  tagsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  phaseBadge: {
    backgroundColor: 'rgba(150, 159, 255, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 12,
  },
  phaseText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#969FFF',
  },
  statusText: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  matchBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  matchBadgeHigh: {
    backgroundColor: '#969FFF',
  },
  matchBadgeMedium: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
  },
  matchBadgeLow: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  matchText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  matchTextHigh: {
    color: '#FFFFFF',
  },
  matchTextMedium: {
    color: '#F59E0B',
  },
  matchTextLow: {
    color: '#EF4444',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginVertical: 8,
  },
  criteriaSection: {
    marginBottom: 8,
  },
  criteriaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  criteriaLabel: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  viewDetailsText: {
    fontSize: 10,
    color: '#969FFF',
  },
  criteriaList: {
    gap: 2,
  },
  criteriaText: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.5)',
    lineHeight: 14,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  infoText: {
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  applyButton: {
    backgroundColor: '#969FFF',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  applyButtonText: {
    fontSize: 10,
    fontWeight: '500',
    color: '#FFFFFF',
  },
});

