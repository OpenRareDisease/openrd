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
import { APP_NAME, readAppVersion } from '../../lib/app-identity';
import { COLOR } from '../../lib/design';
import { isAdminRole } from '../../lib/admin-access';
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
  const appVersion = readAppVersion();
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
          {/* Built in an earlier batch with no way in at all. It reads
              the patient's own record against the AAN/AANEM table, so
              it belongs with the pages that answer 「这个病要注意什么」
              rather than buried in the passport. */}
          <Row
            icon="calendar"
            label="我的随访计划"
            detail="按指南，结合你已录入的信息，哪些检查值得和医生确认"
            onPress={() => router.push('/p-surveillance')}
          />
          {/* 临床试验 sits in this group and not in 探索 · 即将上线,
              which is where a page about trials would be expected to
              go. The distinction that group encodes is whether the page
              is finished and sourced: 临床试验广场 in there is still an
              UnavailableScreen, while this one shows what
              ClinicalTrials.gov actually says with the date we copied
              it on every screenful. Putting it behind the 即将上线
              badge would cost it its readership, which is the failure
              this group's header comment already describes.

              The「· 在中国」half of the group title earns it too: the
              one thing this page has to tell a mainland reader is that
              the list does NOT cover trials registered only with
              药物临床试验登记与信息公示平台, and where to go instead. */}
          <Row
            icon="flask-vial"
            label="临床试验"
            detail="注册库上登记的 FSHD 试验，以及这份名单是哪天抄下来的"
            onPress={() => router.push('/p-trials')}
          />
          {/* 病友经验 and 康复：辅具与运动 sit in this group for the
              same reason 临床试验 does: each is a finished page, and an
              即将上线 badge on a finished page costs it the readership
              this group exists to protect. 病友经验 is the shelf of
              published, bylined narratives in screens/p-community;
              康复：辅具与运动 is the orthosis and walking-aid ladder plus
              the six-month home-exercise plan in screens/p-rehab_share.

              A row here is what makes either page findable. 探索 ·
              即将上线 below sits behind EXPO_PUBLIC_ENABLE_EXPLORE —
              one flag over that whole group, off by default — so a
              finished page listed there instead gets no row in a
              default build. The routes are not gated, so a deep link
              into a web export still resolves; what the flag withholds
              is the way to find the page. See the comment on that
              group below, and
              __tests__/finished-explore-entries.test.tsx. */}
          <Row
            icon="users"
            label="病友经验"
            detail="病友自己写下、已公开发表的经历；本页只放摘录和出处"
            onPress={() => router.push('/p-community')}
          />
          <Row
            icon="heart-pulse"
            label="康复：辅具与运动"
            detail="辅具与助行器怎么选，以及六个月的居家运动计划"
            onPress={() => router.push('/p-rehab_share')}
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
          {/* The referral pack shipped with a route, a client and a
              screen, and no way in — 730 lines a patient could not
              reach. It sits with 罕见病身份与权益 because that page is
              where someone learns the 协作网 exists at all, and this is
              what they hand over when they get there. */}
          <Row
            icon="user-doctor"
            label="协作网转诊包"
            detail="把你的记录整理成神经科医生要看的那份，带去协作网医院"
            onPress={() => router.push('/p-referral')}
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

        {/* 探索 · 即将上线 — the rows listed below, and only those. Each
            one still opens an UnavailableScreen. Listing them next to
            privacy, audit history and account deletion made the whole
            page read as equally real, so they sit behind
            EXPO_PUBLIC_ENABLE_EXPLORE: the screens and routes stay,
            only the discoverability is gated.

            One flag covers the whole group, so it cannot be flipped
            per destination as that destination launches — flipping it
            for the one that is ready surfaces the ones that are not.
            A page that becomes real leaves this list AND gets a row of
            its own above: doing only the first leaves it with no entry
            at all, and doing only the second leaves a duplicate row
            that comes back whenever the flag is on. See
            __tests__/trials-entry.test.tsx and
            __tests__/finished-explore-entries.test.tsx, which pin both
            ways of getting this wrong. */}
        {isFeatureEnabled('explore') ? (
          <ListGroup title="探索 · 即将上线">
            {(
              [
                { title: '专家咨询', icon: 'user-doctor', route: '/p-expert_consult' },
                { title: '临床试验广场', icon: 'flask-vial', route: '/p-trial_square' },
                { title: '医疗资源地图', icon: 'map-location-dot', route: '/p-resource_map' },
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

        {/* 后台 — the ONLY door into the back office, and it does not
            exist for a patient.

            Not `disabled`, not a 「无权限」 notice: §B4 asks for an entry
            point that is invisible to a patient, so a non-admin renders
            nothing at all here and the routes themselves are replaced
            with /p-home by the gate in app/_layout.tsx. This is a
            drawing decision made from the role cached at sign-in —
            lib/admin-access.ts says why that is allowed to be stale,
            and why it is not the access control. */}
        {isAdminRole(user?.role) ? (
          <ListGroup title="后台" footnote="这里看到的每一页都会记进审计，包括只是打开看看。">
            <Row
              icon="file-shield"
              label="运维与患者档案"
              detail="健康检查、解析失败队列、语料状态、AI 调用量，以及患者列表"
              onPress={() => router.push('/p-admin')}
            />
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
        {/* Three separate untruths lived in these two lines. The name
            was the repository's, not the product's — a patient reading
            this back to us would name a GitHub org. The version was
            typed as 1.0.0 against app.json's 2.5.0, one and a half
            years of releases apart, which points a bug report at the
            wrong build. And the year was 2024 on a screen rendered in
            2026. All three are now derived: none can go stale without
            the thing they describe changing too.

            The version renders only when the Expo config can be read.
            A version we cannot read is not one to guess at here — 关于
            我们 made the same call for the same reason. */}
        <View style={styles.versionInfo}>
          <Text style={styles.versionText}>
            {APP_NAME}
            {appVersion ? ` v${appVersion}` : ''}
          </Text>
          <Text style={styles.copyrightText}>
            © {new Date().getFullYear()} {APP_NAME}. 保留所有权利
          </Text>
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
