import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image, Modal, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import styles from './styles';
import { useAuth } from '../../contexts/AuthContext';

const SettingsScreen = () => {
  const router = useRouter();
  const [isLogoutModalVisible, setIsLogoutModalVisible] = useState(false);
  const { user, logout } = useAuth();

  const handlePrivacySettingsPress = () => {
    router.push('/p-privacy_settings');
  };

  const handlePersonalizationSettingsPress = () => {
    Alert.alert('提示', '个性化设置功能即将上线，敬请期待！');
  };

  const handleAboutUsPress = () => {
    router.push('/p-about_us');
  };

  const handleLogoutPress = () => {
    setIsLogoutModalVisible(true);
  };

  const handleCancelLogout = () => {
    setIsLogoutModalVisible(false);
  };

  const handleConfirmLogout = async () => {
    try {
      await logout();
      setIsLogoutModalVisible(false);
      router.replace('/p-login_register');
    } catch (error) {
      console.error('退出登录失败:', error);
      Alert.alert('错误', '退出登录失败，请重试');
    }
  };

  const handleEditProfilePress = () => {
    Alert.alert('提示', '个人资料编辑功能即将上线，敬请期待！');
  };

  const handleModalOverlayPress = () => {
    setIsLogoutModalVisible(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* 顶部标题区域 */}
        <View style={styles.header}>
          <View style={styles.titleSection}>
            <Text style={styles.pageTitle}>设置</Text>
            <Text style={styles.pageSubtitle}>管理您的应用偏好和账户设置</Text>
          </View>
        </View>

        {/* 用户信息卡片 */}
        <View style={styles.userInfoSection}>
          <View style={styles.userInfoCard}>
            <View style={styles.userProfileInfo}>
              <Image
                source={{ uri: 'https://s.coze.cn/image/Pqg4BKyFb3M/' }}
                style={styles.userAvatar}
              />
              <View style={styles.userDetails}>
                <Text style={styles.userName}>{user?.phoneNumber ?? '未登录'}</Text>
                <Text style={styles.userId}>角色：{user?.role ?? '未知'}</Text>
                <Text style={styles.userJoinDate}>
                  注册时间：{user ? new Date(user.createdAt).toLocaleDateString() : '—'}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.editProfileButton}
                onPress={handleEditProfilePress}
                activeOpacity={0.7}
              >
                <FontAwesome6 name="pen" size={14} color="#969FFF" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* 设置选项列表 */}
        <View style={styles.settingsListSection}>
          <View style={styles.settingsList}>
            {/* 隐私设置 */}
            <TouchableOpacity
              style={styles.settingItem}
              onPress={handlePrivacySettingsPress}
              activeOpacity={0.7}
            >
              <View style={styles.settingItemContent}>
                <View style={styles.settingItemLeft}>
                  <View style={[styles.settingIconContainer, styles.blueIconContainer]}>
                    <FontAwesome6 name="shield-halved" size={18} color="#60A5FA" />
                  </View>
                  <View style={styles.settingTextContainer}>
                    <Text style={styles.settingTitle}>隐私设置</Text>
                    <Text style={styles.settingSubtitle}>管理数据授权和隐私偏好</Text>
                  </View>
                </View>
                <FontAwesome6 name="chevron-right" size={14} color="rgba(255, 255, 255, 0.5)" />
              </View>
            </TouchableOpacity>

            {/* 个性化设置 */}
            <TouchableOpacity
              style={styles.settingItem}
              onPress={handlePersonalizationSettingsPress}
              activeOpacity={0.7}
            >
              <View style={styles.settingItemContent}>
                <View style={styles.settingItemLeft}>
                  <View style={[styles.settingIconContainer, styles.greenIconContainer]}>
                    <FontAwesome6 name="palette" size={18} color="#4ADE80" />
                  </View>
                  <View style={styles.settingTextContainer}>
                    <Text style={styles.settingTitle}>个性化设置</Text>
                    <Text style={styles.settingSubtitle}>大字体、语音读屏、高对比度</Text>
                  </View>
                </View>
                <FontAwesome6 name="chevron-right" size={14} color="rgba(255, 255, 255, 0.5)" />
              </View>
            </TouchableOpacity>

            {/* 关于我们 */}
            <TouchableOpacity
              style={styles.settingItem}
              onPress={handleAboutUsPress}
              activeOpacity={0.7}
            >
              <View style={styles.settingItemContent}>
                <View style={styles.settingItemLeft}>
                  <View style={[styles.settingIconContainer, styles.purpleIconContainer]}>
                    <FontAwesome6 name="circle-info" size={18} color="#A78BFA" />
                  </View>
                  <View style={styles.settingTextContainer}>
                    <Text style={styles.settingTitle}>关于我们</Text>
                    <Text style={styles.settingSubtitle}>产品介绍、版本信息、联系方式</Text>
                  </View>
                </View>
                <FontAwesome6 name="chevron-right" size={14} color="rgba(255, 255, 255, 0.5)" />
              </View>
            </TouchableOpacity>

            {/* 退出登录 */}
            <TouchableOpacity
              style={styles.logoutItem}
              onPress={handleLogoutPress}
              activeOpacity={0.7}
            >
              <View style={styles.logoutItemContent}>
                <FontAwesome6 name="right-from-bracket" size={18} color="#EF4444" />
                <Text style={styles.logoutText}>退出登录</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* 版本信息 */}
        <View style={styles.versionInfoSection}>
          <View style={styles.versionInfo}>
            <Text style={styles.versionText}>FSHD-openrd v1.0.0</Text>
            <Text style={styles.copyrightText}>© 2024 FSHD-openrd. 保留所有权利</Text>
          </View>
        </View>
      </ScrollView>

      {/* 退出登录确认弹窗 */}
      <Modal
        visible={isLogoutModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={handleCancelLogout}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={handleModalOverlayPress}
        >
          <View style={styles.modalContainer}>
            <TouchableOpacity
              style={styles.modalContent}
              activeOpacity={1}
              onPress={() => {}} // 阻止事件冒泡
            >
              <View style={styles.modalIconContainer}>
                <FontAwesome6 name="right-from-bracket" size={24} color="#EF4444" />
              </View>
              <Text style={styles.modalTitle}>确认退出登录</Text>
              <Text style={styles.modalMessage}>您确定要退出当前账户吗？</Text>
              <View style={styles.modalButtonContainer}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={handleCancelLogout}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelButtonText}>取消</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.confirmButton}
                  onPress={handleConfirmLogout}
                  activeOpacity={0.7}
                >
                  <Text style={styles.confirmButtonText}>退出登录</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
};

export default SettingsScreen;
