

import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import styles from './styles';
import ToggleSwitch from './components/ToggleSwitch';
import ConfirmModal from './components/ConfirmModal';
import SuccessToast from './components/SuccessToast';

interface ToggleInfo {
  id: string;
  newState: boolean;
}

const PrivacySettingsScreen = () => {
  const router = useRouter();
  
  // 开关状态管理
  const [isTrialPermissionEnabled, setIsTrialPermissionEnabled] = useState(true);
  const [isDonationPermissionEnabled, setIsDonationPermissionEnabled] = useState(false);
  const [isHospitalSyncEnabled, setIsHospitalSyncEnabled] = useState(true);
  const [isCommunityShareEnabled, setIsCommunityShareEnabled] = useState(true);
  
  // 弹窗和提示状态
  const [isConfirmModalVisible, setIsConfirmModalVisible] = useState(false);
  const [isSuccessToastVisible, setIsSuccessToastVisible] = useState(false);
  const [currentToggleInfo, setCurrentToggleInfo] = useState<ToggleInfo | null>(null);
  const [modalConfig, setModalConfig] = useState({
    title: '',
    message: '',
    icon: ''
  });

  const handleBackPress = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  const handleDonationDetailsPress = () => {
    router.push('/p-data_donation');
  };

  const showConfirmModal = (toggleId: string, newState: boolean) => {
    let title = '';
    let message = '';
    let icon = '';

    switch (toggleId) {
      case 'trial-permission':
        title = newState ? '开启临床试验授权' : '关闭临床试验授权';
        message = newState 
          ? '开启后，临床试验机构将能够访问您的档案数据以评估入组资格。您可以随时在此页面关闭此授权。'
          : '关闭后，临床试验机构将无法访问您的档案数据，可能影响您参与临床试验的机会。';
        icon = newState ? 'check-circle' : 'exclamation-triangle';
        break;
      case 'donation-permission':
        title = newState ? '开启数据捐赠' : '关闭数据捐赠';
        message = newState
          ? '开启后，您的匿名化数据将被捐赠给FSHD科研项目，助力医学研究。我们会严格保护您的隐私。'
          : '关闭后，您的数据将不再被捐赠给科研项目。之前捐赠的数据仍将用于科研。';
        icon = newState ? 'heart' : 'heart-crack';
        break;
      case 'hospital-sync':
        title = newState ? '开启医院数据同步' : '关闭医院数据同步';
        message = newState
          ? '开启后，医院HIS系统将自动同步您的随访数据到个人档案，减少重复录入。'
          : '关闭后，医院数据将不会自动同步，您需要手动录入随访信息。';
        icon = newState ? 'arrows-rotate' : 'circle-xmark';
        break;
      case 'community-share':
        title = newState ? '开启社区分享' : '关闭社区分享';
        message = newState
          ? '开启后，您可以在社区中分享康复经验和训练视频，帮助其他患者。'
          : '关闭后，您将无法在社区中发布内容，但仍可浏览他人分享。';
        icon = newState ? 'share-nodes' : 'lock';
        break;
    }

    setModalConfig({ title, message, icon });
    setCurrentToggleInfo({ id: toggleId, newState });
    setIsConfirmModalVisible(true);
  };

  const hideConfirmModal = () => {
    setIsConfirmModalVisible(false);
    setCurrentToggleInfo(null);
  };

  const confirmToggle = () => {
    if (!currentToggleInfo) return;

    const { id, newState } = currentToggleInfo;

    switch (id) {
      case 'trial-permission':
        setIsTrialPermissionEnabled(newState);
        break;
      case 'donation-permission':
        setIsDonationPermissionEnabled(newState);
        break;
      case 'hospital-sync':
        setIsHospitalSyncEnabled(newState);
        break;
      case 'community-share':
        setIsCommunityShareEnabled(newState);
        break;
    }

    showSuccessToast();
    hideConfirmModal();
  };

  const showSuccessToast = () => {
    setIsSuccessToastVisible(true);
    setTimeout(() => {
      setIsSuccessToastVisible(false);
    }, 3000);
  };

  const getDonationStatus = () => {
    if (!isDonationPermissionEnabled) {
      return {
        status: '未授权',
        statusColor: '#8E8E93',
        lastDonation: '--',
        donatedCount: '0 条'
      };
    }

    return {
      status: '已授权',
      statusColor: '#34C759',
      lastDonation: new Date().toLocaleDateString(),
      donatedCount: '12 条'
    };
  };

  const donationStatus = getDonationStatus();

  return (
    <SafeAreaView style={styles.container}>
      {/* 顶部导航栏 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBackPress}>
          <FontAwesome6 name="chevron-left" size={16} color="#8E8E93" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>隐私设置</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* 数据授权设置 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>数据授权</Text>
          
          {/* 临床试验数据授权 */}
          <View style={styles.settingItem}>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>临床试验数据授权</Text>
              <Text style={styles.settingDescription}>
                允许临床试验机构访问您的档案数据以评估入组资格
              </Text>
            </View>
            <ToggleSwitch
              isEnabled={isTrialPermissionEnabled}
              onToggle={(newState) => showConfirmModal('trial-permission', newState)}
            />
          </View>

          {/* 匿名化数据捐赠 */}
          <View style={styles.settingItem}>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>匿名化数据捐赠</Text>
              <Text style={styles.settingDescription}>
                将您的匿名化数据捐赠给FSHD科研项目
              </Text>
            </View>
            <ToggleSwitch
              isEnabled={isDonationPermissionEnabled}
              onToggle={(newState) => showConfirmModal('donation-permission', newState)}
            />
          </View>

          {/* 医院数据同步 */}
          <View style={styles.settingItem}>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>医院数据同步</Text>
              <Text style={styles.settingDescription}>
                允许医院HIS系统同步您的随访数据到个人档案
              </Text>
            </View>
            <ToggleSwitch
              isEnabled={isHospitalSyncEnabled}
              onToggle={(newState) => showConfirmModal('hospital-sync', newState)}
            />
          </View>

          {/* 社区内容分享 */}
          <View style={styles.settingItem}>
            <View style={styles.settingContent}>
              <Text style={styles.settingTitle}>社区内容分享</Text>
              <Text style={styles.settingDescription}>
                允许在社区中分享您的康复经验和训练视频
              </Text>
            </View>
            <ToggleSwitch
              isEnabled={isCommunityShareEnabled}
              onToggle={(newState) => showConfirmModal('community-share', newState)}
            />
          </View>
        </View>

        {/* 数据捐赠详情 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>数据捐赠详情</Text>
          
          <View style={styles.donationInfoCard}>
            <View style={styles.donationInfoHeader}>
              <Text style={styles.donationInfoTitle}>了解数据捐赠</Text>
              <TouchableOpacity onPress={handleDonationDetailsPress}>
                <View style={styles.detailsButton}>
                  <Text style={styles.detailsButtonText}>查看详情</Text>
                  <FontAwesome6 name="chevron-right" size={10} color="#969FFF" />
                </View>
              </TouchableOpacity>
            </View>
            
            <View style={styles.donationStatus}>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>捐赠状态</Text>
                <Text style={[styles.statusValue, { color: donationStatus.statusColor }]}>
                  {donationStatus.status}
                </Text>
              </View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>上次捐赠</Text>
                <Text style={styles.statusValue}>{donationStatus.lastDonation}</Text>
              </View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>已捐赠数据</Text>
                <Text style={styles.statusValue}>{donationStatus.donatedCount}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* 隐私保护说明 */}
        <View style={styles.section}>
          <View style={styles.privacyNoticeCard}>
            <View style={styles.privacyNoticeHeader}>
              <View style={styles.privacyIconContainer}>
                <FontAwesome6 name="shield-halved" size={14} color="#969FFF" />
              </View>
              <View style={styles.privacyNoticeContent}>
                <Text style={styles.privacyNoticeTitle}>隐私保护承诺</Text>
                <View style={styles.privacyNoticeList}>
                  <View style={styles.privacyNoticeItem}>
                    <Text style={styles.bulletPoint}>•</Text>
                    <Text style={styles.privacyNoticeText}>
                      采用医疗级数据加密技术，确保数据安全
                    </Text>
                  </View>
                  <View style={styles.privacyNoticeItem}>
                    <Text style={styles.bulletPoint}>•</Text>
                    <Text style={styles.privacyNoticeText}>
                      严格遵守HIPAA、GDPR等国际隐私标准
                    </Text>
                  </View>
                  <View style={styles.privacyNoticeItem}>
                    <Text style={styles.bulletPoint}>•</Text>
                    <Text style={styles.privacyNoticeText}>
                      区块链存证数据操作日志，确保可追溯
                    </Text>
                  </View>
                  <View style={styles.privacyNoticeItem}>
                    <Text style={styles.bulletPoint}>•</Text>
                    <Text style={styles.privacyNoticeText}>
                      支持"最小必要"授权原则，您可随时撤销
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* 确认弹窗 */}
      <ConfirmModal
        isVisible={isConfirmModalVisible}
        title={modalConfig.title}
        message={modalConfig.message}
        icon={modalConfig.icon}
        onCancel={hideConfirmModal}
        onConfirm={confirmToggle}
      />

      {/* 成功提示 */}
      <SuccessToast
        isVisible={isSuccessToastVisible}
        message="设置已更新"
      />
    </SafeAreaView>
  );
};

export default PrivacySettingsScreen;

