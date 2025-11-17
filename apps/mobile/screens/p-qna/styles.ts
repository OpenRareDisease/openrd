import { StyleSheet, Platform } from 'react-native';

export default StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F23',
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
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    color: '#FFFFFF',
    fontSize: 14,
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
  searchButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#969FFF',
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
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 12,
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
  searchResultHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  searchResultIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(150, 159, 255, 0.2)',
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
    color: '#FFFFFF',
    marginBottom: 4,
  },
  searchResultAnswer: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 18,
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
    color: '#FFFFFF',
    marginBottom: 8,
  },
  viewAllButton: {
    fontSize: 12,
    color: '#969FFF',
  },
  hotQuestionsList: {
    gap: 8,
  },
  questionItem: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 8,
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
  questionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  questionText: {
    flex: 1,
    fontSize: 12,
    color: '#FFFFFF',
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
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 18,
  },
  knowledgeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  knowledgeItem: {
    width: '48%',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 8,
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
    color: '#FFFFFF',
  },
  knowledgeDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  resourcesList: {
    gap: 8,
  },
  resourceCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 8,
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
    color: '#FFFFFF',
    marginBottom: 2,
  },
  resourceDistance: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    marginBottom: 2,
  },
  resourceDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  resourceRating: {
    alignItems: 'flex-end',
  },
  resourceRatingText: {
    fontSize: 12,
    color: '#10B981',
    marginBottom: 2,
  },
  resourceType: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  pathwaysList: {
    gap: 8,
  },
  pathwayItem: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 8,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
    color: '#FFFFFF',
  },
  pathwayDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },

  /* ===================== AI 聊天区域样式 ===================== */
  aiSection: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  aiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  aiTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  aiToggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(150, 159, 255, 0.12)',
  },
  aiToggleText: {
    fontSize: 12,
    color: '#969FFF',
  },
  aiChatContainer: {
    marginTop: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    padding: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#969FFF',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.15,
        shadowRadius: 32,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  aiMessagesList: {
    maxHeight: 260,
    marginBottom: 8,
  },
  aiWelcome: {
    padding: 8,
  },
  aiWelcomeText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 18,
  },
  aiMessageContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 8,
  },
  aiUserMessage: {
    alignSelf: 'flex-end',
  },
  aiAssistantMessage: {
    alignSelf: 'flex-start',
  },
  aiAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiUserAvatar: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  aiAssistantAvatar: {
    backgroundColor: 'rgba(150, 159, 255, 0.2)',
  },
  aiAvatarText: {
    fontSize: 14,
  },
  aiMessageBubble: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  aiUserBubble: {
    backgroundColor: 'rgba(150, 159, 255, 0.3)',
  },
  aiAssistantBubble: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  aiMessageText: {
    fontSize: 12,
    lineHeight: 18,
  },
  aiUserText: {
    color: '#FFFFFF',
  },
  aiAssistantText: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  aiTypingText: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    fontStyle: 'italic',
  },
  aiInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.08)',
  },
  aiTextInput: {
    flex: 1,
    maxHeight: 100,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    color: '#FFFFFF',
    fontSize: 12,
  },
  aiSendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#969FFF',
  },
  aiSendButtonDisabled: {
    opacity: 0.4,
  },
});
