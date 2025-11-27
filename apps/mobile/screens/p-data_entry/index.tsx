import React, { useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Slider from '@react-native-community/slider';
import Svg, { Polygon, Circle, Line, Text as SvgText } from 'react-native-svg';

import styles from './styles';

interface UploadStatus {
  mri: '未上传' | '上传中…' | '已上传';
  genetic: '未上传' | '上传中…' | '已上传';
  blood: '未上传' | '上传中…' | '已上传';
}

interface MuscleStrengthData {
  group: string | null;
  value: number;
}

const diagnosisOptions = ['Stage 0', 'Stage 1', 'Stage 2', 'Stage 3', 'Stage 4'];

const RadarChart = ({
  data,
  maxValue = 5,
  size = 260,
}: {
  data: { label: string; value: number }[];
  maxValue?: number;
  size?: number;
}) => {
  if (!data.length) {
    return <Text style={styles.radarEmpty}>暂无肌力数据</Text>;
  }

  const center = size / 2;
  const radius = size / 2 - 30;
  const angleSlice = (Math.PI * 2) / data.length;

  const polygonPoints = data
    .map((item, index) => {
      const angle = angleSlice * index - Math.PI / 2;
      const valueRadius = (Math.min(item.value, maxValue) / maxValue) * radius;
      const x = center + valueRadius * Math.cos(angle);
      const y = center + valueRadius * Math.sin(angle);
      return `${x},${y}`;
    })
    .join(' ');

  const gridLevels = [1, 2, 3, 4, 5];

  return (
    <Svg width={size} height={size}>
      {gridLevels.map((level) => {
        const gridRadius = (level / maxValue) * radius;
        const gridPoints = data
          .map((_, index) => {
            const angle = angleSlice * index - Math.PI / 2;
            const x = center + gridRadius * Math.cos(angle);
            const y = center + gridRadius * Math.sin(angle);
            return `${x},${y}`;
          })
          .join(' ');
        return (
          <Polygon
            key={`grid-${level}`}
            points={gridPoints}
            stroke="rgba(150, 159, 255, 0.2)"
            fill="none"
          />
        );
      })}

      {data.map((item, index) => {
        const angle = angleSlice * index - Math.PI / 2;
        const x = center + radius * Math.cos(angle);
        const y = center + radius * Math.sin(angle);
        return (
          <Line
            key={`axis-${item.label}`}
            x1={center}
            y1={center}
            x2={x}
            y2={y}
            stroke="rgba(255, 255, 255, 0.15)"
          />
        );
      })}

      <Polygon points={polygonPoints} fill="rgba(150, 159, 255, 0.3)" stroke="#969FFF" />

      {data.map((item, index) => {
        const angle = angleSlice * index - Math.PI / 2;
        const valueRadius = (Math.min(item.value, maxValue) / maxValue) * radius;
        const x = center + valueRadius * Math.cos(angle);
        const y = center + valueRadius * Math.sin(angle);
        const labelX = center + (radius + 20) * Math.cos(angle);
        const labelY = center + (radius + 20) * Math.sin(angle);

        return (
          <React.Fragment key={`label-${item.label}`}>
            <Circle cx={x} cy={y} r={4} fill="#969FFF" />
            <SvgText x={labelX} y={labelY} fill="#E5E7EB" fontSize={12} textAnchor="middle">
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
  const [fullName, setFullName] = useState('');
  const [diagnosisStage, setDiagnosisStage] = useState('');
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    mri: '未上传',
    genetic: '未上传',
    blood: '未上传',
  });
  const [muscleStrength, setMuscleStrength] = useState<MuscleStrengthData>({
    group: null,
    value: 0,
  });
  const [muscleStrengthMap, setMuscleStrengthMap] = useState<Record<string, number>>({});
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const timerInterval = useRef<NodeJS.Timeout | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [activityText, setActivityText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const muscleGroups = [
    { id: 'deltoid', name: '三角肌', icon: 'shield-halved', color: '#969FFF' },
    { id: 'biceps', name: '肱二头肌', icon: 'dumbbell', color: '#5147FF' },
    { id: 'triceps', name: '肱三头肌', icon: 'hand-fist', color: '#3E3987' },
    { id: 'tibialis', name: '胫骨前肌', icon: 'person-running', color: '#10B981' },
  ];

  const handleBackPress = () => {
    if (router.canGoBack()) router.back();
  };

  const handleMuscleGroupSelect = (group: string) => {
    setMuscleStrength({ group, value: muscleStrengthMap[group] ?? 0 });
  };

  const handleStrengthValueChange = (value: number) => {
    setMuscleStrength((prev) => {
      const rounded = Math.round(value);
      if (!prev.group) return { ...prev, value: rounded };

      setMuscleStrengthMap((map) => ({ ...map, [prev.group as string]: rounded }));
      return { ...prev, value: rounded };
    });
  };

  const startTimer = () => {
    setIsTimerRunning(true);
    setTimerSeconds(0);
    timerInterval.current = setInterval(() => setTimerSeconds((prev) => prev + 1), 1000);
  };

  const stopTimer = () => {
    setIsTimerRunning(false);
    if (timerInterval.current) {
      clearInterval(timerInterval.current);
      timerInterval.current = null;
    }
  };

  const handleTimerToggle = () => {
    if (isTimerRunning) stopTimer();
    else startTimer();
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
      setActivityText('今天上午进行了 20 分钟肩部康复训练，下午散步 1 小时，体力有提升。');
      setIsRecording(false);
    }, 3000);
  };

  const handleFileUpload = async (type: 'mri' | 'genetic' | 'blood') => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('权限不足', '需要访问相册权限才能上传文件');
        return;
      }
      setUploadStatus((prev) => ({ ...prev, [type]: '上传中…' }));
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 1,
      });

      if (!result.canceled) {
        setTimeout(() => {
          setUploadStatus((prev) => ({ ...prev, [type]: '已上传' }));
        }, 2000);
      } else {
        setUploadStatus((prev) => ({ ...prev, [type]: '未上传' }));
      }
    } catch (error) {
      console.error('文件上传失败:', error);
      setUploadStatus((prev) => ({ ...prev, [type]: '未上传' }));
      Alert.alert('上传失败', '文件上传过程中出现错误');
    }
  };

  const handleCameraCapture = async (type: 'mri' | 'genetic' | 'blood') => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('权限不足', '需要访问相机权限才能拍摄');
        return;
      }
      setUploadStatus((prev) => ({ ...prev, [type]: '上传中…' }));
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 1,
      });

      if (!result.canceled) {
        setTimeout(() => {
          setUploadStatus((prev) => ({ ...prev, [type]: '已上传' }));
        }, 2000);
      } else {
        setUploadStatus((prev) => ({ ...prev, [type]: '未上传' }));
      }
    } catch (error) {
      console.error('拍照失败:', error);
      setUploadStatus((prev) => ({ ...prev, [type]: '未上传' }));
      Alert.alert('拍照失败', '拍照过程中出现错误');
    }
  };

  const handleSubmit = async () => {
    if (!fullName.trim()) {
      Alert.alert('提示', '请填写姓名后再提交');
      return;
    }

    try {
      setIsLoading(true);
      await upsertPatientProfile({
        fullName: fullName.trim(),
        diagnosisStage: diagnosisStage || undefined,
        notes: activityText.trim() || undefined,
      });

      if (muscleStrength.group) {
        const strengthScore = muscleStrengthMap[muscleStrength.group] ?? muscleStrength.value ?? 0;
        await addPatientMeasurement({
          muscleGroup: muscleStrength.group,
          strengthScore,
          recordedAt: new Date().toISOString(),
        });
      }

      Alert.alert('提交成功', '数据已成功录入！', [
        { text: '确定', onPress: () => router.canGoBack() && router.back() },
      ]);
    } catch (error) {
      console.error('提交失败:', error);
      const message = error instanceof ApiError ? error.message : '数据提交过程中出现错误';
      Alert.alert('提交失败', message);
    } finally {
      setIsLoading(false);
    }
  };

  const getMuscleGroupName = (group: string | null): string => {
    if (!group) return '请选择肌群';
    const item = muscleGroups.find((mg) => mg.id === group);
    return item ? item.name : '请选择肌群';
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case '已上传':
        return '#10B981';
      case '上传中…':
        return '#F59E0B';
      default:
        return '#9CA3AF';
    }
  };

  const muscleRadarData = useMemo(
    () =>
      muscleGroups.map((group) => ({
        label: group.name,
        value: muscleStrengthMap[group.id] ?? 0,
      })),
    [muscleGroups, muscleStrengthMap],
  );

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
        {/* 基础信息 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>基础信息</Text>
          <View style={styles.basicInfoCard}>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>姓名 *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="请输入姓名"
                placeholderTextColor="#9CA3AF"
                value={fullName}
                onChangeText={setFullName}
              />
            </View>
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>诊断阶段</Text>
              <View style={styles.stageOptions}>
                {diagnosisOptions.map((option) => {
                  const selected = diagnosisStage === option;
                  return (
                    <TouchableOpacity
                      key={option}
                      style={[styles.stageOption, selected && styles.stageOptionActive]}
                      onPress={() => setDiagnosisStage(selected ? '' : option)}
                    >
                      <Text
                        style={[styles.stageOptionText, selected && styles.stageOptionTextActive]}
                      >
                        {option}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>
        </View>

        {/* 医疗报告上传 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>医疗报告</Text>

          {['mri', 'genetic', 'blood'].map((type) => {
            const config = {
              mri: { title: 'MRI 影像', color: '#969FFF', bg: 'rgba(150, 159, 255, 0.2)' },
              genetic: { title: '基因检测报告', color: '#5147FF', bg: 'rgba(81, 71, 255, 0.2)' },
              blood: { title: '血检报告', color: '#3E3987', bg: 'rgba(62, 57, 135, 0.2)' },
            }[type as 'mri' | 'genetic' | 'blood'];

            return (
              <View key={type} style={styles.uploadCard}>
                <View style={styles.uploadHeader}>
                  <Text style={styles.uploadTitle}>{config.title}</Text>
                  <Text
                    style={[styles.uploadStatus, { color: getStatusColor(uploadStatus[type]) }]}
                  >
                    {uploadStatus[type]}
                  </Text>
                </View>
                <View style={styles.uploadArea}>
                  <TouchableOpacity
                    style={[styles.cameraButton, { backgroundColor: config.bg }]}
                    onPress={() => handleCameraCapture(type as 'mri' | 'genetic' | 'blood')}
                  >
                    <FontAwesome6 name="camera" size={18} color={config.color} />
                  </TouchableOpacity>
                  <Text style={styles.uploadHint}>拍照上传或选择文件</Text>
                  <TouchableOpacity
                    onPress={() => handleFileUpload(type as 'mri' | 'genetic' | 'blood')}
                  >
                    <Text style={[styles.uploadButtonText, { color: config.color }]}>选择文件</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        {/* 肌力评分 */}
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

        {/* 肌力雷达图 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>肌力雷达图</Text>
          <View style={styles.radarCard}>
            <RadarChart data={muscleRadarData} maxValue={5} />
            <Text style={styles.radarHint}>拖动上方滑块即可实时查看各肌群表现</Text>
          </View>
        </View>

        {/* 楼梯测试 */}
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

        {/* 日常活动 */}
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
                  name={isRecording ? 'stop' : 'microphone'}
                  size={14}
                  color={isRecording ? '#EF4444' : '#3B82F6'}
                />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.activityTextarea}
              placeholder="记录今天的活动情况，如：上午进行 20 分钟的康复训练..."
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

        {/* 提交按钮 */}
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
