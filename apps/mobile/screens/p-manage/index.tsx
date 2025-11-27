import DataComparisonFeature from '../p-data_comparison_feature/DataComparisonFeature';
import RecordTimelineScreen from '../p-record_timeline_screen/RecordTimelineScreen';
import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';

const PMANAGE = () => {
  const router = useRouter();

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
                      <Text style={styles.averageScore}>4.2</Text>
                      <Text style={styles.averageLabel}>平均分</Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* 肌群详细数据 */}
              <View style={styles.muscleGroupsGrid}>
                <TouchableOpacity
                  style={styles.muscleGroupCard}
                  onPress={() => handleMuscleGroupPress('三角肌')}
                >
                  <View style={styles.muscleGroupHeader}>
                    <Text style={styles.muscleGroupName}>三角肌</Text>
                    <Text style={styles.muscleGroupScore}>3.5</Text>
                  </View>
                  <View style={styles.progressBarContainer}>
                    <View
                      style={[styles.progressBar, { width: '70%', backgroundColor: '#969FFF' }]}
                    />
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.muscleGroupCard}
                  onPress={() => handleMuscleGroupPress('肱二头肌')}
                >
                  <View style={styles.muscleGroupHeader}>
                    <Text style={styles.muscleGroupName}>肱二头肌</Text>
                    <Text style={[styles.muscleGroupScore, { color: '#5147FF' }]}>4.0</Text>
                  </View>
                  <View style={styles.progressBarContainer}>
                    <View
                      style={[styles.progressBar, { width: '80%', backgroundColor: '#5147FF' }]}
                    />
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.muscleGroupCard}
                  onPress={() => handleMuscleGroupPress('肱三头肌')}
                >
                  <View style={styles.muscleGroupHeader}>
                    <Text style={styles.muscleGroupName}>肱三头肌</Text>
                    <Text style={[styles.muscleGroupScore, { color: '#3E3987' }]}>4.5</Text>
                  </View>
                  <View style={styles.progressBarContainer}>
                    <View
                      style={[styles.progressBar, { width: '90%', backgroundColor: '#3E3987' }]}
                    />
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.muscleGroupCard}
                  onPress={() => handleMuscleGroupPress('胫骨前肌')}
                >
                  <View style={styles.muscleGroupHeader}>
                    <Text style={styles.muscleGroupName}>胫骨前肌</Text>
                    <Text style={[styles.muscleGroupScore, { color: '#10b981' }]}>4.8</Text>
                  </View>
                  <View style={styles.progressBarContainer}>
                    <View
                      style={[styles.progressBar, { width: '96%', backgroundColor: '#10b981' }]}
                    />
                  </View>
                </TouchableOpacity>
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
                <Text style={styles.alertDescription}>
                  本周步数较上周下降 <Text style={styles.alertHighlight}>32%</Text>
                </Text>
                <Text style={styles.alertRecommendation}>
                  建议：适当增加日常活动量，避免长时间久坐
                </Text>

                <View style={styles.activityStats}>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>4,521</Text>
                    <Text style={styles.statLabel}>本周步数</Text>
                  </View>
                  <View style={styles.statItem}>
                    <Text style={[styles.statValue, { color: 'rgba(255, 255, 255, 0.7)' }]}>
                      6,684
                    </Text>
                    <Text style={styles.statLabel}>上周步数</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {/* 动态记录时间线 */}
          <View style={styles.section}>
            <View style={styles.card}>
              <RecordTimelineScreen />
            </View>
          </View>

          {/* 数据对比功能 */}
          <View style={styles.section}>
            <View style={styles.card}>
              <DataComparisonFeature />
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
                  <Text style={styles.predictionLabel}>3年发展趋势</Text>
                  <Text style={styles.predictionRisk}>低风险</Text>
                </View>
                <Text style={styles.predictionDescription}>
                  基于您的基因类型和当前肌力数据，预计3年内病情进展缓慢
                </Text>

                <View style={styles.riskLevels}>
                  <View style={styles.riskItem}>
                    <Text style={[styles.riskValue, { color: '#10b981' }]}>15%</Text>
                    <Text style={styles.riskLabel}>足下垂风险</Text>
                  </View>
                  <View style={styles.riskItem}>
                    <Text style={[styles.riskValue, { color: '#fbbf24' }]}>28%</Text>
                    <Text style={styles.riskLabel}>肌力下降</Text>
                  </View>
                  <View style={styles.riskItem}>
                    <Text style={[styles.riskValue, { color: '#3b82f6' }]}>85%</Text>
                    <Text style={styles.riskLabel}>稳定概率</Text>
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
                <Text style={styles.medicationStatus}>当前用药方案安全，肝功能指标正常</Text>

                <View style={styles.medicationList}>
                  <View style={styles.medicationItem}>
                    <Text style={styles.medicationName}>布洛芬</Text>
                    <View style={styles.medicationBadge}>
                      <Text style={styles.medicationBadgeText}>安全</Text>
                    </View>
                  </View>
                  <View style={styles.medicationItem}>
                    <Text style={styles.medicationName}>维生素D</Text>
                    <View style={styles.medicationBadge}>
                      <Text style={styles.medicationBadgeText}>安全</Text>
                    </View>
                  </View>
                </View>

                <View style={styles.liverFunctionCard}>
                  <View style={styles.liverFunctionHeader}>
                    <Text style={styles.liverFunctionLabel}>肝功能指标</Text>
                    <Text style={styles.liverFunctionStatus}>正常</Text>
                  </View>
                  <View style={styles.liverFunctionValues}>
                    <View style={styles.liverFunctionValue}>
                      <Text style={styles.liverFunctionValueLabel}>ALT:</Text>
                      <Text style={styles.liverFunctionValueText}>28 U/L</Text>
                    </View>
                    <View style={styles.liverFunctionValue}>
                      <Text style={styles.liverFunctionValueLabel}>AST:</Text>
                      <Text style={styles.liverFunctionValueText}>32 U/L</Text>
                    </View>
                  </View>
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
