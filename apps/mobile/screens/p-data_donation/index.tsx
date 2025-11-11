

import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import styles from './styles';

const DataDonationScreen = () => {
  const router = useRouter();
  const [isDonationEnabled, setIsDonationEnabled] = useState(false);
  const [isConfirmModalVisible, setIsConfirmModalVisible] = useState(false);
  const [isSuccessToastVisible, setIsSuccessToastVisible] = useState(false);
  const [lastDonationTime, setLastDonationTime] = useState('2024年1月15日');
  const [donationDays, setDonationDays] = useState(15);
  const [donationItems, setDonationItems] = useState(42);

  const handleBackPress = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  const handleDonationToggle = () => {
    if (!isDonationEnabled) {
      setIsConfirmModalVisible(true);
    } else {
      toggleDonation(false);
    }
  };

  const handleEnableDonationPress = () => {
    setIsConfirmModalVisible(true);
  };

  const handleModalCancel = () => {
    setIsConfirmModalVisible(false);
  };

  const handleModalConfirm = () => {
    setIsConfirmModalVisible(false);
    toggleDonation(true);
  };

  const toggleDonation = (enable: boolean) => {
    setIsDonationEnabled(enable);
    
    if (enable) {
      // 开启捐赠，更新时间
      const now = new Date();
      const currentTime = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
      setLastDonationTime(currentTime);
    }
    
    showSuccessToast();
  };

  const showSuccessToast = () => {
    setIsSuccessToastVisible(true);
    setTimeout(() => {
      setIsSuccessToastVisible(false);
    }, 2000);
  };

  const renderProgressRing = () => {
    const radius = 40;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (circumference * 0.75); // 75% progress

    return (
      <View style={styles.progressRingContainer}>
        <Svg width={40} height={40} style={styles.progressRing}>
          <Defs>
            <SvgLinearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <Stop offset="0%" stopColor="#969FFF" />
              <Stop offset="100%" stopColor="#5147FF" />
            </SvgLinearGradient>
          </Defs>
          <Circle
            cx="20"
            cy="20"
            r={radius}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="4"
            fill="none"
          />
          <Circle
            cx="20"
            cy="20"
            r={radius}
            stroke="url(#gradient)"
            strokeWidth="4"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform="rotate(-90 20 20)"
          />
        </Svg>
        <View style={styles.progressRingIcon}>
          <FontAwesome6 name="heart" size={18} color="#969FFF" solid />
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* 顶部导航栏 */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
            <FontAwesome6 name="arrow-left" size={16} color="rgba(255, 255, 255, 0.7)" />
          </TouchableOpacity>
          <Text style={styles.pageTitle}>数据捐赠</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* 捐赠说明区域 */}
        <View style={styles.donationIntroSection}>
          <View style={styles.introCard}>
            <LinearGradient
              colors={['#969FFF', '#5147FF']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.donationIcon}
            >
              <FontAwesome6 name="heart" size={18} color="#FFFFFF" solid />
            </LinearGradient>
            <Text style={styles.introTitle}>为FSHD研究贡献力量</Text>
            <Text style={styles.introDescription}>
              您的匿名化数据将帮助科学家更好地了解FSHD，加速新药研发和治疗方案的改进，为全球FSHD患者带来希望。
            </Text>
          </View>
        </View>

        {/* 捐赠流程说明 */}
        <View style={styles.donationProcessSection}>
          <Text style={styles.sectionTitle}>捐赠流程</Text>
          <View style={styles.processSteps}>
            <View style={styles.processStep}>
              <View style={[styles.stepNumber, styles.stepNumberPrimary]}>
                <Text style={styles.stepNumberTextPrimary}>1</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>授权捐赠</Text>
                <Text style={styles.stepDescription}>开启捐赠开关，同意数据使用协议</Text>
              </View>
            </View>
            
            <View style={styles.processStep}>
              <View style={[styles.stepNumber, styles.stepNumberSecondary]}>
                <Text style={styles.stepNumberTextSecondary}>2</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>数据脱敏</Text>
                <Text style={styles.stepDescription}>系统自动移除所有个人身份信息</Text>
              </View>
            </View>
            
            <View style={styles.processStep}>
              <View style={[styles.stepNumber, styles.stepNumberAccent]}>
                <Text style={styles.stepNumberTextAccent}>3</Text>
              </View>
              <View style={styles.stepContent}>
                <Text style={styles.stepTitle}>科研使用</Text>
                <Text style={styles.stepDescription}>数据汇入中国FSHD队列数据库</Text>
              </View>
            </View>
          </View>
        </View>

        {/* 隐私保护说明 */}
        <View style={styles.privacyProtectionSection}>
          <Text style={styles.sectionTitle}>隐私保护承诺</Text>
          <View style={styles.privacyCard}>
            <View style={styles.privacyFeatures}>
              <View style={styles.privacyItem}>
                <View style={[styles.privacyIcon, styles.privacyIconGreen]}>
                  <FontAwesome6 name="shield-halved" size={10} color="#10B981" />
                </View>
                <Text style={styles.privacyText}>匿名化处理，无法识别个人身份</Text>
              </View>
              
              <View style={styles.privacyItem}>
                <View style={[styles.privacyIcon, styles.privacyIconBlue]}>
                  <FontAwesome6 name="lock" size={10} color="#3B82F6" />
                </View>
                <Text style={styles.privacyText}>区块链技术确保数据安全</Text>
              </View>
              
              <View style={styles.privacyItem}>
                <View style={[styles.privacyIcon, styles.privacyIconPurple]}>
                  <FontAwesome6 name="eye-slash" size={10} color="#8B5CF6" />
                </View>
                <Text style={styles.privacyText}>仅用于科研，不用于商业用途</Text>
              </View>
              
              <View style={styles.privacyItem}>
                <View style={[styles.privacyIcon, styles.privacyIconYellow]}>
                  <FontAwesome6 name="toggle-on" size={10} color="#F59E0B" />
                </View>
                <Text style={styles.privacyText}>随时可关闭捐赠，完全自主控制</Text>
              </View>
            </View>
          </View>
        </View>

        {/* 捐赠授权开关 */}
        <View style={styles.donationToggleSection}>
          <View style={styles.toggleCard}>
            <View style={styles.toggleContent}>
              <View style={styles.toggleTextContainer}>
                <Text style={styles.toggleTitle}>允许匿名化数据捐赠</Text>
                <Text style={styles.toggleDescription}>您的贡献将帮助推动FSHD研究进展</Text>
              </View>
              <TouchableOpacity
                style={[styles.toggleSwitch, isDonationEnabled && styles.toggleSwitchActive]}
                onPress={handleDonationToggle}
              >
                <View style={[styles.toggleThumb, isDonationEnabled && styles.toggleThumbActive]} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* 捐赠状态显示 */}
        <View style={styles.donationStatusSection}>
          <Text style={styles.sectionTitle}>捐赠状态</Text>
          
          {!isDonationEnabled ? (
            <View style={styles.notDonatingCard}>
              <View style={styles.notDonatingIcon}>
                <FontAwesome6 name="heart" size={18} color="#9CA3AF" />
              </View>
              <Text style={styles.notDonatingTitle}>暂未开启数据捐赠</Text>
              <Text style={styles.notDonatingDescription}>开启捐赠后，您的数据将为FSHD研究做出重要贡献</Text>
              <TouchableOpacity style={styles.enableDonationButton} onPress={handleEnableDonationPress}>
                <Text style={styles.enableDonationButtonText}>立即开启</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.donatingCard}>
              {renderProgressRing()}
              <Text style={styles.donatingTitle}>感谢您的爱心捐赠</Text>
              <Text style={styles.donatingDescription}>您的数据正在为FSHD研究提供重要支持</Text>
              <Text style={styles.lastDonationTime}>上次捐赠时间：{lastDonationTime}</Text>
              <View style={styles.donationStats}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{donationDays}</Text>
                  <Text style={styles.statLabel}>捐赠天数</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{donationItems}</Text>
                  <Text style={styles.statLabel}>数据条目</Text>
                </View>
              </View>
            </View>
          )}
        </View>
      </ScrollView>

      {/* 确认弹窗 */}
      <Modal
        visible={isConfirmModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleModalCancel}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>确认开启数据捐赠</Text>
            <Text style={styles.modalDescription}>
              开启后，您的医疗数据将经过严格脱敏处理，用于FSHD科研研究。您可以随时关闭捐赠功能。
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelButton} onPress={handleModalCancel}>
                <Text style={styles.modalCancelButtonText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirmButton} onPress={handleModalConfirm}>
                <Text style={styles.modalConfirmButtonText}>确认开启</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 成功提示 */}
      {isSuccessToastVisible && (
        <View style={styles.successToast}>
          <FontAwesome6 name="circle-check" size={12} color="#10B981" />
          <Text style={styles.successToastText}>设置已保存</Text>
        </View>
      )}
    </SafeAreaView>
  );
};

export default DataDonationScreen;

