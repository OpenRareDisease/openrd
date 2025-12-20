import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Slider from '@react-native-community/slider';
import { LineChart } from 'react-native-chart-kit';
import Svg, { Polygon, Circle, Line, Text as SvgText } from 'react-native-svg';
import {
  ApiError,
  addActivityLog,
  addPatientMeasurement,
  getMyPatientProfile,
  upsertPatientProfile,
} from '../../lib/api';
import styles from './styles';

type ReportType = 'mri' | 'genetic' | 'blood';

interface UploadStatus {
  mri: '未上传' | '上传中...' | '已上传';
  genetic: '未上传' | '上传中...' | '已上传';
  blood: '未上传' | '上传中...' | '已上传';
}

interface MuscleStrengthData {
  group: string | null;
  value: number;
}

interface ReportHistoryItem {
  id: string;
  type: ReportType;
  source: '相册' | '相机';
  timestamp: string;
  fileName?: string;
}

interface TimelineEvent {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  tag: '报告' | '肌力' | '活动';
}

const reportLabels: Record<ReportType, string> = {
  mri: 'MRI 影像报告',
  genetic: '基因检测报告',
  blood: '血检报告',
};

const chartWidth = Dimensions.get('window').width - 48;

const initialTimeline: TimelineEvent[] = [
  {
    id: 'timeline-1',
    title: 'MRI 影像报告已上传',
    description: '来源：相册 · 影像清晰可读',
    timestamp: '2025-11-18 09:20',
    tag: '报告',
  },
  {
    id: 'timeline-2',
    title: '肩部肌群评分更新',
    description: '肌力 3 级，医生建议继续弹力带训练',
    timestamp: '2025-11-17 17:45',
    tag: '肌力',
  },
  {
    id: 'timeline-3',
    title: '日常活动记录',
    description: '完成 30 分钟康复训练，步行 2 公里',
    timestamp: '2025-11-16 20:15',
    tag: '活动',
  },
];

const initialTrendData = {
  labels: ['11/10', '11/12', '11/14', '11/16', '11/18'],
  datasets: [
    {
      data: [2.5, 3, 3.6, 3.8, 4],
      strokeWidth: 2,
    },
  ],
};

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
  size = 260,
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

const DataEntryScreen = () => {
  const router = useRouter();
  const timerInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    mri: '未上传',
    genetic: '未上传',
    blood: '未上传',
  });

  const [reportHistory, setReportHistory] = useState<ReportHistoryItem[]>([
    {
      id: 'history-1',
      type: 'mri',
      source: '相册',
      timestamp: '2025-11-18 09:20',
      fileName: 'FSHD-MRI-001.jpg',
    },
    {
      id: 'history-2',
      type: 'genetic',
      source: '相机',
      timestamp: '2025-11-15 15:10',
      fileName: '基因检测单.png',
    },
  ]);

  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>(initialTimeline);
  const [strengthTrend, setStrengthTrend] = useState(initialTrendData);

  const [muscleStrength, setMuscleStrength] = useState<MuscleStrengthData>({
    group: null,
    value: 0,
  });
  const [muscleStrengthMap, setMuscleStrengthMap] = useState<Record<string, number>>({});

  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [activityText, setActivityText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const muscleGroups = [
    { id: 'deltoid', name: '三角肌', icon: 'shield-halved', color: '#969FFF' },
    { id: 'biceps', name: '肱二头肌', icon: 'dumbbell', color: '#5147FF' },
    { id: 'triceps', name: '肱三头肌', icon: 'hand-fist', color: '#3E3987' },
    { id: 'tibialis', name: '胫骨前肌', icon: 'person-running', color: '#10B981' },
  ];

  const radarData = useMemo(
    () =>
      muscleGroups.map((group) => ({
        label: group.name,
        value: muscleStrengthMap[group.id] ?? 0,
      })),
    [muscleGroups, muscleStrengthMap],
  );

  const handleBackPress = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  const handleMuscleGroupSelect = (group: string) => {
    setMuscleStrength({
      group,
      value: muscleStrengthMap[group] ?? 0,
    });
  };

  const handleStrengthValueChange = (value: number) => {
    const rounded = Math.round(value);
    setMuscleStrength((prev) => ({
      ...prev,
      value: rounded,
    }));
    setMuscleStrengthMap((prev) => {
      if (!muscleStrength.group) return prev;
      return {
        ...prev,
        [muscleStrength.group]: rounded,
      };
    });
  };

  const startTimer = () => {
    setIsTimerRunning(true);
    setTimerSeconds(0);
    timerInterval.current = setInterval(() => {
      setTimerSeconds((prev) => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    setIsTimerRunning(false);
    if (timerInterval.current) {
      clearInterval(timerInterval.current);
      timerInterval.current = null;
    }
  };

  const handleTimerToggle = () => {
    if (isTimerRunning) {
      stopTimer();
    } else {
      startTimer();
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleVoiceToggle = () => {
    if (isRecording) {
      setIsRecording(false);
      return;
    }
    setIsRecording(true);
    setTimeout(() => {
      setActivityText('今天完成 20 分钟肩部康复训练，下午散步 40 分钟。');
      setIsRecording(false);
    }, 3000);
  };

  const formatTimestamp = (date: Date) => {
    const yyyy = date.getFullYear();
    const mm = `${date.getMonth() + 1}`.padStart(2, '0');
    const dd = `${date.getDate()}`.padStart(2, '0');
    const hh = `${date.getHours()}`.padStart(2, '0');
    const min = `${date.getMinutes()}`.padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  };

  const appendReportRecord = (type: ReportType, source: '相册' | '相机', fileName?: string) => {
    const timestamp = formatTimestamp(new Date());
    const historyItem: ReportHistoryItem = {
      id: `report-${Date.now()}`,
      type,
      source,
      timestamp,
      fileName,
    };
    setReportHistory((prev) => [historyItem, ...prev].slice(0, 5));
    setTimelineEvents((prev) =>
      [
        {
          id: `timeline-report-${Date.now()}`,
          title: `${reportLabels[type]}已上传`,
          description: `来源：${source}${fileName ? ` · ${fileName}` : ''}`,
          timestamp,
          tag: '报告',
        },
        ...prev,
      ].slice(0, 8),
    );
  };

  const appendMuscleStrengthEvent = (value: number) => {
    if (!muscleStrength.group) return;
    const timestamp = formatTimestamp(new Date());
    setStrengthTrend((prev) => {
      const newLabels = [...prev.labels, timestamp.slice(5, 10)].slice(-6);
      const newData = [...prev.datasets[0].data, value].slice(-6);
      return {
        labels: newLabels,
        datasets: [
          {
            ...prev.datasets[0],
            data: newData,
          },
        ],
      };
    });
    setTimelineEvents((prev) =>
      [
        {
          id: `timeline-strength-${Date.now()}`,
          title: `${getMuscleGroupName(muscleStrength.group)}肌力更新`,
          description: `评分 ${value} 级，持续跟踪康复趋势`,
          timestamp,
          tag: '肌力',
        },
        ...prev,
      ].slice(0, 8),
    );
  };

  const appendActivityEvent = (description: string) => {
    const trimmed = description.trim();
    if (!trimmed) return;
    const timestamp = formatTimestamp(new Date());
    setTimelineEvents((prev) =>
      [
        {
          id: `timeline-activity-${Date.now()}`,
          title: '日常活动更新',
          description: trimmed,
          timestamp,
          tag: '活动',
        },
        ...prev,
      ].slice(0, 8),
    );
  };

  const handleFileUpload = async (type: ReportType) => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('权限不足', '需要访问相册权限才能上传文件');
        return;
      }
      setUploadStatus((prev) => ({
        ...prev,
        [type]: '上传中...',
      }));
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 1,
      });
      if (result.canceled) {
        setUploadStatus((prev) => ({
          ...prev,
          [type]: '未上传',
        }));
        return;
      }
      setTimeout(() => {
        setUploadStatus((prev) => ({
          ...prev,
          [type]: '已上传',
        }));
        appendReportRecord(type, '相册', result.assets?.[0]?.fileName);
      }, 1500);
    } catch (error) {
      console.error('文件上传失败:', error);
      setUploadStatus((prev) => ({
        ...prev,
        [type]: '未上传',
      }));
      Alert.alert('上传失败', '文件上传过程中出现错误，请稍后再试。');
    }
  };

  const handleCameraCapture = async (type: ReportType) => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('权限不足', '需要访问相机权限才能拍照');
        return;
      }
      setUploadStatus((prev) => ({
        ...prev,
        [type]: '上传中...',
      }));
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 1,
      });
      if (result.canceled) {
        setUploadStatus((prev) => ({
          ...prev,
          [type]: '未上传',
        }));
        return;
      }
      setTimeout(() => {
        setUploadStatus((prev) => ({
          ...prev,
          [type]: '已上传',
        }));
        appendReportRecord(type, '相机');
      }, 1500);
    } catch (error) {
      console.error('拍照失败:', error);
      setUploadStatus((prev) => ({
        ...prev,
        [type]: '未上传',
      }));
      Alert.alert('拍照失败', '拍照过程中出现错误，请稍后再试。');
    }
  };

  const handleSubmit = async () => {
    try {
      setIsLoading(true);

      // 确保档案存在；若 404 则创建一个占位档案
      try {
        await getMyPatientProfile();
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          await upsertPatientProfile({ fullName: '未命名用户' });
        } else {
          throw error;
        }
      }

      const requests: Promise<unknown>[] = [];

      // 提交肌力测量
      Object.entries(muscleStrengthMap).forEach(([group, value]) => {
        if (value > 0) {
          requests.push(
            addPatientMeasurement({
              muscleGroup: group,
              strengthScore: value,
              recordedAt: new Date().toISOString(),
            }),
          );
        }
      });

      const nowIso = new Date().toISOString();

      // 提交楼梯测试结果作为活动日志
      if (timerSeconds > 0) {
        requests.push(
          addActivityLog({
            logDate: nowIso,
            source: 'stair-test',
            content: `楼梯测试用时 ${formatTime(timerSeconds)}`,
          }),
        );
      }

      // 提交日常活动
      if (activityText.trim()) {
        requests.push(
          addActivityLog({
            logDate: nowIso,
            source: 'manual',
            content: activityText.trim(),
          }),
        );
      }

      await Promise.all(requests);

      if (muscleStrength.group && muscleStrength.value > 0) {
        appendMuscleStrengthEvent(muscleStrength.value);
      }
      if (timerSeconds > 0) {
        appendActivityEvent(`楼梯测试完成，用时 ${formatTime(timerSeconds)}。`);
      }
      if (activityText.trim()) {
        appendActivityEvent(activityText);
      }
      Alert.alert('提交成功', '数据已成功录入！', [
        { text: '继续录入' },
        {
          text: '返回上一页',
          onPress: () => {
            if (router.canGoBack()) {
              router.back();
            }
          },
        },
      ]);
    } catch (error) {
      const message =
        error instanceof ApiError && error.message
          ? error.message
          : '数据提交过程中出现错误，请稍后再试。';
      console.error('提交失败:', error);
      Alert.alert('提交失败', message);
    } finally {
      setIsLoading(false);
    }
  };

  const getMuscleGroupName = (group: string | null): string => {
    if (!group) return '请选择肌群';
    const muscleGroup = muscleGroups.find((mg) => mg.id === group);
    return muscleGroup ? muscleGroup.name : '请选择肌群';
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case '已上传':
        return '#10B981';
      case '上传中...':
        return '#F59E0B';
      default:
        return '#9CA3AF';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
          <FontAwesome6 name="arrow-left" size={16} color="#9CA3AF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>数据录入</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>医疗报告</Text>

          {(['mri', 'genetic', 'blood'] as ReportType[]).map((type) => (
            <View style={styles.uploadCard} key={type}>
              <View style={styles.uploadHeader}>
                <Text style={styles.uploadTitle}>{reportLabels[type]}</Text>
                <Text style={[styles.uploadStatus, { color: getStatusColor(uploadStatus[type]) }]}>
                  {uploadStatus[type]}
                </Text>
              </View>
              <View style={styles.uploadArea}>
                <TouchableOpacity
                  style={[styles.cameraButton, { backgroundColor: 'rgba(150, 159, 255, 0.2)' }]}
                  onPress={() => handleCameraCapture(type)}
                >
                  <FontAwesome6 name="camera" size={18} color="#969FFF" />
                </TouchableOpacity>
                <Text style={styles.uploadHint}>拍照上传或选择文件</Text>
                <TouchableOpacity onPress={() => handleFileUpload(type)}>
                  <Text style={[styles.uploadButtonText, { color: '#969FFF' }]}>选择文件</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>报告上传历史</Text>
          {reportHistory.map((item) => (
            <View key={item.id} style={styles.historyCard}>
              <View style={styles.historyHeader}>
                <Text style={styles.historyTitle}>{reportLabels[item.type]}</Text>
                <Text style={[styles.historyStatus, { color: '#10B981' }]}>已保存</Text>
              </View>
              <Text style={styles.historyMeta}>
                {item.timestamp} · {item.source}
              </Text>
              {item.fileName && <Text style={styles.historyMeta}>文件：{item.fileName}</Text>}
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>肌力评分</Text>
          <View style={styles.muscleGroupGrid}>
            {muscleGroups.map((group) => (
              <TouchableOpacity
                key={group.id}
                style={[
                  styles.muscleGroupItem,
                  muscleStrength.group === group.id && styles.muscleGroupItemActive,
                ]}
                onPress={() => handleMuscleGroupSelect(group.id)}
              >
                <FontAwesome6
                  name={group.icon}
                  size={16}
                  color={group.color}
                  style={styles.muscleGroupIcon}
                />
                <Text style={styles.muscleGroupName}>{group.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.strengthSliderCard}>
            <View style={styles.strengthHeader}>
              <Text style={styles.selectedMuscle}>{getMuscleGroupName(muscleStrength.group)}</Text>
              <Text style={styles.strengthValue}>{muscleStrength.value}</Text>
            </View>

            <View style={styles.sliderContainer}>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={5}
                step={1}
                value={muscleStrength.value}
                onValueChange={handleStrengthValueChange}
                minimumTrackTintColor="#969FFF"
                maximumTrackTintColor="rgba(255, 255, 255, 0.1)"
                disabled={!muscleStrength.group}
              />
            </View>

            <View style={styles.strengthLabels}>
              {[0, 1, 2, 3, 4, 5].map((level) => (
                <Text key={level} style={styles.strengthLabel}>
                  {level}级
                </Text>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>基础数据可视化</Text>
          <View style={styles.radarCard}>
            <Text style={styles.sectionSubtitle}>肌群雷达图（0-5 级）</Text>
            <RadarChart data={radarData} />
          </View>
          <View style={styles.chartCard}>
            <LineChart
              data={strengthTrend}
              width={chartWidth}
              height={220}
              chartConfig={chartConfig}
              bezier
              withShadow={false}
              style={styles.chart}
            />
            <View style={styles.chartLegend}>
              <View style={styles.chartLegendDot} />
              <Text style={styles.chartLegendText}>肌力评分趋势（0-5 级）</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>楼梯测试</Text>
          <View style={styles.timerCard}>
            <View style={styles.timerIconContainer}>
              <FontAwesome6
                name={isTimerRunning ? 'stop' : timerSeconds > 0 ? 'check' : 'stopwatch'}
                size={24}
                color={isTimerRunning ? '#EF4444' : '#10B981'}
              />
            </View>
            <Text style={styles.timerTitle}>爬楼计时</Text>
            <Text style={styles.timerDescription}>记录 10 级楼梯所需时间</Text>
            <Text style={styles.timerDisplay}>{formatTime(timerSeconds)}</Text>
            <TouchableOpacity
              style={[styles.timerButton, isTimerRunning && styles.timerButtonActive]}
              onPress={handleTimerToggle}
            >
              <Text
                style={[styles.timerButtonText, isTimerRunning && styles.timerButtonTextActive]}
              >
                {isTimerRunning ? '停止计时' : timerSeconds > 0 ? '重新计时' : '开始计时'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>日常活动</Text>
          <View style={styles.activityCard}>
            <View style={styles.activityHeader}>
              <Text style={styles.activityTitle}>活动记录</Text>
              <TouchableOpacity
                style={[styles.voiceButton, isRecording && styles.voiceButtonActive]}
                onPress={handleVoiceToggle}
              >
                <FontAwesome6
                  name={isRecording ? 'stop' : 'micro.phone'}
                  size={14}
                  color={isRecording ? '#EF4444' : '#3B82F6'}
                />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.activityTextarea}
              placeholder="记录今天的活动情况，如：上午完成 20 分钟康复训练，下午散步 1 小时..."
              placeholderTextColor="#9CA3AF"
              value={activityText}
              onChangeText={setActivityText}
              multiline
              textAlignVertical="top"
            />
            {isRecording && (
              <View style={styles.voiceStatus}>
                <FontAwesome6 name="microphone" size={12} color="#9CA3AF" />
                <Text style={styles.voiceStatusText}>正在录音...</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>医疗时间轴</Text>
          <View style={styles.timelineCard}>
            {timelineEvents.map((event, index) => (
              <View
                key={event.id}
                style={[
                  styles.timelineItem,
                  index === timelineEvents.length - 1 && styles.timelineItemLast,
                ]}
              >
                <View style={styles.timelineHeader}>
                  <Text style={styles.timelineTitle}>{event.title}</Text>
                  <Text
                    style={[
                      styles.timelineTag,
                      event.tag === '报告' && styles.timelineTagReport,
                      event.tag === '肌力' && styles.timelineTagStrength,
                      event.tag === '活动' && styles.timelineTagActivity,
                    ]}
                  >
                    {event.tag}
                  </Text>
                </View>
                <Text style={styles.timelineDescription}>{event.description}</Text>
                <Text style={styles.timelineTimestamp}>{event.timestamp}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.submitSection}>
          <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
            <Text style={styles.submitButtonText}>提交数据</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={isLoading} transparent animationType="fade">
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#969FFF" style={styles.loadingSpinner} />
            <Text style={styles.loadingText}>正在保存数据...</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

export default DataEntryScreen;
