

import React, { useState, useRef, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, Modal, Alert, Dimensions, RefreshControl, } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import styles from './styles';

interface VideoItem {
  id: string;
  title: string;
  author: string;
  duration: string;
  poster: string;
  likes: number;
  views: number;
  publishTime: string;
  isVerified: boolean;
}

interface CorrectionTip {
  id: string;
  text: string;
  type: 'positive' | 'suggestion';
}

const RehabShareScreen: React.FC = () => {
  const router = useRouter();
  const [isVideoPlayerVisible, setIsVideoPlayerVisible] = useState(false);
  const [isUploadModalVisible, setIsUploadModalVisible] = useState(false);
  const [isProgressModalVisible, setIsProgressModalVisible] = useState(false);
  const [isSuccessToastVisible, setIsSuccessToastVisible] = useState(false);
  const [isActionCorrectionVisible, setIsActionCorrectionVisible] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<VideoItem | null>(null);
  const [videoProgress, setVideoProgress] = useState(0);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [correctionText, setCorrectionText] = useState('');
  
  const videoProgressInterval = useRef<number | null>(null);
  const uploadProgressInterval = useRef<number | null>(null);

  const videoList: VideoItem[] = [
    {
      id: '1',
      title: '三角肌强化训练',
      author: '康复师李医生',
      duration: '05:32',
      poster: 'https://s.coze.cn/image/cv0jPNeZLys/',
      likes: 128,
      views: 1200,
      publishTime: '2天前',
      isVerified: true,
    },
    {
      id: '2',
      title: '前锯肌功能恢复',
      author: '康复师王医生',
      duration: '03:45',
      poster: 'https://s.coze.cn/image/lpqX7sOLbmk/',
      likes: 89,
      views: 856,
      publishTime: '1周前',
      isVerified: true,
    },
    {
      id: '3',
      title: '肩部拉伸放松',
      author: '康复师张医生',
      duration: '04:12',
      poster: 'https://s.coze.cn/image/BXZvw5WCiMk/',
      likes: 156,
      views: 2100,
      publishTime: '3天前',
      isVerified: true,
    },
    {
      id: '4',
      title: '居家简易训练',
      author: '患者张先生',
      duration: '06:20',
      poster: 'https://s.coze.cn/image/JGjTFuxVpdY/',
      likes: 73,
      views: 445,
      publishTime: '5天前',
      isVerified: false,
    },
  ];

  const correctionTips: CorrectionTip[] = [
    { id: '1', text: '您的动作非常标准，继续保持！', type: 'positive' },
    { id: '2', text: '注意保持正确的姿势，避免受伤', type: 'suggestion' },
    { id: '3', text: '动作幅度可以再大一些，效果会更好', type: 'suggestion' },
    { id: '4', text: '节奏控制得很好，坚持下去', type: 'positive' },
    { id: '5', text: '肩膀放松，不要过于紧张', type: 'suggestion' },
  ];

  const handleBackPress = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/p-community');
    }
  };

  const handleUploadPress = () => {
    setIsUploadModalVisible(true);
  };

  const handleCameraUpload = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('权限不足', '需要相机权限才能拍摄视频');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        quality: 1,
      });

      if (!result.canceled) {
        setIsUploadModalVisible(false);
        showUploadProgress();
      }
    } catch (error) {
      console.error('Camera upload error:', error);
      Alert.alert('错误', '拍摄视频时出现错误');
    }
  };

  const handleFileUpload = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('权限不足', '需要相册权限才能选择视频');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: true,
        quality: 1,
      });

      if (!result.canceled) {
        setIsUploadModalVisible(false);
        showUploadProgress();
      }
    } catch (error) {
      console.error('File upload error:', error);
      Alert.alert('错误', '选择视频时出现错误');
    }
  };

  const showUploadProgress = () => {
    setIsProgressModalVisible(true);
    setUploadProgress(0);

    uploadProgressInterval.current = setInterval(() => {
      setUploadProgress(prev => {
        const newProgress = prev + Math.random() * 15;
        if (newProgress >= 100) {
          if (uploadProgressInterval.current) {
            clearInterval(uploadProgressInterval.current);
            uploadProgressInterval.current = null;
          }
          setTimeout(() => {
            setIsProgressModalVisible(false);
            showSuccessToast();
          }, 500);
          return 100;
        }
        return newProgress;
      });
    }, 200) as unknown as number;
  };

  const showSuccessToast = () => {
    setIsSuccessToastVisible(true);
    setTimeout(() => {
      setIsSuccessToastVisible(false);
    }, 3000);
  };

  const handleVideoPress = (video: VideoItem) => {
    setCurrentVideo(video);
    setIsVideoPlayerVisible(true);
    setVideoProgress(0);
    setIsVideoPlaying(false);
    
    // 模拟播放延迟
    setTimeout(() => {
      startVideoPlayback();
    }, 500);
  };

  const startVideoPlayback = () => {
    setIsVideoPlaying(true);
    setVideoProgress(0);

    videoProgressInterval.current = setInterval(() => {
      setVideoProgress(prev => {
        const newProgress = prev + 0.5;
        if (newProgress >= 100) {
          stopVideoPlayback();
          return 100;
        }

        // 随机显示动作捕捉纠错
        if (Math.random() > 0.95) {
          showRandomCorrection();
        }

        return newProgress;
      });
    }, 100) as unknown as number;
  };

  const stopVideoPlayback = () => {
    setIsVideoPlaying(false);
    if (videoProgressInterval.current) {
      clearInterval(videoProgressInterval.current);
      videoProgressInterval.current = null;
    }
    setVideoProgress(0);
  };

  const showRandomCorrection = () => {
    const randomTip = correctionTips[Math.floor(Math.random() * correctionTips.length)];
    setCorrectionText(randomTip.text);
    setIsActionCorrectionVisible(true);
    
    setTimeout(() => {
      setIsActionCorrectionVisible(false);
    }, 3000);
  };

  const handleLikePress = () => {
    if (currentVideo) {
      setCurrentVideo(prev => prev ? { ...prev, likes: prev.likes + 1 } : null);
    }
  };

  const handleSharePress = () => {
    Alert.alert('分享', '分享功能需要调用系统分享API');
  };

  const handleFullscreenPress = () => {
    Alert.alert('全屏', '全屏功能需要调用全屏API');
  };

  const handleFilterPress = () => {
    Alert.alert('筛选', '筛选功能开发中');
  };

  const handleSortPress = () => {
    Alert.alert('排序', '排序功能开发中');
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    // 模拟刷新延迟
    setTimeout(() => {
      setIsRefreshing(false);
    }, 1000);
  };

  const formatViewCount = (count: number): string => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}k`;
    }
    return count.toString();
  };

  const formatTime = (progress: number): string => {
    const totalSeconds = 332; // 5:32 in seconds
    const currentSeconds = Math.floor((progress / 100) * totalSeconds);
    const minutes = Math.floor(currentSeconds / 60);
    const seconds = currentSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    return () => {
      if (videoProgressInterval.current) {
        clearInterval(videoProgressInterval.current);
      }
      if (uploadProgressInterval.current) {
        clearInterval(uploadProgressInterval.current);
      }
    };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      {/* 顶部导航栏 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
          <FontAwesome6 name="arrow-left" size={16} color="rgba(255, 255, 255, 0.7)" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>康复经验分享</Text>
        <TouchableOpacity style={styles.uploadButton} onPress={handleUploadPress}>
          <FontAwesome6 name="plus" size={16} color="#969FFF" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      >
        {/* 视频播放器区域 */}
        {isVideoPlayerVisible && currentVideo && (
          <View style={styles.videoPlayerSection}>
            <View style={styles.videoPlayerContainer}>
              {/* 视频播放器 */}
              <View style={styles.videoPlayer}>
                <Image source={{ uri: currentVideo.poster }} style={styles.videoPoster} />
                {!isVideoPlaying && (
                  <View style={styles.videoOverlay}>
                    <TouchableOpacity style={styles.playButton} onPress={startVideoPlayback}>
                      <FontAwesome6 name="play" size={20} color="#FFFFFF" style={styles.playIcon} />
                    </TouchableOpacity>
                  </View>
                )}
                {/* 视频信息 */}
                <View style={styles.videoInfo}>
                  <Text style={styles.videoTitle}>{currentVideo.title}</Text>
                  <View style={styles.videoMeta}>
                    <Text style={styles.videoAuthor}>{currentVideo.author}</Text>
                    <Text style={styles.videoDuration}>{currentVideo.duration}</Text>
                  </View>
                </View>
              </View>
              
              {/* 视频控制栏 */}
              <View style={styles.videoControls}>
                <View style={styles.videoActions}>
                  <View style={styles.videoActionButtons}>
                    <TouchableOpacity style={styles.actionButton} onPress={handleLikePress}>
                      <FontAwesome6 name="heart" size={14} color="rgba(255, 255, 255, 0.7)" />
                      <Text style={styles.actionButtonText}>{currentVideo.likes}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionButton} onPress={handleSharePress}>
                      <FontAwesome6 name="share" size={14} color="rgba(255, 255, 255, 0.7)" />
                      <Text style={styles.actionButtonText}>分享</Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity style={styles.fullscreenButton} onPress={handleFullscreenPress}>
                    <FontAwesome6 name="expand" size={14} color="rgba(255, 255, 255, 0.7)" />
                  </TouchableOpacity>
                </View>
                
                {/* 进度条 */}
                <View style={styles.progressContainer}>
                  <Text style={styles.timeText}>{formatTime(videoProgress)}</Text>
                  <View style={styles.progressBarContainer}>
                    <View style={[styles.progressBar, { width: `${videoProgress}%` }]} />
                  </View>
                  <Text style={styles.timeText}>{currentVideo.duration}</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* 动作捕捉纠错提示 */}
        {isActionCorrectionVisible && (
          <View style={styles.actionCorrectionSection}>
            <View style={styles.correctionCard}>
              <View style={styles.correctionContent}>
                <View style={styles.correctionIcon}>
                  <FontAwesome6 name="wand-magic-sparkles" size={16} color="#10B981" />
                </View>
                <View style={styles.correctionTextContainer}>
                  <Text style={styles.correctionTitle}>动作捕捉分析</Text>
                  <Text style={styles.correctionDescription}>{correctionText}</Text>
                </View>
                <TouchableOpacity onPress={() => setIsActionCorrectionVisible(false)}>
                  <FontAwesome6 name="xmark" size={14} color="rgba(255, 255, 255, 0.5)" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* 康复视频列表 */}
        {!isVideoPlayerVisible && (
          <View style={styles.videoListSection}>
            <View style={styles.videoListHeader}>
              <Text style={styles.sectionTitle}>推荐训练视频</Text>
              <View style={styles.listActions}>
                <TouchableOpacity style={styles.actionIconButton} onPress={handleFilterPress}>
                  <FontAwesome6 name="filter" size={12} color="rgba(255, 255, 255, 0.7)" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionIconButton} onPress={handleSortPress}>
                  <FontAwesome6 name="sort" size={12} color="rgba(255, 255, 255, 0.7)" />
                </TouchableOpacity>
              </View>
            </View>
            
            <View style={styles.videoList}>
              {videoList.map((video) => (
                <TouchableOpacity
                  key={video.id}
                  style={styles.videoCard}
                  onPress={() => handleVideoPress(video)}
                >
                  <View style={styles.videoCardContent}>
                    <View style={styles.videoThumbnailContainer}>
                      <Image source={{ uri: video.poster }} style={styles.videoThumbnail} />
                      <View style={styles.thumbnailOverlay}>
                        <FontAwesome6 name="play" size={12} color="#FFFFFF" />
                      </View>
                      <View style={styles.durationBadge}>
                        <Text style={styles.durationText}>{video.duration}</Text>
                      </View>
                    </View>
                    <View style={styles.videoCardInfo}>
                      <Text style={styles.videoCardTitle} numberOfLines={1}>
                        {video.title}
                      </Text>
                      <View style={styles.videoCardMeta}>
                        <Text style={styles.videoCardAuthor}>
                          {video.author} · {video.isVerified ? '认证' : '分享'}
                        </Text>
                      </View>
                      <View style={styles.videoCardStats}>
                        <View style={styles.videoCardStatsLeft}>
                          <View style={styles.statItem}>
                            <FontAwesome6 name="heart" size={10} color="#EF4444" />
                            <Text style={styles.statText}>{video.likes}</Text>
                          </View>
                          <View style={styles.statItem}>
                            <FontAwesome6 name="eye" size={10} color="rgba(255, 255, 255, 0.5)" />
                            <Text style={styles.statText}>{formatViewCount(video.views)}</Text>
                          </View>
                        </View>
                        <Text style={styles.publishTime}>{video.publishTime}</Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      {/* 上传视频弹窗 */}
      <Modal
        visible={isUploadModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setIsUploadModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.uploadModal}>
            <View style={styles.uploadModalHeader}>
              <Text style={styles.uploadModalTitle}>上传康复视频</Text>
              <Text style={styles.uploadModalSubtitle}>分享您的康复训练经验</Text>
            </View>
            
            <View style={styles.uploadModalContent}>
              <TouchableOpacity style={styles.uploadOption} onPress={handleCameraUpload}>
                <View style={styles.uploadOptionIcon}>
                  <FontAwesome6 name="camera" size={16} color="#969FFF" />
                </View>
                <Text style={styles.uploadOptionText}>拍摄视频</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.uploadOption} onPress={handleFileUpload}>
                <View style={styles.uploadOptionIconSecondary}>
                  <FontAwesome6 name="folder-open" size={16} color="#5147FF" />
                </View>
                <Text style={styles.uploadOptionText}>选择文件</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setIsUploadModalVisible(false)}
              >
                <Text style={styles.cancelButtonText}>取消</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 上传进度弹窗 */}
      <Modal
        visible={isProgressModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsProgressModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.progressModal}>
            <View style={styles.progressModalIcon}>
              <FontAwesome6 name="cloud-arrow-up" size={24} color="#969FFF" />
            </View>
            <Text style={styles.progressModalTitle}>上传中...</Text>
            <Text style={styles.progressModalSubtitle}>视频正在上传，请稍候</Text>
            
            <View style={styles.uploadProgressBarContainer}>
              <View style={[styles.uploadProgressBar, { width: `${uploadProgress}%` }]} />
            </View>
            
            <Text style={styles.progressText}>{Math.round(uploadProgress)}%</Text>
          </View>
        </View>
      </Modal>

      {/* 成功提示 */}
      {isSuccessToastVisible && (
        <View style={styles.successToast}>
          <View style={styles.successToastContent}>
            <View style={styles.successIcon}>
              <FontAwesome6 name="check" size={12} color="#10B981" />
            </View>
            <Text style={styles.successText}>视频已提交审核</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
};

export default RehabShareScreen;

