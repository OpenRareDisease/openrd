

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
    paddingBottom: 24,
  },
  
  // 顶部导航栏
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  backButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
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
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  headerPlaceholder: {
    width: 32,
  },

  // 临床护照ID卡片
  passportIdSection: {
    marginHorizontal: 24,
    marginBottom: 16,
  },
  passportIdCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 12,
    alignItems: 'center',
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
  passportIdIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  passportIdTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  passportIdContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginBottom: 8,
  },
  passportIdText: {
    fontSize: 14,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    color: '#969FFF',
    letterSpacing: 1,
    fontWeight: '500',
  },
  passportIdDescription: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
  },

  // 通用section样式
  section: {
    marginHorizontal: 24,
    marginBottom: 12,
  },

  // 可展开卡片样式
  expandableCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 6,
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
  expandableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  expandableHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  expandableIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  expandableHeaderText: {
    flex: 1,
  },
  expandableTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  expandableSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
  expandableArrow: {
    marginLeft: 8,
  },
  expandableContent: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },

  // 基因信息内容
  geneticContent: {
    gap: 8,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  infoLabel: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  infoValue: {
    fontSize: 12,
    fontWeight: '500',
    color: '#FFFFFF',
  },

  // 肌力评估内容
  strengthContent: {
    gap: 12,
  },
  strengthItem: {
    borderLeftWidth: 2,
    borderLeftColor: '#969FFF',
    paddingLeft: 8,
  },
  strengthItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  strengthDate: {
    fontSize: 12,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  strengthAverage: {
    fontSize: 12,
    color: '#969FFF',
  },
  strengthDetails: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },

  // MRI影像分析内容
  mriContent: {
    gap: 8,
  },
  mriMuscleList: {
    gap: 8,
  },
  mriMuscleItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  mriProgressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mriProgressBar: {
    width: 48,
    height: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  mriProgressFill: {
    height: '100%',
    borderRadius: 4,
  },
  mriGrade: {
    fontSize: 12,
    fontWeight: '500',
    color: '#FFFFFF',
  },

  // 血检报告内容
  bloodContent: {
    gap: 8,
  },
  bloodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  bloodItem: {
    width: '48%',
    alignItems: 'center',
  },
  bloodItemTitle: {
    fontSize: 12,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  bloodItemValue: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 2,
  },
  bloodItemStatus: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },

  // 导出PDF按钮
  exportSection: {
    marginHorizontal: 24,
    marginTop: 16,
  },
  exportButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
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
  exportIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  exportTextContainer: {
    flex: 1,
  },
  exportTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  exportSubtitle: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.5)',
  },
});

