import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';
import { ApiError, getMyPatientProfile } from '../../lib/api';

interface TimelineEvent {
  id: string;
  title: string;
  date: string;
  description: string;
  status: 'warning' | 'stable' | 'info';
  statusText: string;
  details?: Record<string, string>;
}

interface AlertItem {
  id: string;
  type: 'warning' | 'info' | 'success';
  title: string;
  description: string;
  actionText?: string;
}

interface PatientMeasurement {
  id: string;
  muscleGroup: string;
  strengthScore: number;
  recordedAt: string;
}

interface PatientProfile {
  id: string;
  fullName: string | null;
  diagnosisStage: string | null;
  measurements: PatientMeasurement[];
  updatedAt: string;
}

const ArchiveScreen = () => {
  const MUSCLE_LABELS: Record<string, string> = {
    deltoid: '三角肌',
    biceps: '肱二头肌',
    triceps: '肱三头肌',
    tibialis: '胫骨前肌',
    quadriceps: '股四头肌',
    hamstrings: '腘绳肌',
    gluteus: '臀肌',
  };

  const getMuscleLabel = (key: string) => MUSCLE_LABELS[key] || key;

  const router = useRouter();
  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const timelineEvents: TimelineEvent[] = profile
    ? profile.measurements.map((item) => ({
        id: item.id,
        title: `${getMuscleLabel(item.muscleGroup)} 肌力评估`,
        date: new Date(item.recordedAt).toLocaleDateString(),
        description: `肌力得分：${item.strengthScore}`,
        status: item.strengthScore >= 4 ? 'stable' : item.strengthScore >= 3 ? 'info' : 'warning',
        statusText:
          item.strengthScore >= 4 ? '表现良好' : item.strengthScore >= 3 ? '建议关注' : '需要干预',
      }))
    : [];

  const alertItems: AlertItem[] = [
    {
      id: '1',
      type: 'warning',
      title: '肌力下降预警',
      description: '三角肌肌力从4.0降至3.5，建议加强针对性训练',
      actionText: '查看干预计划 →',
    },
    {
      id: '2',
      type: 'info',
      title: '定期复查提醒',
      description: '建议3个月后进行MRI复查',
    },
    {
      id: '3',
      type: 'success',
      title: '康复训练坚持良好',
      description: '本周已完成80%的训练计划',
    },
  ];

  const fetchProfile = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const data = await getMyPatientProfile();
      setProfile({
        id: data.id,
        fullName: data.fullName,
        diagnosisStage: data.diagnosisStage,
        measurements: data.measurements ?? [],
        updatedAt: data.updatedAt,
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : '无法获取档案数据';
      setErrorMessage(message);
      setProfile(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleClinicalPassportPress = () => {
    router.push('/p-clinical_passport');
  };

  const handleDataEntryPress = () => {
    router.push('/p-data_entry');
  };

  const handleTimelineFilterPress = () => {
    Alert.alert('筛选', '时间轴筛选功能');
  };

  const handleEventPress = (eventId: string) => {
    setExpandedEventId(expandedEventId === eventId ? null : eventId);
  };

  const handleInterventionPlanPress = () => {
    router.push('/p-manage');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'warning':
        return '#FF9F43';
      case 'stable':
        return '#4CAF50';
      case 'info':
        return '#2196F3';
      default:
        return '#FF9F43';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'warning':
        return 'triangle-exclamation';
      case 'stable':
        return 'check';
      case 'info':
        return 'info';
      default:
        return 'triangle-exclamation';
    }
  };

  const renderTimelineEvent = (event: TimelineEvent, index: number) => {
    const isLast = index === timelineEvents.length - 1;
    const isExpanded = expandedEventId === event.id;

    return (
      <TouchableOpacity
        key={event.id}
        style={styles.eventCard}
        onPress={() => handleEventPress(event.id)}
        activeOpacity={0.7}
      >
        <View style={styles.timelineLeft}>
          <LinearGradient
            colors={['#969FFF', '#5147FF']}
            style={styles.timelineDot}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          {!isLast && (
            <LinearGradient
              colors={['#969FFF', '#5147FF']}
              style={styles.timelineLine}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
            />
          )}
        </View>

        <View style={styles.eventContent}>
          <View style={styles.eventHeader}>
            <Text style={styles.eventTitle}>{event.title}</Text>
            <Text style={styles.eventDate}>{event.date}</Text>
          </View>

          {event.description ? (
            <Text style={styles.eventDescription}>{event.description}</Text>
          ) : null}

          {event.details && (
            <View style={styles.eventDetails}>
              {Object.entries(event.details).map(([muscle, strength]) => (
                <View key={muscle} style={styles.muscleDetail}>
                  <Text style={styles.muscleName}>{muscle}</Text>
                  <Text style={styles.muscleStrength}>{strength}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.eventStatus}>
            <View style={[styles.statusDot, { backgroundColor: getStatusColor(event.status) }]} />
            <Text style={[styles.statusText, { color: getStatusColor(event.status) }]}>
              {event.statusText}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderContent = () => {
    if (isLoading) {
      return (
        <View style={styles.stateContainer}>
          <ActivityIndicator size="large" color="#969FFF" />
          <Text style={styles.stateText}>正在加载档案数据...</Text>
        </View>
      );
    }

    if (errorMessage) {
      return (
        <View style={styles.stateContainer}>
          <Text style={styles.stateText}>{errorMessage}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchProfile}>
            <Text style={styles.retryButtonText}>重试</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (!profile) {
      return (
        <View style={styles.stateContainer}>
          <Text style={styles.stateText}>还没有档案数据，快去录入吧！</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleDataEntryPress}>
            <Text style={styles.retryButtonText}>去录入</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <>
        <View style={styles.profileCard}>
          <Text style={styles.profileName}>{profile.fullName ?? '未填写姓名'}</Text>
          <Text style={styles.profileMeta}>
            诊断阶段：{profile.diagnosisStage ?? '未填写'} · 最近更新：
            {new Date(profile.updatedAt).toLocaleDateString()}
          </Text>
          <TouchableOpacity style={styles.editButton} onPress={handleDataEntryPress}>
            <Text style={styles.editButtonText}>更新档案</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, styles.sectionTitleAccent]}>最近肌力测量</Text>
          {profile.measurements.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>暂无肌力记录，立即去录入吧。</Text>
            </View>
          ) : (
            profile.measurements.slice(0, 3).map((item) => (
              <View key={item.id} style={styles.measurementCard}>
                <View>
                  <Text style={styles.measurementMuscle}>{getMuscleLabel(item.muscleGroup)}</Text>
                  <Text style={styles.measurementDate}>
                    {new Date(item.recordedAt).toLocaleString()}
                  </Text>
                </View>
                <Text style={styles.measurementScore}>{item.strengthScore}</Text>
              </View>
            ))
          )}
        </View>
      </>
    );
  };

  const renderAlertItem = (item: AlertItem, index: number) => {
    const isMainAlert = index === 0;

    if (isMainAlert) {
      return (
        <View key={item.id} style={styles.mainAlertCard}>
          <View style={styles.alertHeader}>
            <View style={styles.alertIconContainer}>
              <FontAwesome6
                name={getStatusIcon(item.type)}
                size={12}
                color={getStatusColor(item.type)}
              />
            </View>
            <View style={styles.alertContent}>
              <View style={styles.alertTitleRow}>
                <Text style={styles.alertTitle}>{item.title}</Text>
                <Text style={[styles.alertLevel, { color: getStatusColor(item.type) }]}>
                  中等风险
                </Text>
              </View>
              <Text style={styles.alertDescription}>{item.description}</Text>
              {item.actionText && (
                <TouchableOpacity onPress={handleInterventionPlanPress}>
                  <Text style={[styles.alertAction, { color: getStatusColor(item.type) }]}>
                    {item.actionText}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      );
    }

    return (
      <View
        key={item.id}
        style={[styles.secondaryAlertCard, { borderLeftColor: getStatusColor(item.type) }]}
      >
        <View style={styles.secondaryAlertContent}>
          <View
            style={[
              styles.secondaryAlertIcon,
              { backgroundColor: `${getStatusColor(item.type)}20` },
            ]}
          >
            <FontAwesome6
              name={getStatusIcon(item.type)}
              size={10}
              color={getStatusColor(item.type)}
            />
          </View>
          <View style={styles.secondaryAlertText}>
            <Text style={styles.secondaryAlertTitle}>{item.title}</Text>
            <Text style={styles.secondaryAlertDescription}>{item.description}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={['#0F0F23', '#1A1A3A', '#0F0F23']}
        style={styles.backgroundGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* 顶部标题栏 */}
          <View style={styles.header}>
            <Text style={styles.pageTitle}>动态档案</Text>
            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.clinicalPassportButton}
                onPress={handleClinicalPassportPress}
                activeOpacity={0.7}
              >
                <FontAwesome6 name="id-card" size={12} color="#969FFF" />
                <Text style={styles.clinicalPassportText}>临床护照</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.dataEntryButton}
                onPress={handleDataEntryPress}
                activeOpacity={0.7}
              >
                <FontAwesome6 name="plus" size={12} color="#FFFFFF" />
                <Text style={styles.dataEntryText}>录入数据</Text>
              </TouchableOpacity>
            </View>
          </View>

          {renderContent()}

          {/* FSHD临床护照概览卡片 */}
          <View style={styles.passportSection}>
            <LinearGradient
              colors={['rgba(150, 159, 255, 0.1)', 'rgba(81, 71, 255, 0.05)']}
              style={styles.passportCard}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <View style={styles.passportHeader}>
                <Text style={styles.passportTitle}>FSHD临床护照</Text>
                <Text style={styles.passportId}>ID: FSHD-2024-001</Text>
              </View>

              <View style={styles.passportGrid}>
                <View style={styles.passportItem}>
                  <Text style={styles.passportLabel}>基因类型</Text>
                  <Text style={styles.passportValue}>FSHD1</Text>
                </View>
                <View style={styles.passportItem}>
                  <Text style={styles.passportLabel}>D4Z4重复数</Text>
                  <Text style={styles.passportValue}>8</Text>
                </View>
                <View style={styles.passportItem}>
                  <Text style={styles.passportLabel}>甲基化值</Text>
                  <Text style={styles.passportValue}>0.35</Text>
                </View>
                <View style={styles.passportItem}>
                  <Text style={styles.passportLabel}>初诊时间</Text>
                  <Text style={styles.passportValue}>2023-05-15</Text>
                </View>
              </View>
            </LinearGradient>
          </View>

          {/* 可视化时间轴 */}
          <View style={styles.timelineSection}>
            <View style={styles.timelineHeader}>
              <Text style={styles.timelineTitle}>病程时间轴</Text>
              <TouchableOpacity onPress={handleTimelineFilterPress} activeOpacity={0.7}>
                <View style={styles.filterButton}>
                  <FontAwesome6 name="filter" size={10} color="#969FFF" />
                  <Text style={styles.filterText}>筛选</Text>
                </View>
              </TouchableOpacity>
            </View>

            <View style={styles.timelineContainer}>
              {timelineEvents.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyText}>暂无测量记录</Text>
                </View>
              ) : (
                timelineEvents.map((event, index) => renderTimelineEvent(event, index))
              )}
            </View>
          </View>

          {/* 风险预警看板 */}
          <View style={styles.riskAlertSection}>
            <Text style={styles.riskAlertTitle}>风险预警</Text>

            <View style={styles.alertsContainer}>
              {alertItems.map((item, index) => renderAlertItem(item, index))}
            </View>
          </View>
        </ScrollView>
      </LinearGradient>
    </SafeAreaView>
  );
};

export default ArchiveScreen;
