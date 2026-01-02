import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { LineChart } from 'react-native-chart-kit';
import Svg, { Polygon, Circle, Line, Text as SvgText } from 'react-native-svg';
import styles from './styles';
import { ApiError, getMuscleInsight, getMyPatientProfile, type MuscleInsight } from '../../lib/api';

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
  actionTarget?: 'data_entry' | 'manage';
}

interface PatientMeasurement {
  id: string;
  muscleGroup: string;
  strengthScore: number;
  recordedAt: string;
}

interface PatientActivityLog {
  id: string;
  logDate: string;
  content: string | null;
  createdAt: string;
}

interface PatientDocument {
  id: string;
  documentType: string;
  title: string | null;
  fileName: string | null;
  uploadedAt: string;
  ocrPayload?: {
    extractedText?: string;
    fields?: Record<string, string>;
  } | null;
}

interface PatientProfile {
  id: string;
  fullName: string | null;
  measurements: PatientMeasurement[];
  activityLogs: PatientActivityLog[];
  documents: PatientDocument[];
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
  const [isTimelineExpanded, setIsTimelineExpanded] = useState(false);
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedMuscle, setSelectedMuscle] = useState<keyof typeof MUSCLE_LABELS>('deltoid');
  const [muscleInsight, setMuscleInsight] = useState<MuscleInsight | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  const latestUpdatedAt = React.useMemo(() => {
    if (!profile) return null;
    const timestamps = [
      profile.updatedAt,
      ...profile.measurements.map((item) => item.recordedAt),
      ...profile.activityLogs.map((item) => item.createdAt ?? item.logDate),
      ...profile.documents.map((doc) => doc.uploadedAt),
    ]
      .filter(Boolean)
      .map((value) => new Date(value).getTime())
      .filter((value) => !Number.isNaN(value));

    if (timestamps.length === 0) return null;
    return new Date(Math.max(...timestamps));
  }, [profile]);

  const formatDateTime = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    const hour = String(value.getHours()).padStart(2, '0');
    const minute = String(value.getMinutes()).padStart(2, '0');
    const second = String(value.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  };

  const hasRecordedData = Boolean(
    profile &&
      (profile.measurements.length > 0 ||
        profile.activityLogs.length > 0 ||
        profile.documents.length > 0),
  );

  const getPassportId = () => {
    if (!profile?.id) return 'FSHD-UNASSIGNED';
    const compact = profile.id.replace(/-/g, '').slice(0, 10).toUpperCase();
    return `FSHD-${compact}`;
  };

  const mapDocumentTypeLabel = (type?: string) => {
    switch (type) {
      case 'mri':
        return 'MRI 影像报告';
      case 'genetic_report':
        return '基因检测报告';
      case 'blood_panel':
        return '血检报告';
      default:
        return '医学报告';
    }
  };

  const timelineEvents: TimelineEvent[] = profile
    ? [
        ...profile.measurements.map((item) => ({
          sortKey: new Date(item.recordedAt).getTime(),
          event: {
            id: `measure-${item.id}`,
            title: `${getMuscleLabel(item.muscleGroup)} 肌力评估`,
            date: new Date(item.recordedAt).toLocaleDateString(),
            description: `肌力得分：${item.strengthScore}`,
            status:
              item.strengthScore >= 4 ? 'stable' : item.strengthScore >= 3 ? 'info' : 'warning',
            statusText:
              item.strengthScore >= 4
                ? '表现良好'
                : item.strengthScore >= 3
                  ? '建议关注'
                  : '需要干预',
          },
        })),
        ...profile.activityLogs.map((item) => ({
          sortKey: new Date(item.logDate ?? item.createdAt).getTime(),
          event: {
            id: `activity-${item.id}`,
            title: '日常活动记录',
            date: new Date(item.logDate ?? item.createdAt).toLocaleDateString(),
            description: item.content ?? '已记录活动',
            status: 'stable' as const,
            statusText: '已记录',
          },
        })),
        ...profile.documents.map((doc) => ({
          sortKey: new Date(doc.uploadedAt).getTime(),
          event: {
            id: `doc-${doc.id}`,
            title: `${mapDocumentTypeLabel(doc.documentType)}已上传`,
            date: new Date(doc.uploadedAt).toLocaleDateString(),
            description:
              doc.ocrPayload?.extractedText ??
              doc.ocrPayload?.fields?.hint ??
              doc.fileName ??
              '已上传',
            status: 'info' as const,
            statusText: '已更新',
          },
        })),
      ]
        .sort((a, b) => b.sortKey - a.sortKey)
        .map((item) => item.event)
    : [];

  const chartWidth = Dimensions.get('window').width - 48;

  const chartConfig = {
    backgroundColor: '#0F0F23',
    backgroundGradientFrom: '#0F0F23',
    backgroundGradientTo: '#0F0F23',
    decimalPlaces: 1,
    color: (opacity = 1) => `rgba(150, 159, 255, ${opacity})`,
    labelColor: () => '#9CA3AF',
    propsForDots: {
      r: '4',
      strokeWidth: '2',
      stroke: '#FFFFFF',
    },
  };

  const RadarChart = ({
    data,
    maxValue = 5,
    size = 220,
  }: {
    data: { label: string; value: number }[];
    maxValue?: number;
    size?: number;
  }) => {
    const center = size / 2;
    const radius = size / 2 - 20;
    const angleStep = (Math.PI * 2) / data.length;

    const points = data
      .map((item, index) => {
        const angle = -Math.PI / 2 + index * angleStep;
        const valueRatio = Math.max(0, Math.min(item.value, maxValue)) / maxValue;
        const x = center + radius * valueRatio * Math.cos(angle);
        const y = center + radius * valueRatio * Math.sin(angle);
        return `${x},${y}`;
      })
      .join(' ');

    return (
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {[1, 2, 3, 4, 5].map((level) => {
          const r = (radius / 5) * level;
          const polygonPoints = data
            .map((_, index) => {
              const angle = -Math.PI / 2 + index * angleStep;
              const x = center + r * Math.cos(angle);
              const y = center + r * Math.sin(angle);
              return `${x},${y}`;
            })
            .join(' ');
          return <Polygon key={level} points={polygonPoints} fill="none" stroke="#2F2F4A" />;
        })}

        {data.map((_, index) => {
          const angle = -Math.PI / 2 + index * angleStep;
          const x = center + radius * Math.cos(angle);
          const y = center + radius * Math.sin(angle);
          return <Line key={index} x1={center} y1={center} x2={x} y2={y} stroke="#2F2F4A" />;
        })}

        <Polygon points={points} fill="rgba(150, 159, 255, 0.2)" stroke="#969FFF" />
        {data.map((item, index) => {
          const angle = -Math.PI / 2 + index * angleStep;
          const x = center + radius * Math.cos(angle);
          const y = center + radius * Math.sin(angle);
          return (
            <React.Fragment key={item.label}>
              <Circle cx={x} cy={y} r={3} fill="#969FFF" />
              <SvgText
                x={x}
                y={y + (y < center ? -8 : 12)}
                fill="#CBD5E1"
                fontSize="10"
                textAnchor="middle"
              >
                {item.label}
              </SvgText>
            </React.Fragment>
          );
        })}
      </Svg>
    );
  };

  const radarData = useMemo(() => {
    const measurements = profile?.measurements ?? [];
    const latestByGroup = new Map<string, PatientMeasurement>();
    measurements.forEach((item) => {
      const existing = latestByGroup.get(item.muscleGroup);
      if (!existing || new Date(item.recordedAt) > new Date(existing.recordedAt)) {
        latestByGroup.set(item.muscleGroup, item);
      }
    });
    return Object.entries(MUSCLE_LABELS).map(([group, label]) => ({
      label,
      value: Number(latestByGroup.get(group)?.strengthScore ?? 0),
    }));
  }, [profile, MUSCLE_LABELS]);

  const formatTrendLabel = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${month}-${day} ${hour}:${minute}`;
  };

  const trendChartData = useMemo(() => {
    if (!muscleInsight?.trend?.length) return null;
    const points = muscleInsight.trend;
    return {
      labels: points.map((item) => formatTrendLabel(item.recordedAt)),
      datasets: [
        {
          data: points.map((item) => Number(item.strengthScore)),
          strokeWidth: 2,
        },
      ],
    };
  }, [muscleInsight]);

  const distributionPosition = useMemo(() => {
    if (!muscleInsight?.distribution || muscleInsight.userLatestScore === null) return null;
    const { quartile25, medianScore, quartile75 } = muscleInsight.distribution;
    const score = muscleInsight.userLatestScore;
    if (score <= quartile25) return '前25%';
    if (score <= medianScore) return '25%-50%';
    if (score <= quartile75) return '50%-75%';
    return '75%+';
  }, [muscleInsight]);

  const alertItems: AlertItem[] = (() => {
    if (!profile) return [];
    const items: AlertItem[] = [];
    if (profile.measurements.length === 0) {
      items.push({
        id: 'no-measurements',
        type: 'info',
        title: '暂无肌力记录',
        description: '录入肌力评估后会在此生成趋势。',
        actionText: '去录入 →',
        actionTarget: 'data_entry',
      });
    }
    const lastActivity = profile.activityLogs[0];
    if (!lastActivity) {
      items.push({
        id: 'no-activity',
        type: 'warning',
        title: '暂无活动记录',
        description: '记录日常活动有助于病程评估。',
        actionText: '去录入 →',
        actionTarget: 'data_entry',
      });
    } else {
      items.push({
        id: 'activity-latest',
        type: 'success',
        title: '最近活动已记录',
        description: lastActivity.content ?? '保持规律活动，继续加油！',
      });
    }
    if (profile.documents.length === 0) {
      items.push({
        id: 'no-docs',
        type: 'info',
        title: '暂无影像报告',
        description: '上传报告后可在时间轴查看。',
        actionText: '去录入 →',
        actionTarget: 'data_entry',
      });
    }
    return items;
  })();

  const fetchProfile = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      const data = await getMyPatientProfile();
      setProfile({
        id: data.id,
        fullName: data.fullName,
        measurements: data.measurements ?? [],
        activityLogs: data.activityLogs ?? [],
        documents: data.documents ?? [],
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

  useEffect(() => {
    if (!profile) {
      setMuscleInsight(null);
      setInsightError(null);
      return;
    }
    let isMounted = true;
    const loadInsight = async () => {
      try {
        setInsightLoading(true);
        setInsightError(null);
        const data = await getMuscleInsight(selectedMuscle);
        if (!isMounted) return;
        setMuscleInsight(data);
      } catch (error) {
        if (!isMounted) return;
        const message = error instanceof ApiError ? error.message : '无法获取肌力趋势数据';
        setInsightError(message);
        setMuscleInsight(null);
      } finally {
        if (isMounted) {
          setInsightLoading(false);
        }
      }
    };

    loadInsight();
    return () => {
      isMounted = false;
    };
  }, [selectedMuscle, profile]);

  const handleClinicalPassportPress = () => {
    router.push('/p-clinical_passport');
  };

  const handleDataEntryPress = () => {
    router.push('/p-data_entry');
  };

  const handleTimelineFilterPress = () => {
    Alert.alert('筛选', '时间轴筛选功能');
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

    return (
      <TouchableOpacity key={event.id} style={styles.eventCard} activeOpacity={0.7}>
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
            <View style={styles.eventHeaderLeft}>
              <Text style={styles.eventTitle}>{event.title}</Text>
            </View>
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
            最近更新：{formatDateTime(latestUpdatedAt ?? new Date(profile.updatedAt))}
          </Text>
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

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>肌力分析</Text>
          <View style={styles.radarCard}>
            <Text style={styles.sectionSubtitle}>肌群雷达图（0-5 级）</Text>
            <RadarChart data={radarData} />
          </View>
          <View style={styles.chartCard}>
            <Text style={styles.sectionSubtitle}>选择肌肉部位</Text>
            <View style={styles.muscleSelector}>
              {Object.entries(MUSCLE_LABELS).map(([group, label]) => {
                const isActive = selectedMuscle === group;
                return (
                  <TouchableOpacity
                    key={group}
                    style={[styles.muscleChip, isActive && styles.muscleChipActive]}
                    onPress={() => setSelectedMuscle(group as keyof typeof MUSCLE_LABELS)}
                  >
                    <Text style={[styles.muscleChipText, isActive && styles.muscleChipTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {insightLoading ? (
              <ActivityIndicator color="#969FFF" style={styles.insightLoading} />
            ) : insightError ? (
              <Text style={styles.emptyText}>{insightError}</Text>
            ) : trendChartData ? (
              <>
                <LineChart
                  data={trendChartData}
                  width={chartWidth}
                  height={220}
                  chartConfig={chartConfig}
                  bezier
                  withShadow={false}
                  style={styles.chart}
                />
                <View style={styles.chartLegend}>
                  <View style={styles.chartLegendDot} />
                  <Text style={styles.chartLegendText}>
                    {MUSCLE_LABELS[selectedMuscle]}肌力趋势（按提交）
                  </Text>
                </View>
              </>
            ) : (
              <Text style={styles.emptyText}>暂无趋势数据，录入后自动生成。</Text>
            )}

            <View style={styles.distributionCard}>
              <Text style={styles.sectionSubtitle}>群体分布对比</Text>
              {muscleInsight?.distribution ? (
                <>
                  <View style={styles.distributionBar}>
                    <View style={styles.distributionRange} />
                    {(() => {
                      const dist = muscleInsight.distribution;
                      const min = dist.minScore;
                      const max = dist.maxScore;
                      const range = max - min || 1;
                      const getLeft = (value: number) =>
                        `${Math.min(100, Math.max(0, ((value - min) / range) * 100))}%`;
                      return (
                        <>
                          <View
                            style={[styles.distributionMarker, { left: getLeft(dist.minScore) }]}
                          />
                          <View
                            style={[styles.distributionMarker, { left: getLeft(dist.quartile25) }]}
                          />
                          <View
                            style={[styles.distributionMarker, { left: getLeft(dist.medianScore) }]}
                          />
                          <View
                            style={[styles.distributionMarker, { left: getLeft(dist.quartile75) }]}
                          />
                          <View
                            style={[styles.distributionMarker, { left: getLeft(dist.maxScore) }]}
                          />
                          {muscleInsight.userLatestScore !== null && (
                            <View
                              style={[
                                styles.distributionMarkerUser,
                                { left: getLeft(muscleInsight.userLatestScore) },
                              ]}
                            />
                          )}
                        </>
                      );
                    })()}
                  </View>
                  <View style={styles.distributionLegend}>
                    <Text style={styles.distributionText}>
                      样本数：{muscleInsight.distribution.sampleCount}
                    </Text>
                    <Text style={styles.distributionText}>
                      你的分位：{distributionPosition ?? '—'}
                    </Text>
                    <Text style={styles.distributionText}>
                      当前评分：
                      {muscleInsight.userLatestScore !== null
                        ? muscleInsight.userLatestScore.toFixed(1)
                        : '—'}
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={styles.emptyText}>暂无分布数据</Text>
              )}
            </View>
          </View>
        </View>
      </>
    );
  };

  const renderAlertItem = (item: AlertItem, index: number) => {
    const isMainAlert = index === 0;
    const actionHandler =
      item.actionTarget === 'data_entry' ? handleDataEntryPress : handleInterventionPlanPress;

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
                <TouchableOpacity onPress={actionHandler}>
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
                <Text style={styles.dataEntryText}>
                  {hasRecordedData ? '添加数据' : '录入数据'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

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
                <Text style={styles.passportId}>ID: {hasRecordedData ? getPassportId() : '—'}</Text>
              </View>

              {hasRecordedData ? (
                <View style={styles.passportGrid}>
                  <View style={styles.passportItem}>
                    <Text style={styles.passportLabel}>基因类型</Text>
                    <Text style={styles.passportValue}>—</Text>
                  </View>
                  <View style={styles.passportItem}>
                    <Text style={styles.passportLabel}>D4Z4重复数</Text>
                    <Text style={styles.passportValue}>—</Text>
                  </View>
                  <View style={styles.passportItem}>
                    <Text style={styles.passportLabel}>甲基化值</Text>
                    <Text style={styles.passportValue}>—</Text>
                  </View>
                  <View style={styles.passportItem}>
                    <Text style={styles.passportLabel}>初诊时间</Text>
                    <Text style={styles.passportValue}>—</Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.passportHint}>录入数据以获得临床护照</Text>
              )}
            </LinearGradient>
          </View>

          {renderContent()}

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

            <View style={styles.timelineToggleRow}>
              <Text style={styles.timelineHint}>
                {timelineEvents.length === 0 ? '暂无记录' : `共 ${timelineEvents.length} 条记录`}
              </Text>
              <TouchableOpacity
                style={styles.timelineToggle}
                onPress={() => setIsTimelineExpanded((prev) => !prev)}
              >
                <Text style={styles.timelineToggleText}>
                  {isTimelineExpanded ? '收起' : '展开'}
                </Text>
                <FontAwesome6
                  name={isTimelineExpanded ? 'chevron-up' : 'chevron-down'}
                  size={10}
                  color="#969FFF"
                />
              </TouchableOpacity>
            </View>

            {isTimelineExpanded && (
              <View style={styles.timelineContainer}>
                {timelineEvents.length === 0 ? (
                  <View style={styles.emptyCard}>
                    <Text style={styles.emptyText}>暂无测量记录</Text>
                  </View>
                ) : (
                  timelineEvents.map((event, index) => renderTimelineEvent(event, index))
                )}
              </View>
            )}
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
