import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';
import { ApiError, getMedications, getMyPatientProfile, getRiskSummary } from '../../lib/api';

const PMANAGE = () => {
  const router = useRouter();
  const MUSCLE_LABELS: Record<string, string> = {
    deltoid: '三角肌',
    biceps: '肱二头肌',
    triceps: '肱三头肌',
    tibialis: '胫骨前肌',
    quadriceps: '股四头肌',
    hamstrings: '腘绳肌',
    gluteus: '臀肌',
  };
  const [profile, setProfile] = useState<any | null>(null);
  const [medications, setMedications] = useState<any[]>([]);
  const [riskSummary, setRiskSummary] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const [profileData, medicationData, riskData] = await Promise.all([
        getMyPatientProfile(),
        getMedications(),
        getRiskSummary(),
      ]);
      setProfile(profileData);
      setMedications(medicationData);
      setRiskSummary(riskData);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '数据加载失败';
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDataEntryPress = () => {
    router.push('/p-data_entry');
  };

  const handleMuscleDetailPress = () => {
    console.log('显示肌力详细数据');
  };

  const handleMuscleGroupPress = (muscleGroup: string) => {
    console.log('查看肌群详细信息:', muscleGroup);
  };

  const handleAlertDetailPress = () => {
    console.log('查看活动预警详情');
  };

  const handlePredictionDetailPress = () => {
    console.log('查看AI预测详情');
  };

  const handleInterventionPlanPress = () => {
    router.push('/p-rehab_share');
  };

  const handleMedicationDetailPress = () => {
    console.log('查看用药安全详情');
  };

  const latestMeasurementsByGroup = useMemo(() => {
    if (!profile?.measurements) return {};
    const map: Record<string, { strengthScore: number; recordedAt: string }> = {};
    profile.measurements.forEach((m: any) => {
      const existing = map[m.muscleGroup];
      if (!existing || new Date(m.recordedAt) > new Date(existing.recordedAt)) {
        map[m.muscleGroup] = { strengthScore: Number(m.strengthScore), recordedAt: m.recordedAt };
      }
    });
    return map;
  }, [profile]);

  const averageStrength = useMemo(() => {
    const values = Object.values(latestMeasurementsByGroup).map((item) => item.strengthScore);
    if (!values.length) return null;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }, [latestMeasurementsByGroup]);

  const formattedLastActivity = useMemo(() => {
    if (!riskSummary?.lastActivityAt) return '暂无记录';
    const date = new Date(riskSummary.lastActivityAt);
    return isNaN(date.getTime()) ? '暂无记录' : date.toLocaleDateString();
  }, [riskSummary]);

  const riskLevelColor = (level: string) => {
    switch (level) {
      case 'high':
        return '#f87171';
      case 'medium':
        return '#fbbf24';
      default:
        return '#10b981';
    }
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
          <ActivityIndicator size="large" color="#969FFF" />
          <Text style={{ color: '#9CA3AF', marginTop: 12 }}>正在加载病程数据...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (errorMessage) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={{ color: '#9CA3AF', marginBottom: 12 }}>{errorMessage}</Text>
          <TouchableOpacity style={styles.dataEntryButton} onPress={loadData}>
            <FontAwesome6 name="arrow-rotate-right" size={14} color="#969FFF" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#0F0F23', '#1A1A3A', '#0F0F23']}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.backgroundGradient}
      >
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* 顶部标题区域 */}
          <View style={styles.header}>
            <Text style={styles.pageTitle}>病程管理</Text>
            <TouchableOpacity style={styles.dataEntryButton} onPress={handleDataEntryPress}>
              <FontAwesome6 name="plus" size={16} color="#969FFF" />
            </TouchableOpacity>
          </View>

          {/* 肌力评估区域 */}
          <View style={styles.section}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>肌力评估</Text>
                <TouchableOpacity onPress={handleMuscleDetailPress}>
                  <View style={styles.detailButton}>
                    <Text style={styles.detailButtonText}>查看详情</Text>
                    <FontAwesome6 name="chevron-right" size={10} color="#969FFF" />
                  </View>
                </TouchableOpacity>
              </View>

              {/* 肌力雷达图 */}
              <View style={styles.radarChartContainer}>
                <View style={styles.radarChartWrapper}>
                  <View style={styles.radarChart}>
                    <View style={styles.radarChartCenter}>
                      <Text style={styles.averageScore}>
                        {averageStrength !== null ? averageStrength.toFixed(1) : '--'}
                      </Text>
                      <Text style={styles.averageLabel}>平均分</Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* 肌群详细数据 */}
              <View style={styles.muscleGroupsGrid}>
                {Object.entries(latestMeasurementsByGroup).length === 0 ? (
                  <Text style={{ color: '#9CA3AF' }}>暂无肌力评估，去录入吧</Text>
                ) : (
                  Object.entries(latestMeasurementsByGroup).map(([group, data]) => {
                    const widthPercent = Math.min(100, (data.strengthScore / 5) * 100);
                    return (
                      <TouchableOpacity
                        key={group}
                        style={styles.muscleGroupCard}
                        onPress={() => handleMuscleGroupPress(group)}
                      >
                        <View style={styles.muscleGroupHeader}>
                          <Text style={styles.muscleGroupName}>
                            {MUSCLE_LABELS[group] || group}
                          </Text>
                          <Text style={[styles.muscleGroupScore, { color: '#969FFF' }]}>
                            {data.strengthScore.toFixed(1)}
                          </Text>
                        </View>
                        <View style={styles.progressBarContainer}>
                          <View
                            style={[
                              styles.progressBar,
                              { width: `${widthPercent}%`, backgroundColor: '#969FFF' },
                            ]}
                          />
                        </View>
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </View>
          </View>

          {/* 异常活动预警 */}
          <View style={styles.section}>
            <View style={[styles.card, styles.alertCard]}>
              <View style={styles.cardHeader}>
                <View style={styles.alertHeaderLeft}>
                  <View style={styles.alertIconContainer}>
                    <FontAwesome6 name="triangle-exclamation" size={14} color="#fbbf24" />
                  </View>
                  <Text style={styles.cardTitle}>活动预警</Text>
                </View>
                <TouchableOpacity onPress={handleAlertDetailPress}>
                  <View style={styles.detailButton}>
                    <Text style={[styles.detailButtonText, { color: '#fbbf24' }]}>查看详情</Text>
                    <FontAwesome6 name="chevron-right" size={10} color="#fbbf24" />
                  </View>
                </TouchableOpacity>
              </View>

              <View style={styles.alertContent}>
                <Text style={styles.alertDescription}>最近活动记录：{formattedLastActivity}</Text>
                <Text style={styles.alertRecommendation}>
                  活动风险：{' '}
                  <Text style={{ color: riskLevelColor(riskSummary?.activityLevel || 'low') }}>
                    {riskSummary?.activityLevel === 'high'
                      ? '需尽快增加活动'
                      : riskSummary?.activityLevel === 'medium'
                        ? '建议保持规律运动'
                        : '良好'}
                  </Text>
                </Text>

                <View style={styles.activityStats}>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>
                      {riskSummary?.latestMeasurement?.strengthScore ?? '--'}
                    </Text>
                    <Text style={styles.statLabel}>最近肌力</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={[styles.statValue, { color: 'rgba(255, 255, 255, 0.7)' }]}>
                      {formattedLastActivity}
                    </Text>
                    <Text style={styles.statLabel}>上次活动</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* AI病程预测 */}
          <View style={styles.section}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>AI病程预测</Text>
                <TouchableOpacity onPress={handlePredictionDetailPress}>
                  <View style={styles.detailButton}>
                    <Text style={styles.detailButtonText}>查看详情</Text>
                    <FontAwesome6 name="chevron-right" size={10} color="#969FFF" />
                  </View>
                </TouchableOpacity>
              </View>

              <View style={styles.predictionContent}>
                <View style={styles.predictionHeader}>
                  <Text style={styles.predictionLabel}>基础风险评估</Text>
                  <Text
                    style={[
                      styles.predictionRisk,
                      { color: riskLevelColor(riskSummary?.overallLevel || 'low') },
                    ]}
                  >
                    {riskSummary?.overallLevel === 'high'
                      ? '高风险'
                      : riskSummary?.overallLevel === 'medium'
                        ? '中等风险'
                        : '低风险'}
                  </Text>
                </View>
                <Text style={styles.predictionDescription}>
                  {riskSummary?.notes?.join('； ') || '暂无评估数据'}
                </Text>

                <View style={styles.riskLevels}>
                  <View style={styles.riskItem}>
                    <Text
                      style={[
                        styles.riskValue,
                        { color: riskLevelColor(riskSummary?.strengthLevel || 'low') },
                      ]}
                    >
                      {riskSummary?.strengthLevel === 'high'
                        ? '偏高风险'
                        : riskSummary?.strengthLevel === 'medium'
                          ? '需关注'
                          : '良好'}
                    </Text>
                    <Text style={styles.riskLabel}>肌力风险</Text>
                  </View>
                  <View style={styles.riskItem}>
                    <Text
                      style={[
                        styles.riskValue,
                        { color: riskLevelColor(riskSummary?.activityLevel || 'low') },
                      ]}
                    >
                      {riskSummary?.activityLevel === 'high'
                        ? '偏高风险'
                        : riskSummary?.activityLevel === 'medium'
                          ? '需关注'
                          : '良好'}
                    </Text>
                    <Text style={styles.riskLabel}>活动风险</Text>
                  </View>
                  <View style={styles.riskItem}>
                    <Text style={[styles.riskValue, { color: '#3b82f6' }]}>
                      {averageStrength !== null ? `${averageStrength.toFixed(1)} 分` : '--'}
                    </Text>
                    <Text style={styles.riskLabel}>平均肌力</Text>
                  </View>
                </View>
              </View>

              <TouchableOpacity
                style={styles.interventionButton}
                onPress={handleInterventionPlanPress}
              >
                <Text style={styles.interventionButtonText}>查看个性化干预计划</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 用药安全管理 */}
          <View style={styles.section}>
            <View style={[styles.card, styles.medicationCard]}>
              <View style={styles.cardHeader}>
                <View style={styles.medicationHeaderLeft}>
                  <View style={styles.medicationIconContainer}>
                    <FontAwesome6 name="shield-halved" size={14} color="#10b981" />
                  </View>
                  <Text style={styles.cardTitle}>用药安全</Text>
                </View>
                <TouchableOpacity onPress={handleMedicationDetailPress}>
                  <View style={styles.detailButton}>
                    <Text style={[styles.detailButtonText, { color: '#10b981' }]}>查看详情</Text>
                    <FontAwesome6 name="chevron-right" size={10} color="#10b981" />
                  </View>
                </TouchableOpacity>
              </View>

              <View style={styles.medicationContent}>
                <Text style={styles.medicationStatus}>
                  当前用药 {medications.length || 0} 项，保持按时服用并关注不良反应
                </Text>

                <View style={styles.medicationList}>
                  {medications.length === 0 ? (
                    <Text style={{ color: '#9CA3AF' }}>暂无用药记录，去录入一条吧</Text>
                  ) : (
                    medications.map((item) => (
                      <View key={item.id} style={styles.medicationItem}>
                        <Text style={styles.medicationName}>{item.medicationName}</Text>
                        <View
                          style={[
                            styles.medicationBadge,
                            {
                              backgroundColor: `${riskLevelColor(
                                item.status === 'active' ? 'low' : 'medium',
                              )}22`,
                            },
                          ]}
                        >
                          <Text style={styles.medicationBadgeText}>
                            {item.status === 'active' ? '进行中' : item.status}
                          </Text>
                        </View>
                      </View>
                    ))
                  )}
                </View>
              </View>
            </View>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
};

export default PMANAGE;
