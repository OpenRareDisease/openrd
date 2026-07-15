import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  Platform,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import styles from './styles';
import { useAuth } from '../../contexts/AuthContext';
import {
  exportMyData,
  requestAccountDeletion,
  cancelAccountDeletion,
  getAccountDeletionStatus,
  ApiError,
  type AccountDeletionStatus,
} from '../../lib/api';
import { CLINICAL_COLORS } from '../../lib/clinical-visuals';

const formatPurgeDate = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
};

/** Hand a JSON payload to the browser as a file download. Web-only —
 *  production is the Expo web export, where this is the natural
 *  "带走我的数据" gesture. */
const downloadJsonInBrowser = (payload: unknown, filename: string) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

const SettingsScreen = () => {
  const router = useRouter();
  const [isLogoutModalVisible, setIsLogoutModalVisible] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [deletion, setDeletion] = useState<AccountDeletionStatus | null>(null);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [deleteConfirmPhone, setDeleteConfirmPhone] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletionBusy, setIsDeletionBusy] = useState(false);
  const { user, logout } = useAuth();

  // The pending-deletion banner is the cooling-off period's cancel
  // surface — load it whenever the screen mounts. Fail-open: a
  // status fetch error just hides the banner (the request endpoints
  // still work).
  useEffect(() => {
    let cancelled = false;
    getAccountDeletionStatus()
      .then((result) => {
        if (!cancelled) setDeletion(result.deletion);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const handleRequestDeletion = async () => {
    if (isDeletionBusy) return;
    setIsDeletionBusy(true);
    setDeleteError(null);
    try {
      const status = await requestAccountDeletion(deleteConfirmPhone.trim());
      setDeletion(status);
      setIsDeleteModalVisible(false);
      setDeleteConfirmPhone('');
      Alert.alert(
        '注销申请已提交',
        `账号将于 ${formatPurgeDate(status.scheduledPurgeAt)} 删除。在此之前你可以随时在本页取消。`,
      );
    } catch (error) {
      setDeleteError(
        error instanceof ApiError && error.status === 409
          ? '已有进行中的注销申请。'
          : error instanceof Error
            ? error.message
            : '提交失败，请稍后重试。',
      );
    } finally {
      setIsDeletionBusy(false);
    }
  };

  const handleCancelDeletion = async () => {
    if (isDeletionBusy) return;
    setIsDeletionBusy(true);
    try {
      const status = await cancelAccountDeletion();
      setDeletion(status);
      Alert.alert('已取消', '注销申请已撤回，账号保持正常使用。');
    } catch (error) {
      Alert.alert('取消失败', error instanceof Error ? error.message : '请稍后重试。');
    } finally {
      setIsDeletionBusy(false);
    }
  };

  const handleExportDataPress = async () => {
    if (isExporting) return;
    if (Platform.OS !== 'web') {
      Alert.alert('提示', '数据导出目前请在网页版使用（浏览器会直接下载 JSON 文件）。');
      return;
    }
    setIsExporting(true);
    try {
      const data = await exportMyData();
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      downloadJsonInBrowser(data, `openrd-data-export-${stamp}.json`);
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 404
          ? '还没有建立健康档案，暂无可导出的数据。'
          : error instanceof Error
            ? error.message
            : '导出失败，请稍后重试。';
      Alert.alert('导出失败', message);
    } finally {
      setIsExporting(false);
    }
  };

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
    } catch {
      Alert.alert('错误', '退出登录失败，请重试');
    }
  };

  const handleEditProfilePress = () => {
    router.push('/p-register_profile');
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
          <View style={styles.headerRow}>
            <View style={styles.titleSection}>
              <Text style={styles.pageTitle}>设置</Text>
              <Text style={styles.pageSubtitle}>管理您的应用偏好和账户设置</Text>
            </View>
          </View>
        </View>

        {/* 用户信息卡片 */}
        <View style={styles.userInfoSection}>
          <View style={styles.userInfoCard}>
            <View style={styles.userProfileInfo}>
              <View style={styles.avatarFallback}>
                <FontAwesome6 name="user" size={26} color={CLINICAL_COLORS.accentStrong} />
              </View>
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
                <FontAwesome6 name="pen" size={14} color={CLINICAL_COLORS.accent} />
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
                    <FontAwesome6 name="shield-halved" size={18} color={CLINICAL_COLORS.accent} />
                  </View>
                  <View style={styles.settingTextContainer}>
                    <Text style={styles.settingTitle}>隐私设置</Text>
                    <Text style={styles.settingSubtitle}>管理数据授权和隐私偏好</Text>
                  </View>
                </View>
                <FontAwesome6 name="chevron-right" size={14} color={CLINICAL_COLORS.textMuted} />
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
                    <FontAwesome6 name="palette" size={18} color={CLINICAL_COLORS.success} />
                  </View>
                  <View style={styles.settingTextContainer}>
                    <Text style={styles.settingTitle}>个性化设置</Text>
                    <Text style={styles.settingSubtitle}>大字体、语音读屏、高对比度</Text>
                  </View>
                </View>
                <FontAwesome6 name="chevron-right" size={14} color={CLINICAL_COLORS.textMuted} />
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
                    <FontAwesome6
                      name="circle-info"
                      size={18}
                      color={CLINICAL_COLORS.accentStrong}
                    />
                  </View>
                  <View style={styles.settingTextContainer}>
                    <Text style={styles.settingTitle}>关于我们</Text>
                    <Text style={styles.settingSubtitle}>产品介绍、版本信息、联系方式</Text>
                  </View>
                </View>
                <FontAwesome6 name="chevron-right" size={14} color={CLINICAL_COLORS.textMuted} />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* 数据与账号 — data-sovereignty actions (export now; deletion
            joins in the account-deletion PR). Kept as its own section
            so「带走我的数据」is a first-class, findable right, not a
            buried menu item. */}
        <View style={styles.settingsListSection}>
          <View style={styles.settingsList}>
            <TouchableOpacity
              style={styles.settingItem}
              onPress={() => void handleExportDataPress()}
              activeOpacity={0.7}
              disabled={isExporting}
            >
              <View style={styles.settingItemContent}>
                <View style={styles.settingItemLeft}>
                  <View style={[styles.settingIconContainer, styles.blueIconContainer]}>
                    <FontAwesome6 name="download" size={18} color={CLINICAL_COLORS.accent} />
                  </View>
                  <View style={styles.settingTextContainer}>
                    <Text style={styles.settingTitle}>
                      {isExporting ? '正在整理导出…' : '导出我的数据'}
                    </Text>
                    <Text style={styles.settingSubtitle}>
                      下载全部档案、记录、报告清单与授权历史（JSON）
                    </Text>
                  </View>
                </View>
                <FontAwesome6 name="chevron-right" size={14} color={CLINICAL_COLORS.textMuted} />
              </View>
            </TouchableOpacity>

            {deletion?.status === 'pending' ? (
              <TouchableOpacity
                style={styles.settingItem}
                onPress={() => void handleCancelDeletion()}
                activeOpacity={0.7}
                disabled={isDeletionBusy}
              >
                <View style={styles.settingItemContent}>
                  <View style={styles.settingItemLeft}>
                    <View style={styles.settingIconContainer}>
                      <FontAwesome6 name="rotate-left" size={18} color={CLINICAL_COLORS.warning} />
                    </View>
                    <View style={styles.settingTextContainer}>
                      <Text style={[styles.settingTitle, { color: CLINICAL_COLORS.warning }]}>
                        取消注销申请
                      </Text>
                      <Text style={styles.settingSubtitle}>
                        账号将于 {formatPurgeDate(deletion.scheduledPurgeAt)}{' '}
                        删除，点此撤回并保留全部数据
                      </Text>
                    </View>
                  </View>
                  <FontAwesome6 name="chevron-right" size={14} color={CLINICAL_COLORS.textMuted} />
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.settingItem}
                onPress={() => {
                  setDeleteError(null);
                  setDeleteConfirmPhone('');
                  setIsDeleteModalVisible(true);
                }}
                activeOpacity={0.7}
              >
                <View style={styles.settingItemContent}>
                  <View style={styles.settingItemLeft}>
                    <View style={styles.settingIconContainer}>
                      <FontAwesome6 name="user-xmark" size={18} color={CLINICAL_COLORS.danger} />
                    </View>
                    <View style={styles.settingTextContainer}>
                      <Text style={[styles.settingTitle, { color: CLINICAL_COLORS.danger }]}>
                        注销账号
                      </Text>
                      <Text style={styles.settingSubtitle}>
                        7 天冷静期后删除全部数据，期间可随时反悔
                      </Text>
                    </View>
                  </View>
                  <FontAwesome6 name="chevron-right" size={14} color={CLINICAL_COLORS.textMuted} />
                </View>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* 探索 · 即将上线 — pre-launch features live here instead of
            occupying tab slots or floating as unreachable routes.
            Every entry opens its existing placeholder screen, so the
            promise is honest: visible, labeled, not yet functional. */}
        <View style={styles.settingsListSection}>
          <Text style={styles.exploreSectionTitle}>探索 · 即将上线</Text>
          <View style={styles.settingsList}>
            {(
              [
                { title: '患者社区', icon: 'users', route: '/p-community' },
                { title: '专家咨询', icon: 'user-doctor', route: '/p-expert_consult' },
                { title: '临床试验广场', icon: 'flask-vial', route: '/p-trial_square' },
                { title: '医疗资源地图', icon: 'map-location-dot', route: '/p-resource_map' },
                { title: '康复经验分享', icon: 'heart-pulse', route: '/p-rehab_share' },
              ] as const
            ).map((item) => (
              <TouchableOpacity
                key={item.route}
                style={styles.settingItem}
                onPress={() => router.push(item.route)}
                activeOpacity={0.7}
              >
                <View style={styles.settingItemContent}>
                  <View style={styles.settingItemLeft}>
                    <View style={styles.settingIconContainer}>
                      <FontAwesome6 name={item.icon} size={18} color={CLINICAL_COLORS.textMuted} />
                    </View>
                    <View style={styles.settingTextContainer}>
                      <Text style={styles.settingTitle}>{item.title}</Text>
                    </View>
                  </View>
                  <View style={styles.comingSoonBadge}>
                    <Text style={styles.comingSoonBadgeText}>即将上线</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* 退出登录 */}
        <View style={styles.settingsListSection}>
          <View style={styles.settingsList}>
            <TouchableOpacity
              style={styles.logoutItem}
              onPress={handleLogoutPress}
              activeOpacity={0.7}
            >
              <View style={styles.logoutItemContent}>
                <FontAwesome6 name="right-from-bracket" size={18} color={CLINICAL_COLORS.danger} />
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
                <FontAwesome6 name="right-from-bracket" size={24} color={CLINICAL_COLORS.danger} />
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

      {/* 注销确认：destructive path demands the registered phone
          number retyped — a button tap alone can't erase a medical
          record. */}
      <Modal
        visible={isDeleteModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsDeleteModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsDeleteModalVisible(false)}
        >
          <View style={styles.modalContainer}>
            <TouchableOpacity style={styles.modalContent} activeOpacity={1} onPress={() => {}}>
              <View style={styles.modalIconContainer}>
                <FontAwesome6 name="user-xmark" size={24} color={CLINICAL_COLORS.danger} />
              </View>
              <Text style={styles.modalTitle}>确认注销账号</Text>
              <Text style={styles.modalMessage}>
                注销后将进入 7 天冷静期，期间可随时取消；到期后账号与全部健康数据将被永久删除。
                建议先「导出我的数据」。{'\n\n'}请输入注册手机号确认：
              </Text>
              <TextInput
                style={styles.deleteConfirmInput}
                value={deleteConfirmPhone}
                onChangeText={(value) => {
                  setDeleteConfirmPhone(value);
                  setDeleteError(null);
                }}
                placeholder={user?.phoneNumber ?? '注册手机号'}
                placeholderTextColor={CLINICAL_COLORS.textMuted}
                keyboardType="phone-pad"
                autoFocus
              />
              {deleteError ? <Text style={styles.deleteErrorText}>{deleteError}</Text> : null}
              <View style={styles.modalButtonContainer}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setIsDeleteModalVisible(false)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.cancelButtonText}>再想想</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.confirmButton, isDeletionBusy && { opacity: 0.6 }]}
                  onPress={() => void handleRequestDeletion()}
                  activeOpacity={0.7}
                  disabled={isDeletionBusy}
                >
                  <Text style={styles.confirmButtonText}>
                    {isDeletionBusy ? '提交中…' : '申请注销'}
                  </Text>
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
