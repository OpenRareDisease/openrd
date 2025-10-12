

import { StyleSheet, Platform } from 'react-native';

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F23',
  },
  backgroundGradient: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 80,
  },
  
  // 顶部标题栏
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  clinicalPassportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    ...Platform.select({
      ios: {
        shadowColor: '#969FFF',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  clinicalPassportText: {
    fontSize: 12,
    color: '#FFFFFF',
  },
  dataEntryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#969FFF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  dataEntryText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '500',
  },

  // 临床护照概览卡片
  passportSection: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  passportCard: {
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  passportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  passportTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  passportId: {
    fontSize: 12,
    color: '#969FFF',
    fontWeight: '500',
  },
  passportGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  passportItem: {
    width: '48%',
    alignItems: 'center',
  },
  passportLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  passportValue: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
  },

  // 时间轴
  timelineSection: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  timelineTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  filterText: {
    fontSize: 12,
    color: '#969FFF',
  },
  timelineContainer: {
    gap: 24,
  },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  timelineLeft: {
    alignItems: 'center',
    position: 'relative',
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    ...Platform.select({
      ios: {
        shadowColor: '#969FFF',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  timelineLine: {
    position: 'absolute',
    top: 12,
    width: 2,
    height: 48,
  },
  eventContent: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    ...Platform.select({
      ios: {
        shadowColor: '#969FFF',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  eventTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  eventDate: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  eventDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 4,
  },
  eventDetails: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 6,
  },
  muscleDetail: {
    flex: 1,
    alignItems: 'center',
  },
  muscleName: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 2,
  },
  muscleStrength: {
    fontSize: 12,
    fontWeight: '500',
    color: '#969FFF',
  },
  eventStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
  },

  // 风险预警
  riskAlertSection: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  riskAlertTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  alertsContainer: {
    gap: 6,
  },
  mainAlertCard: {
    backgroundColor: 'rgba(255, 159, 64, 0.1)',
    borderRadius: 8,
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#FF9F43',
    marginBottom: 8,
  },
  alertHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  alertIconContainer: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 159, 64, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  alertContent: {
    flex: 1,
  },
  alertTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  alertTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  alertLevel: {
    fontSize: 12,
    fontWeight: '500',
  },
  alertDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 4,
  },
  alertAction: {
    fontSize: 12,
    fontWeight: '500',
  },
  secondaryAlertCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 8,
    borderLeftWidth: 2,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    ...Platform.select({
      ios: {
        shadowColor: '#969FFF',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  secondaryAlertContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  secondaryAlertIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryAlertText: {
    flex: 1,
  },
  secondaryAlertTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  secondaryAlertDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
  },
});

