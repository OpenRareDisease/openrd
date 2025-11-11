

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import styles from './styles';

const HomeScreen = () => {
  const router = useRouter();
  const [isNotificationModalVisible, setIsNotificationModalVisible] = useState(false);

  const handleNotificationPress = () => {
    setIsNotificationModalVisible(true);
  };

  const handleCloseNotification = () => {
    setIsNotificationModalVisible(false);
  };

  const handleUserAvatarPress = () => {
    router.push('/p-settings');
  };

  const handleHealthCardPress = () => {
    router.push('/p-archive');
  };

  const handleRiskAlertPress = () => {
    router.push('/p-manage');
  };

  const handleFeatureQNAPress = () => {
    router.push('/p-qna');
  };

  const handleFeatureArchivePress = () => {
    router.push('/p-archive');
  };

  const handleFeatureManagePress = () => {
    router.push('/p-manage');
  };

  const handleFeatureCommunityPress = () => {
    router.push('/p-community');
  };

  const handleTrialRecommendationPress = () => {
    router.push('/p-trial_square');
  };

  const handleRehabRecommendationPress = () => {
    router.push('/p-rehab_share');
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
        <ScrollView 
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* 顶部用户信息区域 */}
          <View style={styles.header}>
            <View style={styles.userInfo}>
              <View style={styles.userProfile}>
                <TouchableOpacity onPress={handleUserAvatarPress}>
                  <LinearGradient
                    colors={['#969FFF', '#5147FF']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.userAvatar}
                  >
                    <Image
                      source={{ uri: 'https://s.coze.cn/image/ya2aI2K_pOI/' }}
                      style={styles.avatarImage}
                    />
                  </LinearGradient>
                </TouchableOpacity>
                <View style={styles.userDetails}>
                  <Text style={styles.userName}>张先生</Text>
                  <Text style={styles.userGreeting}>今天也要保持健康哦</Text>
                </View>
              </View>
              <TouchableOpacity 
                style={styles.notificationButton}
                onPress={handleNotificationPress}
              >
                <FontAwesome6 name="bell" size={16} color="rgba(255, 255, 255, 0.7)" />
                <View style={styles.notificationBadge} />
              </TouchableOpacity>
            </View>
          </View>

          {/* 健康状态概览卡片 */}
          <View style={styles.healthOverviewSection}>
            <TouchableOpacity style={styles.healthCard} onPress={handleHealthCardPress}>
              <View style={styles.healthHeader}>
                <Text style={styles.healthTitle}>健康概览</Text>
                <View style={styles.healthStatus}>
                  <View style={styles.statusIndicator} />
                  <Text style={styles.statusText}>稳定</Text>
                </View>
              </View>
              
              {/* 肌力雷达图 */}
              <View style={styles.muscleStrengthContainer}>
                <View style={styles.muscleRingContainer}>
                  <View style={styles.muscleRing}>
                    <View style={styles.muscleRingInner}>
                      <LinearGradient
                        colors={['#969FFF', '#5147FF']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={styles.gradientTextWrapper}
                      >
                        <Text style={styles.averageScore}>4.2</Text>
                      </LinearGradient>
                      <Text style={styles.averageLabel}>平均分</Text>
                    </View>
                  </View>
                </View>
              </View>
              
              {/* 快速数据 */}
              <View style={styles.quickStats}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>12s</Text>
                  <Text style={styles.statLabel}>爬楼时间</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: '#5147FF' }]}>6,842</Text>
                  <Text style={styles.statLabel}>今日步数</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statValue, { color: '#3E3987' }]}>15</Text>
                  <Text style={styles.statLabel}>连续记录</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>

          {/* 风险预警 */}
          <View style={styles.riskAlertSection}>
            <TouchableOpacity style={styles.alertCard} onPress={handleRiskAlertPress}>
              <View style={styles.alertContent}>
                <View style={styles.alertIconContainer}>
                  <FontAwesome6 name="triangle-exclamation" size={14} color="#FBBF24" />
                </View>
                <View style={styles.alertTextContainer}>
                  <Text style={styles.alertTitle}>注意</Text>
                  <Text style={styles.alertDescription}>三角肌肌力略有下降，建议加强训练</Text>
                </View>
                <FontAwesome6 name="chevron-right" size={12} color="#FBBF24" />
              </View>
            </TouchableOpacity>
          </View>

          {/* 核心功能模块 */}
          <View style={styles.featuresSection}>
            <Text style={styles.sectionTitle}>核心功能</Text>
            <View style={styles.featuresGrid}>
              <TouchableOpacity style={styles.featureCard} onPress={handleFeatureQNAPress}>
                <View style={[styles.featureIconContainer, { backgroundColor: 'rgba(150, 159, 255, 0.2)' }]}>
                  <FontAwesome6 name="circle-question" size={18} color="#969FFF" />
                </View>
                <Text style={styles.featureTitle}>智能问答</Text>
                <Text style={styles.featureDescription}>专业知识查询</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.featureCard} onPress={handleFeatureArchivePress}>
                <View style={[styles.featureIconContainer, { backgroundColor: 'rgba(81, 71, 255, 0.2)' }]}>
                  <FontAwesome6 name="file-medical" size={18} color="#5147FF" />
                </View>
                <Text style={styles.featureTitle}>我的档案</Text>
                <Text style={styles.featureDescription}>医疗数据管理</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.featureCard} onPress={handleFeatureManagePress}>
                <View style={[styles.featureIconContainer, { backgroundColor: 'rgba(62, 57, 135, 0.2)' }]}>
                  <FontAwesome6 name="chart-line" size={14} color="#3E3987" />
                </View>
                <Text style={styles.featureTitle}>病程管理</Text>
                <Text style={styles.featureDescription}>肌力趋势分析</Text>
              </TouchableOpacity>
              
              <TouchableOpacity style={styles.featureCard} onPress={handleFeatureCommunityPress}>
                <View style={[styles.featureIconContainer, { backgroundColor: 'rgba(34, 197, 94, 0.2)' }]}>
                  <FontAwesome6 name="users" size={14} color="#22C55E" />
                </View>
                <Text style={styles.featureTitle}>患者社区</Text>
                <Text style={styles.featureDescription}>经验交流分享</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* 个性化推荐 */}
          <View style={styles.recommendationsSection}>
            <Text style={styles.sectionTitle}>为您推荐</Text>
            
            {/* 临床试验匹配 */}
            <TouchableOpacity 
              style={styles.recommendationCard} 
              onPress={handleTrialRecommendationPress}
            >
              <View style={styles.recommendationHeader}>
                <Text style={styles.recommendationTitle}>临床试验匹配</Text>
                <View style={styles.matchBadge}>
                  <Text style={styles.matchBadgeText}>83%匹配</Text>
                </View>
              </View>
              <Text style={styles.recommendationDescription}>您符合"FSHD基因治疗试验"的主要入组条件</Text>
              <Text style={styles.recommendationAction}>查看详情 →</Text>
            </TouchableOpacity>
            
            {/* 康复建议 */}
            <TouchableOpacity 
              style={styles.recommendationCard} 
              onPress={handleRehabRecommendationPress}
            >
              <View style={styles.rehabHeader}>
                <View style={styles.rehabIconContainer}>
                  <FontAwesome6 name="play" size={12} color="#3B82F6" />
                </View>
                <View style={styles.rehabTextContainer}>
                  <Text style={styles.recommendationTitle}>个性化康复训练</Text>
                  <Text style={styles.recommendationDescription}>针对三角肌的3个训练视频</Text>
                </View>
              </View>
              <Text style={styles.rehabAction}>立即训练 →</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* 通知弹窗 */}
        <Modal
          visible={isNotificationModalVisible}
          transparent={true}
          animationType="fade"
          onRequestClose={handleCloseNotification}
        >
          <TouchableOpacity 
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={handleCloseNotification}
          >
            <TouchableOpacity 
              style={styles.notificationModal}
              activeOpacity={1}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>消息通知</Text>
                <TouchableOpacity onPress={handleCloseNotification}>
                  <FontAwesome6 name="xmark" size={16} color="rgba(255, 255, 255, 0.5)" />
                </TouchableOpacity>
              </View>
              <View style={styles.notificationList}>
                <View style={styles.notificationItem}>
                  <View style={[styles.notificationDot, { backgroundColor: '#969FFF' }]} />
                  <View style={styles.notificationContent}>
                    <Text style={styles.notificationText}>您的肌力评估数据已更新</Text>
                    <Text style={styles.notificationTime}>2小时前</Text>
                  </View>
                </View>
                <View style={styles.notificationItem}>
                  <View style={[styles.notificationDot, { backgroundColor: '#22C55E' }]} />
                  <View style={styles.notificationContent}>
                    <Text style={styles.notificationText}>新的临床试验匹配结果</Text>
                    <Text style={styles.notificationTime}>1天前</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
      </LinearGradient>
    </SafeAreaView>
  );
};

export default HomeScreen;

