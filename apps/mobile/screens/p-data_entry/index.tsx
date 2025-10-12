

import React, { useState, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, Modal, ActivityIndicator, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import Slider from '@react-native-community/slider';
import styles from './styles';

interface UploadStatus {
  mri: '未上传' | '上传中...' | '已上传';
  genetic: '未上传' | '上传中...' | '已上传';
  blood: '未上传' | '上传中...' | '已上传';
}

interface MuscleStrengthData {
  group: string | null;
  value: number;
}

const DataEntryScreen = () => {
  const router = useRouter();
  
  // 上传状态
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    mri: '未上传',
    genetic: '未上传',
    blood: '未上传',
  });

  // 肌力评分
  const [muscleStrength, setMuscleStrength] = useState<MuscleStrengthData>({
    group: null,
    value: 0,
  });

  // 计时器状态
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const timerInterval = useRef<number | null>(null);

  // 语音录入状态
  const [isRecording, setIsRecording] = useState(false);
  const [activityText, setActivityText] = useState('');

  // 加载状态
  const [isLoading, setIsLoading] = useState(false);

  const muscleGroups = [
    { id: 'deltoid', name: '三角肌', icon: 'shield-halved', color: '#969FFF' },
    { id: 'biceps', name: '肱二头肌', icon: 'dumbbell', color: '#5147FF' },
    { id: 'triceps', name: '肱三头肌', icon: 'hand-fist', color: '#3E3987' },
    { id: 'tibialis', name: '胫骨前肌', icon: 'person-running', color: '#10B981' },
  ];

  const handleBackPress = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  const handleMuscleGroupSelect = (group: string) => {
    setMuscleStrength(prev => ({
      ...prev,
      group,
      value: 0,
    }));
  };

  const handleStrengthValueChange = (value: number) => {
    setMuscleStrength(prev => ({
      ...prev,
      value: Math.round(value),
    }));
  };

  const handleTimerToggle = () => {
    if (!isTimerRunning) {
      startTimer();
    } else {
      stopTimer();
    }
  };

  const startTimer = () => {
    setIsTimerRunning(true);
    setTimerSeconds(0);
    timerInterval.current = setInterval(() => {
      setTimerSeconds(prev => prev + 1);
    }, 1000);
  };

  const stopTimer = () => {
    setIsTimerRunning(false);
    if (timerInterval.current) {
      clearInterval(timerInterval.current);
      timerInterval.current = null;
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleVoiceToggle = () => {
    if (!isRecording) {
      startVoiceRecording();
    } else {
      stopVoiceRecording();
    }
  };

  const startVoiceRecording = () => {
    setIsRecording(true);
    // 模拟语音识别
    setTimeout(() => {
      if (isRecording) {
        setActivityText('今天上午进行了30分钟的康复训练，包括肩部和手臂的力量练习。下午散步了1小时，感觉体力比昨天有所提升。');
        stopVoiceRecording();
      }
    }, 3000);
  };

  const stopVoiceRecording = () => {
    setIsRecording(false);
  };

  const handleFileUpload = async (type: 'mri' | 'genetic' | 'blood') => {
    try {
      // 请求媒体库权限
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('权限不足', '需要访问相册权限才能上传文件');
        return;
      }

      // 显示上传中状态
      setUploadStatus(prev => ({
        ...prev,
        [type]: '上传中...',
      }));

      // 选择文件
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.All,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 1,
      });

      if (!result.canceled) {
        // 模拟上传过程
        setTimeout(() => {
          setUploadStatus(prev => ({
            ...prev,
            [type]: '已上传',
          }));
        }, 2000);
      } else {
        // 恢复原状态
        setUploadStatus(prev => ({
          ...prev,
          [type]: '未上传',
        }));
      }
    } catch (error) {
      console.error('文件上传失败:', error);
      setUploadStatus(prev => ({
        ...prev,
        [type]: '未上传',
      }));
      Alert.alert('上传失败', '文件上传过程中出现错误');
    }
  };

  const handleCameraCapture = async (type: 'mri' | 'genetic' | 'blood') => {
    try {
      // 请求相机权限
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('权限不足', '需要访问相机权限才能拍照');
        return;
      }

      // 显示上传中状态
      setUploadStatus(prev => ({
        ...prev,
        [type]: '上传中...',
      }));

      // 拍照
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 1,
      });

      if (!result.canceled) {
        // 模拟上传过程
        setTimeout(() => {
          setUploadStatus(prev => ({
            ...prev,
            [type]: '已上传',
          }));
        }, 2000);
      } else {
        // 恢复原状态
        setUploadStatus(prev => ({
          ...prev,
          [type]: '未上传',
        }));
      }
    } catch (error) {
      console.error('拍照失败:', error);
      setUploadStatus(prev => ({
        ...prev,
        [type]: '未上传',
      }));
      Alert.alert('拍照失败', '拍照过程中出现错误');
    }
  };

  const handleSubmit = async () => {
    try {
      setIsLoading(true);

      // 收集表单数据
      const formData = {
        mriReport: uploadStatus.mri === '已上传',
        geneticReport: uploadStatus.genetic === '已上传',
        bloodReport: uploadStatus.blood === '已上传',
        muscleStrength: muscleStrength.group ? muscleStrength : null,
        stairTestTime: timerSeconds > 0 ? timerSeconds : null,
        dailyActivity: activityText.trim(),
      };

      console.log('提交的数据:', formData);

      // 模拟提交过程
      await new Promise(resolve => setTimeout(resolve, 2000));

      Alert.alert('提交成功', '数据已成功录入！', [
        {
          text: '确定',
          onPress: () => {
            if (router.canGoBack()) {
              router.back();
            }
          },
        },
      ]);
    } catch (error) {
      console.error('提交失败:', error);
      Alert.alert('提交失败', '数据提交过程中出现错误');
    } finally {
      setIsLoading(false);
    }
  };

  const getMuscleGroupName = (group: string | null): string => {
    if (!group) return '请选择肌群';
    const muscleGroup = muscleGroups.find(mg => mg.id === group);
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
      {/* 顶部导航 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
          <FontAwesome6 name="arrow-left" size={16} color="#9CA3AF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>数据录入</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* 医疗报告上传 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>医疗报告</Text>

          {/* MRI报告上传 */}
          <View style={styles.uploadCard}>
            <View style={styles.uploadHeader}>
              <Text style={styles.uploadTitle}>MRI影像</Text>
              <Text style={[styles.uploadStatus, { color: getStatusColor(uploadStatus.mri) }]}>
                {uploadStatus.mri}
              </Text>
            </View>
            <View style={styles.uploadArea}>
              <TouchableOpacity
                style={[styles.cameraButton, { backgroundColor: 'rgba(150, 159, 255, 0.2)' }]}
                onPress={() => handleCameraCapture('mri')}
              >
                <FontAwesome6 name="camera" size={18} color="#969FFF" />
              </TouchableOpacity>
              <Text style={styles.uploadHint}>拍照上传或选择文件</Text>
              <TouchableOpacity onPress={() => handleFileUpload('mri')}>
                <Text style={[styles.uploadButtonText, { color: '#969FFF' }]}>选择文件</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 基因报告上传 */}
          <View style={styles.uploadCard}>
            <View style={styles.uploadHeader}>
              <Text style={styles.uploadTitle}>基因检测报告</Text>
              <Text style={[styles.uploadStatus, { color: getStatusColor(uploadStatus.genetic) }]}>
                {uploadStatus.genetic}
              </Text>
            </View>
            <View style={styles.uploadArea}>
              <TouchableOpacity
                style={[styles.cameraButton, { backgroundColor: 'rgba(81, 71, 255, 0.2)' }]}
                onPress={() => handleCameraCapture('genetic')}
              >
                <FontAwesome6 name="camera" size={18} color="#5147FF" />
              </TouchableOpacity>
              <Text style={styles.uploadHint}>拍照上传或选择文件</Text>
              <TouchableOpacity onPress={() => handleFileUpload('genetic')}>
                <Text style={[styles.uploadButtonText, { color: '#5147FF' }]}>选择文件</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 血检报告上传 */}
          <View style={styles.uploadCard}>
            <View style={styles.uploadHeader}>
              <Text style={styles.uploadTitle}>血检报告</Text>
              <Text style={[styles.uploadStatus, { color: getStatusColor(uploadStatus.blood) }]}>
                {uploadStatus.blood}
              </Text>
            </View>
            <View style={styles.uploadArea}>
              <TouchableOpacity
                style={[styles.cameraButton, { backgroundColor: 'rgba(62, 57, 135, 0.2)' }]}
                onPress={() => handleCameraCapture('blood')}
              >
                <FontAwesome6 name="camera" size={18} color="#3E3987" />
              </TouchableOpacity>
              <Text style={styles.uploadHint}>拍照上传或选择文件</Text>
              <TouchableOpacity onPress={() => handleFileUpload('blood')}>
                <Text style={[styles.uploadButtonText, { color: '#3E3987' }]}>选择文件</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* 肌力评分录入 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>肌力评分</Text>

          {/* 肌群选择 */}
          <View style={styles.muscleGroupGrid}>
            {muscleGroups.map(group => (
              <TouchableOpacity
                key={group.id}
                style={[
                  styles.muscleGroupItem,
                  muscleStrength.group === group.id && styles.muscleGroupItemActive,
                ]}
                onPress={() => handleMuscleGroupSelect(group.id)}
              >
                <FontAwesome6 name={group.icon} size={16} color={group.color} style={styles.muscleGroupIcon} />
                <Text style={styles.muscleGroupName}>{group.name}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 肌力滑动条 */}
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

            {/* 肌力等级说明 */}
            <View style={styles.strengthLabels}>
              {[0, 1, 2, 3, 4, 5].map(level => (
                <Text key={level} style={styles.strengthLabel}>
                  {level}级
                </Text>
              ))}
            </View>
          </View>
        </View>

        {/* 楼梯测试计时 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>楼梯测试</Text>

          <View style={styles.timerCard}>
            <View style={styles.timerIconContainer}>
              <FontAwesome6
                name={isTimerRunning ? 'stop' : timerSeconds > 0 ? 'check' : 'stopwatch'}
                size={24}
                color={isTimerRunning ? '#EF4444' : timerSeconds > 0 ? '#10B981' : '#10B981'}
              />
            </View>
            <Text style={styles.timerTitle}>爬楼计时</Text>
            <Text style={styles.timerDescription}>记录爬10级楼梯所需时间</Text>

            <Text style={styles.timerDisplay}>{formatTime(timerSeconds)}</Text>

            <TouchableOpacity
              style={[
                styles.timerButton,
                isTimerRunning && styles.timerButtonActive,
              ]}
              onPress={handleTimerToggle}
            >
              <Text style={[
                styles.timerButtonText,
                isTimerRunning && styles.timerButtonTextActive,
              ]}>
                {isTimerRunning ? '停止计时' : timerSeconds > 0 ? '重新计时' : '开始计时'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 日常活动记录 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>日常活动</Text>

          <View style={styles.activityCard}>
            <View style={styles.activityHeader}>
              <Text style={styles.activityTitle}>活动记录</Text>
              <TouchableOpacity
                style={[
                  styles.voiceButton,
                  isRecording && styles.voiceButtonActive,
                ]}
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
              placeholder="记录今天的活动情况，如：上午进行了30分钟的康复训练，下午散步1小时..."
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

      {/* 加载遮罩 */}
      <Modal
        visible={isLoading}
        transparent
        animationType="fade"
      >
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

