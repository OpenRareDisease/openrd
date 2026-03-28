import { StyleSheet, Platform } from 'react-native';
import { CLINICAL_COLORS, CLINICAL_TINTS } from '../../lib/clinical-visuals';

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CLINICAL_COLORS.background,
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    borderRadius: 8,
    color: CLINICAL_COLORS.text,
    fontSize: 14,
    ...Platform.select({
      ios: {
        shadowColor: CLINICAL_COLORS.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  searchButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: CLINICAL_COLORS.accent,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  searchResultContainer: {
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  searchResultCard: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    borderRadius: 8,
    padding: 12,
    ...Platform.select({
      ios: {
        shadowColor: CLINICAL_COLORS.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  searchResultHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  searchResultIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: CLINICAL_TINTS.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  searchResultContent: {
    flex: 1,
  },
  searchResultTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
    marginBottom: 4,
  },
  searchResultAnswer: {
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
    lineHeight: 18,
  },
  progressContainer: {
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  progressTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
  },
  progressStatus: {
    fontSize: 11,
    color: CLINICAL_COLORS.textMuted,
  },
  progressBar: {
    height: 6,
    borderRadius: 999,
    backgroundColor: CLINICAL_TINTS.panelStrong,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: CLINICAL_COLORS.accent,
  },
  progressStages: {
    gap: 6,
  },
  progressStageItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  progressStageDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: CLINICAL_TINTS.disabledTrack,
  },
  progressStageDotActive: {
    backgroundColor: CLINICAL_COLORS.accent,
  },
  progressStageDotDone: {
    backgroundColor: CLINICAL_COLORS.success,
  },
  progressStageDotError: {
    backgroundColor: CLINICAL_COLORS.warning,
  },
  progressStageText: {
    fontSize: 11,
    color: CLINICAL_COLORS.textMuted,
  },
  progressStageTextActive: {
    color: CLINICAL_COLORS.text,
  },
  progressStageTextDone: {
    color: CLINICAL_COLORS.text,
  },
  progressStageTextError: {
    color: CLINICAL_COLORS.warning,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
    marginBottom: 8,
  },
  viewAllButton: {
    fontSize: 12,
    color: CLINICAL_COLORS.accent,
  },
  hotQuestionsList: {
    gap: 8,
  },
  questionItem: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    borderRadius: 8,
    padding: 8,
    ...Platform.select({
      ios: {
        shadowColor: CLINICAL_COLORS.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  questionText: {
    flex: 1,
    fontSize: 12,
    color: CLINICAL_COLORS.text,
    marginRight: 8,
  },
  chevronIcon: {
    transform: [{ rotate: '0deg' }],
  },
  chevronIconExpanded: {
    transform: [{ rotate: '180deg' }],
  },
  answerPanel: {
    marginTop: 4,
  },
  answerText: {
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
    lineHeight: 18,
  },
  knowledgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  knowledgeItem: {
    width: '48%',
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    borderRadius: 8,
    padding: 8,
    ...Platform.select({
      ios: {
        shadowColor: CLINICAL_COLORS.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  knowledgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  knowledgeIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knowledgeTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
  },
  knowledgeDescription: {
    fontSize: 12,
    color: CLINICAL_COLORS.textMuted,
  },
  resourcesList: {
    gap: 8,
  },
  resourceCard: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    borderRadius: 8,
    padding: 8,
    ...Platform.select({
      ios: {
        shadowColor: CLINICAL_COLORS.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  resourceContent: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  resourceIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  resourceInfo: {
    flex: 1,
  },
  resourceName: {
    fontSize: 12,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
    marginBottom: 2,
  },
  resourceDistance: {
    fontSize: 12,
    color: CLINICAL_COLORS.textSoft,
    marginBottom: 2,
  },
  resourceDescription: {
    fontSize: 12,
    color: CLINICAL_COLORS.textMuted,
  },
  resourceRating: {
    alignItems: 'flex-end',
  },
  resourceRatingText: {
    fontSize: 12,
    color: CLINICAL_COLORS.success,
    marginBottom: 2,
  },
  resourceType: {
    fontSize: 12,
    color: CLINICAL_COLORS.textMuted,
  },
  pathwaysList: {
    gap: 8,
  },
  pathwayItem: {
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    borderRadius: 8,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...Platform.select({
      ios: {
        shadowColor: CLINICAL_COLORS.accent,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.1,
        shadowRadius: 32,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  pathwayContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  pathwayIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pathwayInfo: {
    flex: 1,
  },
  pathwayTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: CLINICAL_COLORS.text,
  },
  pathwayDescription: {
    fontSize: 12,
    color: CLINICAL_COLORS.textMuted,
  },
});
