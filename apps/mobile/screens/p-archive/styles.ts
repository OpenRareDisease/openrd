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
  section: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 12,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#D1D5DB',
    marginBottom: 12,
  },
  sectionTitleAccent: {
    color: '#E0E4FF',
    letterSpacing: 0.5,
  },
  stateContainer: {
    marginHorizontal: 24,
    marginBottom: 24,
    padding: 24,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    gap: 12,
  },
  stateText: {
    color: '#FFFFFF',
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#969FFF',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontWeight: '500',
    fontSize: 13,
  },
  profileCard: {
    marginHorizontal: 24,
    marginBottom: 24,
    padding: 20,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    gap: 8,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  profileMeta: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  editButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#969FFF',
  },
  editButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '500',
  },
  emptyCard: {
    padding: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  emptyText: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  radarCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    marginBottom: 12,
  },
  chartCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  chart: {
    borderRadius: 12,
    marginLeft: -12,
  },
  chartLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  chartLegendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#969FFF',
    marginRight: 6,
  },
  chartLegendText: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  measurementCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    width: '100%',
  },
  measurementMuscle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  measurementDate: {
    color: '#9CA3AF',
    fontSize: 12,
    marginTop: 4,
  },
  measurementScore: {
    fontSize: 20,
    fontWeight: '600',
    color: '#969FFF',
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
  passportHint: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    paddingVertical: 12,
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
  timelineToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  timelineHint: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  timelineToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timelineToggleText: {
    fontSize: 12,
    color: '#969FFF',
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
  eventHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  eventChevron: {
    marginLeft: 6,
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
