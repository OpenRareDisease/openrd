import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';
import { ApiError, getMyPatientProfile } from '../../lib/api';

const ClinicalPassportScreen = () => {
  const router = useRouter();

  // 展开状态管理
  const [isGeneticExpanded, setIsGeneticExpanded] = useState(false);
  const [isStrengthExpanded, setIsStrengthExpanded] = useState(false);
  const [isMriExpanded, setIsMriExpanded] = useState(false);
  const [isBloodExpanded, setIsBloodExpanded] = useState(false);

  const [profile, setProfile] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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
      await new Promise((resolve) => setTimeout(resolve, 2000));

      Alert.alert('导出成功', 'PDF档案已生成，请查收！', [{ text: '确定', style: 'default' }]);
    } catch (error) {
      Alert.alert('导出失败', 'PDF生成过程中出现错误，请重试。', [
        { text: '确定', style: 'default' },
      ]);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    const loadProfile = async () => {
      try {
        setIsLoading(true);
        setErrorMessage(null);
        const data = await getMyPatientProfile();
        if (!isMounted) {
          return;
        }
        setProfile(data);
      } catch (error) {
        if (!isMounted) return;
        const message = error instanceof ApiError ? error.message : '无法获取档案数据';
        setErrorMessage(message);
        setProfile(null);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadProfile();
    return () => {
      isMounted = false;
    };
  }, []);

  const hasRecordedData = useMemo(() => {
    if (!profile) return false;
    return Boolean(
      (profile.measurements?.length ?? 0) > 0 ||
        (profile.activityLogs?.length ?? 0) > 0 ||
        (profile.documents?.length ?? 0) > 0,
    );
  }, [profile]);

  const passportId = useMemo(() => {
    if (!profile?.id) return 'FSHD-UNASSIGNED';
    const compact = profile.id.replace(/-/g, '').slice(0, 10).toUpperCase();
    return `FSHD-${compact}`;
  }, [profile]);

  const renderExpandableSection = (
    title: string,
    subtitle: string,
    icon: string,
    iconColor: string,
    iconBgColor: string,
    isExpanded: boolean,
    onToggle: () => void,
    children: React.ReactNode,
  ) => (
    <View style={styles.expandableCard}>
      <TouchableOpacity style={styles.expandableHeader} onPress={onToggle} activeOpacity={0.7}>
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
            { transform: [{ rotate: isExpanded ? '180deg' : '0deg' }] },
          ]}
        />
      </TouchableOpacity>
      {isExpanded && <View style={styles.expandableContent}>{children}</View>}
    </View>
  );

  const renderGeneticContent = () => (
    <View style={styles.geneticContent}>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>基因类型</Text>
        <Text style={styles.infoValue}>—</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>D4Z4重复数</Text>
        <Text style={styles.infoValue}>—</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>甲基化值</Text>
        <Text style={styles.infoValue}>—</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>诊断日期</Text>
        <Text style={styles.infoValue}>—</Text>
      </View>
    </View>
  );

  const renderStrengthContent = () => (
    <View style={styles.strengthContent}>
      <View style={styles.strengthItem}>
        <View style={styles.strengthItemHeader}>
          <Text style={styles.strengthDate}>最近记录</Text>
          <Text style={styles.strengthAverage}>平均分: —</Text>
        </View>
        <Text style={styles.strengthDetails}>暂无可用的肌力评估摘要</Text>
      </View>
    </View>
  );

  const renderMriContent = () => (
    <View style={styles.mriContent}>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>最近MRI</Text>
        <Text style={styles.infoValue}>—</Text>
      </View>
      <Text style={styles.strengthDetails}>暂无MRI分析数据</Text>
    </View>
  );

  const renderBloodContent = () => (
    <View style={styles.bloodContent}>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>最近血检</Text>
        <Text style={styles.infoValue}>—</Text>
      </View>
      <Text style={styles.strengthDetails}>暂无血检摘要</Text>
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

          {isLoading && (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color="#969FFF" />
            </View>
          )}

          {errorMessage && !isLoading && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{errorMessage}</Text>
            </View>
          )}

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
                <Text style={styles.passportIdText}>{hasRecordedData ? passportId : '—'}</Text>
              </View>
              <Text style={styles.passportIdDescription}>
                {hasRecordedData ? '唯一标识您的FSHD医疗档案' : '录入数据以获得临床护照'}
              </Text>
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
              renderGeneticContent(),
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
              renderStrengthContent(),
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
              renderMriContent(),
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
              renderBloodContent(),
            )}
          </View>

          {/* 导出PDF按钮 */}
          <View style={styles.exportSection}>
            <TouchableOpacity
              style={styles.exportButton}
              onPress={handleExportPdf}
              disabled={isExporting || !hasRecordedData}
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
