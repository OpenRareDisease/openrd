import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Modal, Platform, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Button from '../common/Button';
import Icon from '../common/Icon';
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
import { COLOR } from '../../lib/design';
import { isFeatureEnabled } from '../../lib/feature-flags';
import { useAppDialog } from '../common/feedback/AppDialog';
import ListGroup, { Row } from '../common/ListGroup';

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
  const { confirm, notify } = useAppDialog();
  const [isExporting, setIsExporting] = useState(false);
  const [deletion, setDeletion] = useState<AccountDeletionStatus | null>(null);
  /** The status fetch failed, so we do not know whether a purge is
   *  scheduled. Distinct from `deletion === null`, which means we
   *  asked and there is none. */
  const [deletionStatusUnknown, setDeletionStatusUnknown] = useState(false);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [deleteConfirmPhone, setDeleteConfirmPhone] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletionBusy, setIsDeletionBusy] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const { user, logout } = useAuth();

  // The pending-deletion banner is the cooling-off period's cancel
  // surface — load it whenever the screen mounts. A failed fetch is
  // reported rather than swallowed; see the catch below.
  useEffect(() => {
    let cancelled = false;
    getAccountDeletionStatus()
      .then((result) => {
        if (!cancelled) {
          setDeletion(result.deletion);
          setDeletionStatusUnknown(false);
        }
      })
      // A failed fetch is not "no deletion pending". Swallowing it left
      // `deletion` null, which renders the 注销账号 row — telling a user
      // whose account IS scheduled for purge that it isn't, and hiding
      // the cancel row that is their only way to stop it during the
      // cooling-off period.
      .catch(() => {
        if (!cancelled) setDeletionStatusUnknown(true);
      });
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
      notify({
        title: '注销申请已提交',
        message: `账号将于 ${formatPurgeDate(status.scheduledPurgeAt)} 删除。在此之前你可以随时在本页取消。`,
        tone: 'info',
      });
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
    // Busy flag is raised *before* the dialog, not after it: it also
    // disables the row, which is what stops a second tap from opening
    // a second confirm and orphaning the first promise.
    setIsDeletionBusy(true);
    try {
      // Withdrawing a deletion request is the safe direction, so no
      // destructive styling — but it still needs a confirmation,
      // because a mis-tap here silently discards a decision the user
      // made on purpose.
      const confirmed = await confirm({
        title: '撤回注销申请',
        message: '撤回后账号恢复正常使用，全部数据保留。你之后仍可以重新申请注销。',
        confirmLabel: '撤回申请',
        cancelLabel: '保持注销',
      });
      if (!confirmed) return;

      const status = await cancelAccountDeletion();
      setDeletion(status);
      notify({ title: '已撤回', message: '注销申请已撤回，账号保持正常使用。', tone: 'success' });
    } catch (error) {
      notify({
        title: '撤回失败',
        message: error instanceof Error ? error.message : '请稍后重试。',
        tone: 'error',
      });
    } finally {
      setIsDeletionBusy(false);
    }
  };

  const handleExportDataPress = async () => {
    if (isExporting) return;
    if (Platform.OS !== 'web') {
      notify({
        title: '暂不支持',
        message: '数据导出目前请在网页版使用（浏览器会直接下载 JSON 文件）。',
        tone: 'info',
      });
      return;
    }
    setIsExporting(true);
    try {
      const data = await exportMyData();
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `openrd-data-export-${stamp}.json`;
      downloadJsonInBrowser(data, filename);
      // The browser's own download indicator is easy to miss (and on
      // some mobile browsers it is a one-frame toast), so the app says
      // so itself — otherwise "导出我的数据" looks like it did nothing.
      notify({
        title: '导出完成',
        message: `已下载 ${filename}。文件包含你的全部档案、记录与授权历史，请妥善保管。`,
        tone: 'success',
      });
    } catch (error) {
      const message =
        error instanceof ApiError && error.status === 404
          ? '还没有建立健康档案，暂无可导出的数据。'
          : error instanceof Error
            ? error.message
            : '导出失败，请稍后重试。';
      notify({ title: '导出失败', message, tone: 'error' });
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrivacySettingsPress = () => {
    router.push('/p-privacy_settings');
  };

  const handlePersonalizationSettingsPress = () => {
    notify({ title: '即将上线', message: '个性化设置功能正在开发中，敬请期待。', tone: 'info' });
  };

  const handleAboutUsPress = () => {
    router.push('/p-about_us');
  };

  const handleLogoutPress = async () => {
    // Guards the whole ask-then-act sequence: without it a second press
    // while the dialog is up opens a second dialog and leaves the first
    // promise unresolved forever.
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      const confirmed = await confirm({
        title: '确认退出登录',
        message: '退出后需要重新登录才能查看你的档案和记录，本机上的问答缓存与草稿会一并清除。',
        confirmLabel: '退出登录',
        destructive: true,
      });
      if (!confirmed) return;

      await logout();
      router.replace('/p-login_register');
    } catch (error) {
      // logout() keeps the session alive when local cleanup failed, so
      // we stay on this screen — which is the only place the user can
      // still see why and press again. Navigating first would drop
      // them on the login screen with a credential still on the disk
      // and no explanation.
      notify({
        title: '退出登录失败',
        message: error instanceof Error ? error.message : '请稍后重试。',
        tone: 'error',
      });
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleEditProfilePress = () => {
    router.push('/p-register_profile');
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
          <Text style={styles.pageTitle}>我的</Text>
          <Text style={styles.pageSubtitle}>你的档案、授权，以及可以带走的数据</Text>
        </View>

        {/* 身份 — the one filled surface on this screen. The avatar
            circle is gone: a generic person glyph in a tinted disc told
            the patient nothing they didn't already know, and it cost
            the row 76pt of width that now goes to the number itself. */}
        <View style={styles.identity}>
          <View style={styles.identityRow}>
            <View style={styles.identityText}>
              <Text style={styles.identityValue}>{user?.phoneNumber ?? '未登录'}</Text>
              <Text style={styles.identityMeta}>
                角色：{user?.role ?? '未知'} · 注册于{' '}
                {user ? new Date(user.createdAt).toLocaleDateString() : '—'}
              </Text>
            </View>
            <Button
              label="编辑资料"
              variant="tinted"
              compact
              accessibilityLabel="编辑个人资料"
              onPress={handleEditProfilePress}
            />
          </View>
        </View>

        {/* Every destination on this screen is now a ListGroup Row, so
            the chevron means one thing everywhere: this navigates.
            Before, each section hand-rolled its own TouchableOpacity
            and the affordance drifted — some rows carried a chevron,
            some carried a badge, one carried nothing at all. */}
        <ListGroup title="档案与问答">
          {/* 智能问答 is a tab now, so a second door here would be two
              entrances to one room. The archive has no tab, so it
              keeps its. */}
          <Row
            icon="address-card"
            label="完整档案"
            detail="基本信息、FSHD 背景与记录摘要"
            onPress={() => router.push('/p-archive')}
          />
        </ListGroup>

        {/* Its own group, above 探索 · 即将上线 and visually unlike it.
            Every page in here is finished and every claim on it carries
            its source; putting them next to the placeholders would teach
            patients to read a chevron here as 「大概又是个空页面」, which
            is what those rows have already trained them to expect.

            The group is 了解 FSHD · 在中国 rather than 了解 FSHD because
            half of it is not about the disease at all — it is about the
            administrative half of having it here, which nobody else has
            an incentive to explain. 残疾评定准备 and 罕见病身份与权益 are
            not medical reading; they are the two conversations a patient
            has to have with an office. */}
        <ListGroup title="了解 FSHD · 在中国">
          <Row
            icon="dna"
            label="遗传与生育"
            detail="遗传概率、三代试管的限制、怀孕会发生什么"
            onPress={() => router.push('/p-genetics_family')}
          />
          <Row
            icon="clipboard-list"
            label="残疾评定准备"
            detail="国家标准原文、被埋在最后的功能障碍条款、八项自述与材料清单"
            onPress={() => router.push('/p-disability_assessment')}
          />
          <Row
            icon="id-card"
            label="罕见病身份与权益"
            detail="目录第 25 项、协作网欠你什么、以及它现在给不了什么"
            onPress={() => router.push('/p-rare_disease_status')}
          />
        </ListGroup>

        <ListGroup title="应用设置">
          <Row
            icon="shield-halved"
            label="隐私设置"
            detail="管理数据授权和隐私偏好"
            onPress={handlePrivacySettingsPress}
          />
          {/* 个性化设置 — hidden until it works. See
              FEATURE_FLAGS.personalization for why this one is not
              allowed to sit here as a placeholder. */}
          {isFeatureEnabled('personalization') ? (
            <Row
              icon="palette"
              label="个性化设置"
              detail="大字体、语音读屏、高对比度"
              onPress={handlePersonalizationSettingsPress}
            />
          ) : null}
          <Row
            icon="circle-info"
            label="关于我们"
            detail="产品介绍、版本信息、联系方式"
            onPress={handleAboutUsPress}
          />
        </ListGroup>

        {/* 数据与账号 — data-sovereignty actions. Kept as its own
            section so「带走我的数据」is a first-class, findable right,
            not a buried menu item. */}
        <ListGroup title="数据与账号">
          <Row
            icon="download"
            label={isExporting ? '正在整理导出…' : '导出我的数据'}
            detail="下载全部档案、记录、报告清单与授权历史（JSON）"
            onPress={() => void handleExportDataPress()}
            disabled={isExporting}
          />
          {deletionStatusUnknown ? (
            <Row
              icon="triangle-exclamation"
              label="注销状态暂时读不到"
              detail="无法确认是否有进行中的注销申请，请检查网络后重开本页"
              onPress={() => {
                setDeletionStatusUnknown(false);
                getAccountDeletionStatus()
                  .then((result) => setDeletion(result.deletion))
                  .catch(() => setDeletionStatusUnknown(true));
              }}
            />
          ) : deletion?.status === 'pending' ? (
            <Row
              icon="rotate-left"
              label="取消注销申请"
              detail={`账号将于 ${formatPurgeDate(deletion.scheduledPurgeAt)} 删除，点此撤回并保留全部数据`}
              onPress={() => void handleCancelDeletion()}
              disabled={isDeletionBusy}
            />
          ) : (
            <Row
              icon="user-xmark"
              label="注销账号"
              detail="7 天冷静期后删除全部数据，期间可随时反悔"
              destructive
              onPress={() => {
                setDeleteError(null);
                setDeleteConfirmPhone('');
                setIsDeleteModalVisible(true);
              }}
            />
          )}
        </ListGroup>

        {/* 探索 · 即将上线 — five placeholder destinations that shipped
            nothing yet. Listing them next to privacy, audit history and
            account deletion made the whole page read as equally real,
            so they now sit behind EXPO_PUBLIC_ENABLE_EXPLORE: the
            screens and routes stay, only the discoverability is gated.
            Flip the flag per-build as each one actually launches. */}
        {isFeatureEnabled('explore') ? (
          <ListGroup title="探索 · 即将上线">
            {(
              [
                { title: '患者社区', icon: 'users', route: '/p-community' },
                { title: '专家咨询', icon: 'user-doctor', route: '/p-expert_consult' },
                { title: '临床试验广场', icon: 'flask-vial', route: '/p-trial_square' },
                { title: '医疗资源地图', icon: 'map-location-dot', route: '/p-resource_map' },
                { title: '康复经验分享', icon: 'heart-pulse', route: '/p-rehab_share' },
              ] as const
            ).map((item) => (
              <Row
                key={item.route}
                icon={item.icon}
                label={item.title}
                onPress={() => router.push(item.route)}
                // A badge instead of a chevron: these rows do open, but
                // what they open is a placeholder, and a chevron here
                // would promise the same thing 隐私设置 promises.
                accessory={
                  <View style={styles.comingSoonBadge}>
                    <Text style={styles.comingSoonBadgeText}>即将上线</Text>
                  </View>
                }
              />
            ))}
          </ListGroup>
        ) : null}

        {/* 退出登录 — an outlined button rather than another list row:
            it is an action, not a destination, and it should not be
            one tap away from the rows above it. */}
        <Button
          label="退出登录"
          icon="right-from-bracket"
          variant="destructive"
          fullWidth
          disabled={isLoggingOut}
          onPress={() => void handleLogoutPress()}
        />

        {/* 版本信息 */}
        <View style={styles.versionInfo}>
          <Text style={styles.versionText}>FSHD-openrd v1.0.0</Text>
          <Text style={styles.copyrightText}>© 2024 FSHD-openrd. 保留所有权利</Text>
        </View>
      </ScrollView>

      {/* 退出登录 uses the shared `confirm()` dialog — this screen used
          to hand-roll its own Modal for it, which meant two dialog
          implementations on one screen and no destructive treatment on
          the affirmative button. 注销 below keeps a bespoke Modal only
          because it needs a text field, which `confirm()` has no room
          for.

          注销确认：destructive path demands the registered phone
          number retyped — a button tap alone can't erase a medical
          record. */}
      <Modal
        visible={isDeleteModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setIsDeleteModalVisible(false)}
      >
        {/* `accessible={false}` on both wrappers is load-bearing.
            TouchableOpacity and Pressable default it to true, and an
            accessible view swallows its subtree into a single element
            on iOS — so this dialog announced itself as one node whose
            synthesised label ran the title, the warning and both button
            captions together, with the phone-number field below not
            reachable at all. A screen-reader user could not complete
            the confirmation, and a VoiceOver double-tap hit the scrim's
            dismiss rather than anything inside. On the app's one
            irreversible flow. */}
        <Pressable
          style={styles.modalOverlay}
          accessible={false}
          onPress={() => setIsDeleteModalVisible(false)}
        >
          <View style={styles.modalContainer}>
            <Pressable accessible={false} onPress={() => {}}>
              <View style={styles.modalContent} accessibilityViewIsModal>
                <View style={styles.modalHead}>
                  <Icon name="user-xmark" size={16} color={COLOR.alert} />
                  <Text style={styles.modalTitle}>确认注销账号</Text>
                </View>
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
                  placeholderTextColor={COLOR.inkFaint}
                  keyboardType="phone-pad"
                  accessibilityLabel="注册手机号"
                  accessibilityHint="输入注册手机号以确认注销"
                  autoFocus
                />
                {deleteError ? <Text style={styles.deleteErrorText}>{deleteError}</Text> : null}
                <View style={styles.modalButtonContainer}>
                  <Button
                    label="再想想"
                    variant="tinted"
                    onPress={() => setIsDeleteModalVisible(false)}
                  />
                  <Button
                    label="申请注销"
                    variant="destructive"
                    busy={isDeletionBusy}
                    accessibilityHint="提交注销申请，进入 7 天冷静期"
                    onPress={() => void handleRequestDeletion()}
                  />
                </View>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

export default SettingsScreen;
