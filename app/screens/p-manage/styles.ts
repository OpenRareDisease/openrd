

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  dataEntryButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
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
        elevation: 8,
      },
    }),
  },
  section: {
    marginHorizontal: 24,
    marginBottom: 24,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
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
        elevation: 8,
      },
    }),
  },
  alertCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#fbbf24',
  },
  medicationCard: {
    borderLeftWidth: 3,
    borderLeftColor: '#10b981',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  detailButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  detailButtonText: {
    fontSize: 14,
    color: '#969FFF',
    marginRight: 4,
  },
  radarChartContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  radarChartWrapper: {
    width: 128,
    height: 128,
  },
  radarChart: {
    width: '100%',
    height: '100%',
    borderRadius: 64,
    backgroundColor: '#969FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radarChartCenter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#0F0F23',
    alignItems: 'center',
    justifyContent: 'center',
  },
  averageScore: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#969FFF',
  },
  averageLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  muscleGroupsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  muscleGroupCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  muscleGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  muscleGroupName: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  muscleGroupScore: {
    fontSize: 14,
    fontWeight: '600',
    color: '#969FFF',
  },
  progressBarContainer: {
    width: '100%',
    height: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 3,
  },
  progressBar: {
    height: '100%',
    borderRadius: 3,
  },
  alertHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  alertIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  alertContent: {
    marginTop: 8,
  },
  alertDescription: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 8,
  },
  alertHighlight: {
    color: '#fbbf24',
    fontWeight: '600',
  },
  alertRecommendation: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 12,
  },
  activityStats: {
    flexDirection: 'row',
    gap: 12,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fbbf24',
  },
  statLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  predictionContent: {
    backgroundColor: 'rgba(150, 159, 255, 0.1)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  predictionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  predictionLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  predictionRisk: {
    fontSize: 14,
    fontWeight: '600',
    color: '#969FFF',
  },
  predictionDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    marginBottom: 12,
  },
  riskLevels: {
    flexDirection: 'row',
    gap: 8,
  },
  riskItem: {
    flex: 1,
    alignItems: 'center',
  },
  riskValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  riskLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  interventionButton: {
    width: '100%',
    paddingVertical: 8,
    backgroundColor: 'rgba(150, 159, 255, 0.2)',
    borderRadius: 8,
    alignItems: 'center',
  },
  interventionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#969FFF',
  },
  medicationHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  medicationIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  medicationContent: {
    marginTop: 8,
  },
  medicationStatus: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 12,
  },
  medicationList: {
    gap: 8,
    marginBottom: 12,
  },
  medicationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  medicationName: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  medicationBadge: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  medicationBadgeText: {
    fontSize: 12,
    color: '#10b981',
  },
  liverFunctionCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  liverFunctionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  liverFunctionLabel: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  liverFunctionStatus: {
    fontSize: 14,
    fontWeight: '600',
    color: '#10b981',
  },
  liverFunctionValues: {
    flexDirection: 'row',
    gap: 12,
  },
  liverFunctionValue: {
    flex: 1,
  },
  liverFunctionValueLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  liverFunctionValueText: {
    fontSize: 12,
    color: '#FFFFFF',
    marginLeft: 4,
  },
});

