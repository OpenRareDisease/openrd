import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Slider from '@react-native-community/slider';
import {
  ApiError,
  addActivityLog,
  addPatientMeasurement,
  addMedication,
  attachSubmissionDocuments,
  createSubmission,
  getMyPatientProfile,
  getMedications,
  uploadPatientDocument,
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
  source: '相册' | '相机' | '上传';
  timestamp: string;
  fileName?: string;
  ocrSummary?: string;
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

const documentTypeMap: Record<ReportType, string> = {
  mri: 'mri',
  genetic: 'genetic_report',
  blood: 'blood_panel',
};

const DataEntryScreen = () => {
  const router = useRouter();
  const timerInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    mri: '未上传',
    genetic: '未上传',
    blood: '未上传',
  });

  const [reportHistory, setReportHistory] = useState<ReportHistoryItem[]>([]);

  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);

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
  const [medicationForm, setMedicationForm] = useState({
    medicationName: '',
    dosage: '',
    frequency: '',
    route: '',
  });
  const [medications, setMedications] = useState<any[]>([]);
  const [uploadedDocumentIds, setUploadedDocumentIds] = useState<string[]>([]);

  const muscleGroups = [
    { id: 'deltoid', name: '三角肌', icon: 'shield-halved', color: '#969FFF' },
    { id: 'biceps', name: '肱二头肌', icon: 'dumbbell', color: '#5147FF' },
    { id: 'triceps', name: '肱三头肌', icon: 'hand-fist', color: '#3E3987' },
    { id: 'tibialis', name: '胫骨前肌', icon: 'person-running', color: '#10B981' },
    { id: 'quadriceps', name: '股四头肌', icon: 'person-running', color: '#F97316' },
    { id: 'hamstrings', name: '腘绳肌', icon: 'person-running', color: '#EF4444' },
    { id: 'gluteus', name: '臀肌', icon: 'person-running', color: '#22D3EE' },
  ];

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

  const mapDocumentTypeToReportType = (documentType?: string): ReportType | null => {
    switch (documentType) {
      case 'mri':
        return 'mri';
      case 'genetic_report':
        return 'genetic';
      case 'blood_panel':
        return 'blood';
      default:
        return null;
    }
  };

  const buildStrengthMapFromProfile = (profile: any) => {
    if (!profile?.measurements?.length) {
      return {};
    }
    const map: Record<string, number> = {};
    profile.measurements.forEach((item: any) => {
      const existing = map[item.muscleGroup];
      if (existing === undefined) {
        map[item.muscleGroup] = Number(item.strengthScore);
      }
    });
    return map;
  };

  const buildReportHistoryFromProfile = (profile: any) => {
    if (!profile?.documents?.length) {
      return [];
    }
    return profile.documents
      .map((doc: any) => {
        const type = mapDocumentTypeToReportType(doc.documentType);
        if (!type) return null;
        const timestamp = doc.uploadedAt ? new Date(doc.uploadedAt) : new Date();
        return {
          id: doc.id,
          type,
          source: '上传' as const,
          timestamp: formatTimestamp(timestamp),
          fileName: doc.fileName ?? doc.title ?? undefined,
          ocrSummary: doc.ocrPayload?.extractedText ?? doc.ocrPayload?.fields?.hint ?? undefined,
        };
      })
      .filter(Boolean)
      .sort(
        (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      ) as ReportHistoryItem[];
  };

  const buildTimelineFromProfile = (profile: any) => {
    const events: Array<{ event: TimelineEvent; sortKey: number }> = [];

    profile?.documents?.forEach((doc: any) => {
      const type = mapDocumentTypeToReportType(doc.documentType);
      if (!type) return;
      const time = doc.uploadedAt ? new Date(doc.uploadedAt) : new Date();
      events.push({
        sortKey: time.getTime(),
        event: {
          id: `doc-${doc.id}`,
          title: `${reportLabels[type]}已上传`,
          description:
            doc.ocrPayload?.extractedText ??
            doc.ocrPayload?.fields?.hint ??
            doc.fileName ??
            '已上传',
          timestamp: formatTimestamp(time),
          tag: '报告',
        },
      });
    });

    profile?.measurements?.forEach((item: any) => {
      const time = item.recordedAt ? new Date(item.recordedAt) : new Date();
      events.push({
        sortKey: time.getTime(),
        event: {
          id: `measurement-${item.id}`,
          title: `${getMuscleGroupName(item.muscleGroup)}肌力更新`,
          description: `肌力 ${Number(item.strengthScore)} 级`,
          timestamp: formatTimestamp(time),
          tag: '肌力',
        },
      });
    });

    profile?.activityLogs?.forEach((item: any) => {
      const time = item.createdAt ? new Date(item.createdAt) : new Date();
      events.push({
        sortKey: time.getTime(),
        event: {
          id: `activity-${item.id}`,
          title: '日常活动记录',
          description: item.content ?? '已记录活动',
          timestamp: formatTimestamp(time),
          tag: '活动',
        },
      });
    });

    return events.sort((a, b) => b.sortKey - a.sortKey).map((item) => item.event);
  };

  const loadProfile = async () => {
    try {
      const [data, meds] = await Promise.all([getMyPatientProfile(), getMedications()]);
      setMuscleStrengthMap(buildStrengthMapFromProfile(data));
      setReportHistory(buildReportHistoryFromProfile(data));
      setTimelineEvents(buildTimelineFromProfile(data));
      setMedications(meds ?? []);

      const existingTypes = new Set(
        (data.documents ?? []).map((doc: any) => mapDocumentTypeToReportType(doc.documentType)),
      );
      setUploadStatus({
        mri: existingTypes.has('mri') ? '已上传' : '未上传',
        genetic: existingTypes.has('genetic') ? '已上传' : '未上传',
        blood: existingTypes.has('blood') ? '已上传' : '未上传',
      });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) {
        console.error('加载档案失败:', error);
      }
      setMuscleStrengthMap({});
      setReportHistory([]);
      setTimelineEvents([]);
      setMedications([]);
    }
  };

  useEffect(() => {
    loadProfile();
  }, []);

  const ensureProfileExists = async () => {
    try {
      await getMyPatientProfile();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        await upsertPatientProfile({});
      } else {
        throw error;
      }
    }
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
      await ensureProfileExists();
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
      const asset = result.assets?.[0];
      if (!asset?.uri) {
        throw new Error('无法读取文件');
      }
      const fileName = asset.fileName ?? `report-${type}-${Date.now()}`;
      const uploadFile =
        Platform.OS === 'web'
          ? await (async () => {
              const response = await fetch(asset.uri);
              const blob = await response.blob();
              return new File([blob], fileName, {
                type: asset.mimeType ?? blob.type ?? 'application/octet-stream',
              });
            })()
          : {
              uri: asset.uri,
              name: fileName,
              type: asset.mimeType ?? 'application/octet-stream',
            };
      const response = await uploadPatientDocument({
        documentType: documentTypeMap[type],
        title: reportLabels[type],
        file: uploadFile,
      });
      if (response?.id) {
        setUploadedDocumentIds((prev) => Array.from(new Set([...prev, response.id])));
      }
      const ocrSummary =
        response?.ocrPayload?.extractedText ?? response?.ocrPayload?.fields?.hint ?? 'OCR解析完成';
      setUploadStatus((prev) => ({
        ...prev,
        [type]: '已上传',
      }));
      setReportHistory((prev) =>
        [
          {
            id: `report-${Date.now()}`,
            type,
            source: '相册',
            timestamp: formatTimestamp(new Date()),
            fileName,
            ocrSummary,
          },
          ...prev,
        ].slice(0, 5),
      );
      await loadProfile();
    } catch (error) {
      console.error('文件上传失败:', error);
      setUploadStatus((prev) => ({
        ...prev,
        [type]: '未上传',
      }));
      const message =
        error instanceof ApiError && error.message
          ? error.message
          : '文件上传过程中出现错误，请稍后再试。';
      Alert.alert('上传失败', message);
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
      await ensureProfileExists();
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
      const asset = result.assets?.[0];
      if (!asset?.uri) {
        throw new Error('无法读取文件');
      }
      const fileName = asset.fileName ?? `camera-${type}-${Date.now()}`;
      const uploadFile =
        Platform.OS === 'web'
          ? await (async () => {
              const response = await fetch(asset.uri);
              const blob = await response.blob();
              return new File([blob], fileName, {
                type: asset.mimeType ?? blob.type ?? 'application/octet-stream',
              });
            })()
          : {
              uri: asset.uri,
              name: fileName,
              type: asset.mimeType ?? 'application/octet-stream',
            };
      const response = await uploadPatientDocument({
        documentType: documentTypeMap[type],
        title: reportLabels[type],
        file: uploadFile,
      });
      if (response?.id) {
        setUploadedDocumentIds((prev) => Array.from(new Set([...prev, response.id])));
      }
      const ocrSummary =
        response?.ocrPayload?.extractedText ?? response?.ocrPayload?.fields?.hint ?? 'OCR解析完成';
      setUploadStatus((prev) => ({
        ...prev,
        [type]: '已上传',
      }));
      setReportHistory((prev) =>
        [
          {
            id: `report-${Date.now()}`,
            type,
            source: '相机',
            timestamp: formatTimestamp(new Date()),
            fileName,
            ocrSummary,
          },
          ...prev,
        ].slice(0, 5),
      );
      await loadProfile();
    } catch (error) {
      console.error('拍照失败:', error);
      setUploadStatus((prev) => ({
        ...prev,
        [type]: '未上传',
      }));
      const message =
        error instanceof ApiError && error.message
          ? error.message
          : '拍照过程中出现错误，请稍后再试。';
      Alert.alert('拍照失败', message);
    }
  };

  const handleSubmit = async () => {
    try {
      setIsLoading(true);

      await ensureProfileExists();

      const hasMeasurements = Object.values(muscleStrengthMap).some((value) => value > 0);
      const hasActivity = timerSeconds > 0 || Boolean(activityText.trim());
      const hasMedication = Boolean(medicationForm.medicationName.trim());
      const hasDocuments = uploadedDocumentIds.length > 0;
      if (!hasMeasurements && !hasActivity && !hasMedication && !hasDocuments) {
        Alert.alert('提示', '请至少录入一项数据');
        return;
      }

      const submission = await createSubmission();
      const submissionId = submission.id;

      const requests: Promise<unknown>[] = [];

      // 提交肌力测量
      Object.entries(muscleStrengthMap).forEach(([group, value]) => {
        if (value > 0) {
          requests.push(
            addPatientMeasurement({
              muscleGroup: group,
              strengthScore: value,
              recordedAt: new Date().toISOString(),
              submissionId,
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
            source: 'stair_test',
            content: `楼梯测试用时 ${formatTime(timerSeconds)}`,
            submissionId,
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
            submissionId,
          }),
        );
      }

      if (medicationForm.medicationName.trim()) {
        requests.push(
          addMedication({
            medicationName: medicationForm.medicationName.trim(),
            dosage: medicationForm.dosage.trim() || null,
            frequency: medicationForm.frequency.trim() || null,
            route: medicationForm.route.trim() || null,
            submissionId,
          }),
        );
      }

      await Promise.all(requests);

      if (uploadedDocumentIds.length > 0) {
        await attachSubmissionDocuments(submissionId, uploadedDocumentIds);
      }

      setMedicationForm({
        medicationName: '',
        dosage: '',
        frequency: '',
        route: '',
      });
      setUploadedDocumentIds([]);

      await loadProfile();
      Alert.alert('提交成功', '数据已成功添加/更新！', [
        { text: '继续添加/更新' },
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
        <Text style={styles.headerTitle}>添加/更新数据</Text>
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
          <Text style={styles.sectionTitle}>用药记录</Text>
          <View style={styles.profileCard}>
            <Text style={styles.inputLabel}>药物名称</Text>
            <TextInput
              style={styles.input}
              placeholder="例如：维生素D"
              placeholderTextColor="#9CA3AF"
              value={medicationForm.medicationName}
              onChangeText={(value) =>
                setMedicationForm((prev) => ({
                  ...prev,
                  medicationName: value,
                }))
              }
            />

            <Text style={styles.inputLabel}>剂量</Text>
            <TextInput
              style={styles.input}
              placeholder="例如：1片"
              placeholderTextColor="#9CA3AF"
              value={medicationForm.dosage}
              onChangeText={(value) =>
                setMedicationForm((prev) => ({
                  ...prev,
                  dosage: value,
                }))
              }
            />

            <Text style={styles.inputLabel}>频次</Text>
            <TextInput
              style={styles.input}
              placeholder="例如：每日一次"
              placeholderTextColor="#9CA3AF"
              value={medicationForm.frequency}
              onChangeText={(value) =>
                setMedicationForm((prev) => ({
                  ...prev,
                  frequency: value,
                }))
              }
            />

            <Text style={styles.inputLabel}>用药途径</Text>
            <TextInput
              style={styles.input}
              placeholder="例如：口服"
              placeholderTextColor="#9CA3AF"
              value={medicationForm.route}
              onChangeText={(value) =>
                setMedicationForm((prev) => ({
                  ...prev,
                  route: value,
                }))
              }
            />
          </View>

          <View style={styles.historyCard}>
            <Text style={styles.historyTitle}>当前用药</Text>
            {medications.length === 0 ? (
              <Text style={styles.historyMeta}>暂无用药记录，提交后会展示在此处。</Text>
            ) : (
              medications.slice(0, 3).map((item) => (
                <View key={item.id} style={{ marginTop: 8 }}>
                  <Text style={styles.historyMeta}>{item.medicationName}</Text>
                  <Text style={styles.historyMeta}>
                    {item.dosage ?? '--'} · {item.frequency ?? '--'}
                  </Text>
                </View>
              ))
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>报告上传历史</Text>
          {reportHistory.length === 0 ? (
            <View style={styles.historyCard}>
              <Text style={styles.historyMeta}>暂无报告记录，上传后会展示在此处。</Text>
            </View>
          ) : (
            reportHistory.map((item) => (
              <View key={item.id} style={styles.historyCard}>
                <View style={styles.historyHeader}>
                  <Text style={styles.historyTitle}>{reportLabels[item.type]}</Text>
                  <Text style={[styles.historyStatus, { color: '#10B981' }]}>已保存</Text>
                </View>
                <Text style={styles.historyMeta}>
                  {item.timestamp} · {item.source}
                </Text>
                {item.fileName && <Text style={styles.historyMeta}>文件：{item.fileName}</Text>}
                {item.ocrSummary && <Text style={styles.historyMeta}>OCR：{item.ocrSummary}</Text>}
              </View>
            ))
          )}
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
            {timelineEvents.length === 0 ? (
              <Text style={{ color: '#9CA3AF' }}>暂无记录，添加/更新后会自动生成时间轴。</Text>
            ) : (
              timelineEvents.map((event, index) => (
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
              ))
            )}
          </View>
        </View>

        <View style={styles.submitSection}>
          <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
            <Text style={styles.submitButtonText}>添加/更新数据</Text>
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

      {/* 档案编辑已移至设置页 */}
    </SafeAreaView>
  );
};

export default DataEntryScreen;
