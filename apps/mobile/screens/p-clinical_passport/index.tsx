

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';

const ClinicalPassportScreen = () => {
  const router = useRouter();
  
  // 展开状态管理
  const [isGeneticExpanded, setIsGeneticExpanded] = useState(false);
  const [isStrengthExpanded, setIsStrengthExpanded] = useState(false);
  const [isMriExpanded, setIsMriExpanded] = useState(false);
  const [isBloodExpanded, setIsBloodExpanded] = useState(false);
  
  // 导出PDF状态
  const [isExporting, setIsExporting] = useState(false);

  const handleBackPress = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  const handleExportPdf = async () => {
    setIsExporting(true);
    
    try {
      // 模拟PDF生成过程
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      Alert.alert(
        '导出成功',
        'PDF档案已生成，请查收！',
        [{ text: '确定', style: 'default' }]
      );
    } catch (error) {
      Alert.alert(
        '导出失败',
        'PDF生成过程中出现错误，请重试。',
        [{ text: '确定', style: 'default' }]
      );
    } finally {
      setIsExporting(false);
    }
  };

  const renderExpandableSection = (
    title: string,
    subtitle: string,
    icon: string,
    iconColor: string,
    iconBgColor: string,
    isExpanded: boolean,
    onToggle: () => void,
    children: React.ReactNode
  ) => (
    <View style={styles.expandableCard}>
      <TouchableOpacity 
        style={styles.expandableHeader} 
        onPress={onToggle}
        activeOpacity={0.7}
      >
        <View style={styles.expandableHeaderLeft}>
          <View style={[styles.expandableIconContainer, { backgroundColor: iconBgColor }]}>
            <FontAwesome6 name={icon} size={14} color={iconColor} />
          </View>
          <View style={styles.expandableHeaderText}>
            <Text style={styles.expandableTitle}>{title}</Text>
            <Text style={styles.expandableSubtitle}>{subtitle}</Text>
          </View>
        </View>
        <FontAwesome6 
          name="chevron-down" 
          size={12} 
          color="rgba(255, 255, 255, 0.5)" 
          style={[
            styles.expandableArrow,
            { transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] }
          ]}
        />
      </TouchableOpacity>
      {isExpanded && (
        <View style={styles.expandableContent}>
          {children}
        </View>
      )}
    </View>
  );

  const renderGeneticContent = () => (
    <View style={styles.geneticContent}>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>基因类型</Text>
        <Text style={styles.infoValue}>FSHD1</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>D4Z4重复数</Text>
        <Text style={styles.infoValue}>8</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>甲基化值</Text>
        <Text style={styles.infoValue}>0.35</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>诊断日期</Text>
        <Text style={styles.infoValue}>2023-06-15</Text>
      </View>
    </View>
  );

  const renderStrengthContent = () => (
    <View style={styles.strengthContent}>
      <View style={styles.strengthItem}>
        <View style={styles.strengthItemHeader}>
          <Text style={styles.strengthDate}>2024-01-15</Text>
          <Text style={styles.strengthAverage}>平均分: 4.2</Text>
        </View>
        <Text style={styles.strengthDetails}>三角肌:4.0 | 肱二头肌:4.5 | 股四头肌:4.3 | 胫前肌:4.0</Text>
      </View>
      <View style={[styles.strengthItem, { borderLeftColor: '#5147FF' }]}>
        <View style={styles.strengthItemHeader}>
          <Text style={styles.strengthDate}>2023-12-20</Text>
          <Text style={[styles.strengthAverage, { color: '#5147FF' }]}>平均分: 4.3</Text>
        </View>
        <Text style={styles.strengthDetails}>三角肌:4.2 | 肱二头肌:4.5 | 股四头肌:4.4 | 胫前肌:4.1</Text>
      </View>
      <View style={[styles.strengthItem, { borderLeftColor: '#3E3987' }]}>
        <View style={styles.strengthItemHeader}>
          <Text style={styles.strengthDate}>2023-11-10</Text>
          <Text style={[styles.strengthAverage, { color: '#3E3987' }]}>平均分: 4.4</Text>
        </View>
        <Text style={styles.strengthDetails}>三角肌:4.3 | 肱二头肌:4.5 | 股四头肌:4.5 | 胫前肌:4.3</Text>
      </View>
    </View>
  );

  const renderMriContent = () => (
    <View style={styles.mriContent}>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>最近MRI</Text>
        <Text style={styles.infoValue}>2024-01-10</Text>
      </View>
      <View style={styles.mriMuscleList}>
        <View style={styles.mriMuscleItem}>
          <Text style={styles.infoLabel}>前锯肌</Text>
          <View style={styles.mriProgressContainer}>
            <View style={styles.mriProgressBar}>
              <View style={[styles.mriProgressFill, { width: '50%', backgroundColor: '#F59E0B' }]} />
            </View>
            <Text style={styles.mriGrade}>2级</Text>
          </View>
        </View>
        <View style={styles.mriMuscleItem}>
          <Text style={styles.infoLabel}>三角肌</Text>
          <View style={styles.mriProgressContainer}>
            <View style={styles.mriProgressBar}>
              <View style={[styles.mriProgressFill, { width: '25%', backgroundColor: '#10B981' }]} />
            </View>
            <Text style={styles.mriGrade}>1级</Text>
          </View>
        </View>
        <View style={styles.mriMuscleItem}>
          <Text style={styles.infoLabel}>肱二头肌</Text>
          <View style={styles.mriProgressContainer}>
            <View style={styles.mriProgressBar}>
              <View style={[styles.mriProgressFill, { width: '25%', backgroundColor: '#10B981' }]} />
            </View>
            <Text style={styles.mriGrade}>1级</Text>
          </View>
        </View>
      </View>
    </View>
  );

  const renderBloodContent = () => (
    <View style={styles.bloodContent}>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>最近血检</Text>
        <Text style={styles.infoValue}>2024-01-05</Text>
      </View>
      <View style={styles.bloodGrid}>
        <View style={styles.bloodItem}>
          <Text style={styles.bloodItemTitle}>ALT</Text>
          <Text style={[styles.bloodItemValue, { color: '#10B981' }]}>32 U/L</Text>
          <Text style={styles.bloodItemStatus}>正常</Text>
        </View>
        <View style={styles.bloodItem}>
          <Text style={styles.bloodItemTitle}>AST</Text>
          <Text style={[styles.bloodItemValue, { color: '#10B981' }]}>28 U/L</Text>
          <Text style={styles.bloodItemStatus}>正常</Text>
        </View>
        <View style={styles.bloodItem}>
          <Text style={styles.bloodItemTitle}>CK</Text>
          <Text style={[styles.bloodItemValue, { color: '#F59E0B' }]}>380 U/L</Text>
          <Text style={styles.bloodItemStatus}>轻度升高</Text>
        </View>
        <View style={styles.bloodItem}>
          <Text style={styles.bloodItemTitle}>LDH</Text>
          <Text style={[styles.bloodItemValue, { color: '#10B981' }]}>220 U/L</Text>
          <Text style={styles.bloodItemStatus}>正常</Text>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#0F0F23', '#1A1A3A', '#0F0F23']}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.backgroundGradient}
      >
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* 顶部导航栏 */}
          <View style={styles.header}>
            <TouchableOpacity 
              style={styles.backButton} 
              onPress={handleBackPress}
              activeOpacity={0.7}
            >
              <FontAwesome6 name="arrow-left" size={12} color="rgba(255, 255, 255, 0.7)" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>FSHD临床护照</Text>
            <View style={styles.headerPlaceholder} />
          </View>

          {/* 临床护照ID卡片 */}
          <View style={styles.passportIdSection}>
            <View style={styles.passportIdCard}>
              <LinearGradient
                colors={['#969FFF', '#5147FF']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.passportIdIcon}
              >
                <FontAwesome6 name="id-card" size={18} color="#FFFFFF" />
              </LinearGradient>
              <Text style={styles.passportIdTitle}>临床护照ID</Text>
              <View style={styles.passportIdContainer}>
                <Text style={styles.passportIdText}>FSHD-2024-001-0001</Text>
              </View>
              <Text style={styles.passportIdDescription}>唯一标识您的FSHD医疗档案</Text>
            </View>
          </View>

          {/* 基因信息 */}
          <View style={styles.section}>
            {renderExpandableSection(
              '基因信息',
              'FSHD分型与分子诊断',
              'dna',
              '#3E3987',
              'rgba(62, 57, 135, 0.2)',
              isGeneticExpanded,
              () => setIsGeneticExpanded(!isGeneticExpanded),
              renderGeneticContent()
            )}
          </View>

          {/* 肌力评估摘要 */}
          <View style={styles.section}>
            {renderExpandableSection(
              '肌力评估摘要',
              '最近3次评估结果',
              'chart-line',
              '#10B981',
              'rgba(16, 185, 129, 0.2)',
              isStrengthExpanded,
              () => setIsStrengthExpanded(!isStrengthExpanded),
              renderStrengthContent()
            )}
          </View>

          {/* MRI影像分析 */}
          <View style={styles.section}>
            {renderExpandableSection(
              'MRI影像分析',
              '肌肉脂肪化程度评估',
              'images',
              '#3B82F6',
              'rgba(59, 130, 246, 0.2)',
              isMriExpanded,
              () => setIsMriExpanded(!isMriExpanded),
              renderMriContent()
            )}
          </View>

          {/* 血检报告摘要 */}
          <View style={styles.section}>
            {renderExpandableSection(
              '血检报告摘要',
              '肝功能、肌酶等关键指标',
              'tint',
              '#EF4444',
              'rgba(239, 68, 68, 0.2)',
              isBloodExpanded,
              () => setIsBloodExpanded(!isBloodExpanded),
              renderBloodContent()
            )}
          </View>

          {/* 导出PDF按钮 */}
          <View style={styles.exportSection}>
            <TouchableOpacity 
              style={styles.exportButton} 
              onPress={handleExportPdf}
              disabled={isExporting}
              activeOpacity={0.7}
            >
              {!isExporting ? (
                <LinearGradient
                  colors={['#969FFF', '#5147FF']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.exportIcon}
                >
                  <FontAwesome6 name="download" size={14} color="#FFFFFF" />
                </LinearGradient>
              ) : (
                <View style={styles.exportIcon}>
                  <FontAwesome6 name="spinner" size={14} color="#969FFF" />
                </View>
              )}
              <View style={styles.exportTextContainer}>
                <Text style={styles.exportTitle}>导出PDF档案</Text>
                <Text style={styles.exportSubtitle}>生成符合医疗标准的PDF文档</Text>
              </View>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
};

export default ClinicalPassportScreen;

