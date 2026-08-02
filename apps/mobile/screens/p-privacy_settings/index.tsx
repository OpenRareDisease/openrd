import { COLOR } from '../../lib/design';
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Icon from '../common/Icon';
import styles from './styles';

import { bumpConsentEpoch } from '../../lib/consent-epoch';
import ScreenHeader from '../common/ScreenHeader';
import { useAppDialog } from '../common/feedback/AppDialog';
import Button from '../common/Button';
import ToggleSwitch from '../common/ToggleSwitch';
import SuccessToast from './components/SuccessToast';
import {
  ApiError,
  type ConsentDetails,
  type ConsentUpdatePayload,
  type SharingPreferences,
  type SharingPreferencesUpdatePayload,
  getMyConsent,
  getMySharingPreferences,
  getSubmissionTimeline,
  updateMyConsent,
  updateMySharingPreferences,
} from '../../lib/api';

interface ToggleCopy {
  title: string;
  message: string;
}

type AiConsentField = 'personal' | 'thirdParty' | 'preciseValues';

const AI_TOGGLE_IDS: Record<AiConsentField, string> = {
  personal: 'ai-personal',
  thirdParty: 'ai-third-party',
  preciseValues: 'ai-precise-values',
};

const formatGrantDate = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Render the parenthetical date hint next to a consent toggle.
 *  When the flag is currently on we say "同意于 …"; when it's off
 *  but a timestamp exists (i.e. the user had granted then revoked)
 *  we say "上次更新 …" so the label isn't misleading. Returns the
 *  full parenthetical including the surrounding "（…）", or '' when
 *  there's no date to show. */
const formatConsentDateLabel = (iso: string | null, granted: boolean): string => {
  const date = formatGrantDate(iso);
  if (!date) return '';
  return granted ? `（同意于 ${date}）` : `（上次更新 ${date}）`;
};

const PrivacySettingsScreen = () => {
  const router = useRouter();
  const { confirm, notify } = useAppDialog();

  // AI 同意状态（来自后端）
  const [aiConsent, setAiConsent] = useState<ConsentDetails | null>(null);
  const [aiConsentLoading, setAiConsentLoading] = useState(true);
  const [aiConsentError, setAiConsentError] = useState<string | null>(null);
  const [aiConsentSaving, setAiConsentSaving] = useState(false);

  // 四个数据共享开关（同样来自后端，backed by migration 010）
  const [sharingPrefs, setSharingPrefs] = useState<SharingPreferences | null>(null);
  const [sharingLoading, setSharingLoading] = useState(true);
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [sharingSaving, setSharingSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMyConsent();
        if (!cancelled) {
          setAiConsent(data);
          setAiConsentError(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setAiConsentError('请先完成基础档案后再设置 AI 同意。');
        } else {
          setAiConsentError(err instanceof Error ? err.message : '加载 AI 同意状态失败');
        }
      } finally {
        if (!cancelled) setAiConsentLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Sharing preferences load — uses the same 404→prompt-for-onboarding
  // pattern as AI consent so the screen behaves consistently for
  // users without a profile row yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getMySharingPreferences();
        if (!cancelled) {
          setSharingPrefs(data);
          setSharingError(null);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setSharingError('请先完成基础档案后再设置数据共享。');
        } else {
          setSharingError(err instanceof Error ? err.message : '加载数据共享设置失败');
        }
      } finally {
        if (!cancelled) setSharingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 弹窗和提示状态
  const [isSuccessToastVisible, setIsSuccessToastVisible] = useState(false);
  // A confirmation is on screen. It disables every switch, so a second
  // press can't open a second dialog and orphan the first promise.
  const [isConfirming, setIsConfirming] = useState(false);

  const handleDonationDetailsPress = () => {
    router.push('/p-data_donation');
  };

  /** Resulting consent level if `toggleId` were flipped to
   *  `newState` — mirrors the backend rule (personal + thirdParty
   *  both on = basic; + preciseValues = precise; anything else =
   *  none/403), so the confirm dialog can state the outcome instead
   *  of making the user derive it. */
  const projectAiLevel = (toggleId: string, newState: boolean): string | null => {
    if (!aiConsent) return null;
    const next = { ...aiConsent.flags };
    if (toggleId === AI_TOGGLE_IDS.personal) next.personal = newState;
    else if (toggleId === AI_TOGGLE_IDS.thirdParty) next.thirdParty = newState;
    else if (toggleId === AI_TOGGLE_IDS.preciseValues) next.preciseValues = newState;
    else return null;

    if (!next.personal || !next.thirdParty) {
      return '操作后等级：未授权 —— 智能问答将无法使用。';
    }
    return next.preciseValues
      ? '操作后等级：精确 —— AI 可读取 D4Z4 等原始数值。'
      : '操作后等级：基础 —— AI 仅可引用脱敏后的档案字段。';
  };

  /** Copy for the confirmation of one toggle. Kept separate from the
   *  asking so the wording stays a pure function of (toggle, target
   *  state) and can be read in one place. */
  const describeToggle = (toggleId: string, newState: boolean): ToggleCopy => {
    let title = '';
    let message = '';

    switch (toggleId) {
      case 'trial-permission':
        title = newState ? '开启临床试验授权' : '关闭临床试验授权';
        message = newState
          ? '开启后，临床试验机构将能够访问您的档案数据以评估入组资格。您可以随时在此页面关闭此授权。'
          : '关闭后，临床试验机构将无法访问您的档案数据，可能影响您参与临床试验的机会。';
        break;
      case 'donation-permission':
        title = newState ? '开启数据捐赠' : '关闭数据捐赠';
        message = newState
          ? '开启后，您的匿名化数据将被捐赠给FSHD科研项目，助力医学研究。我们会严格保护您的隐私。'
          : '关闭后，您的数据将不再被捐赠给科研项目。之前捐赠的数据仍将用于科研。';
        break;
      case 'hospital-sync':
        title = newState ? '开启医院数据同步' : '关闭医院数据同步';
        message = newState
          ? '开启后，医院HIS系统将自动同步您的日常记录数据到个人档案，减少重复录入。'
          : '关闭后，医院数据将不会自动同步，您需要手动录入日常记录。';
        break;
      case 'community-share':
        title = newState ? '开启社区分享' : '关闭社区分享';
        message = newState
          ? '开启后，您可以在社区中分享康复经验和训练视频，帮助其他患者。'
          : '关闭后，您将无法在社区中发布内容，但仍可浏览他人分享。';
        break;
      case AI_TOGGLE_IDS.personal:
        title = newState ? '开启个人数据用于 AI' : '关闭个人数据用于 AI';
        message = newState
          ? '开启后，AI 助手在回答问题时可以引用你的档案和报告中已脱敏的字段。原始姓名、身份证、电话等绝不会出现在提示词里。'
          : '关闭后，AI 助手将无法引用你的任何个人数据；为了完全停用 AI 还需要同时关闭"第三方 LLM 处理"。';
        break;
      case AI_TOGGLE_IDS.thirdParty:
        title = newState ? '允许第三方 LLM 处理' : '关闭第三方 LLM 处理';
        // PIPL Art. 17(1)/23 wants the RECIPIENT named, not just the
        // fact that「云端大模型」is involved. The old copy said
        //「SiliconFlow / DeepSeek」as if they were two interchangeable
        // vendors; one is the processor we contract with, the other is
        // the model it runs — a user cannot check who holds their data
        // from that. Endpoint and data location are stated for the same
        // reason: whether the prompt crosses a border is the question
        // Art. 38-39 turns on, and the .cn host is the answer.
        message = newState
          ? '开启后，你的问题会经我们的服务器发送给受托处理方「硅基流动 SiliconFlow」（接入地址 api.siliconflow.cn，位于中国境内）做推理，运行的模型为 DeepSeek-V3。我们只发送脱敏后的提示词——姓名、手机号、身份证号在送出前会被移除——并保留每一次调用的审计记录。详见《隐私政策》第 5 条。'
          : '关闭后，AI 助手将无法回答你的问题。';
        break;
      case AI_TOGGLE_IDS.preciseValues:
        title = newState ? '开启精确数值授权' : '关闭精确数值授权';
        message = newState
          ? '开启后，AI 可以看到精确的 D4Z4 重复数、甲基化百分比、具体报告日期等原始数值。这些数据更有助于精准建议，但属于敏感信息。需要同时开启上面两项。'
          : '关闭后，AI 只会看到临床化的描述（如"D4Z4 短"），具体数值不会进入提示词。';
        break;
    }

    const projectedLevel = projectAiLevel(toggleId, newState);
    if (projectedLevel) {
      message = `${message}\n\n${projectedLevel}`;
    }

    return { title, message };
  };

  /**
   * Ask, then apply.
   *
   * This used to drive a screen-local `<ConfirmModal>` whose 确认
   * button looked the same whichever way the switch was moving. Every
   * one of these switches is a consent grant, so turning one *off* is
   * a revocation — `destructive` puts that button in the alert colour
   * and off the default position, which is the only visual difference
   * between "start sharing my genome with a cloud model" and "stop".
   */
  const requestToggle = async (toggleId: string, newState: boolean) => {
    if (isConfirming) return;
    const { title, message } = describeToggle(toggleId, newState);

    setIsConfirming(true);
    let confirmed = false;
    try {
      confirmed = await confirm({
        title,
        message,
        confirmLabel: newState ? '开启' : '关闭',
        cancelLabel: '取消',
        destructive: !newState,
      });
    } finally {
      setIsConfirming(false);
    }
    if (!confirmed) return;

    applyToggle(toggleId, newState);
  };

  const applyAiConsentUpdate = async (payload: ConsentUpdatePayload) => {
    setAiConsentSaving(true);
    try {
      const updated = await updateMyConsent(payload);
      setAiConsent(updated);
      // Any AI-consent change starts a new QnA history epoch: answers
      // generated under the OLD switches must not replay as context
      // for questions asked under the new ones (most importantly on
      // a precise→basic downgrade). See lib/consent-epoch.ts.
      await bumpConsentEpoch();
      showSuccessToast();
    } catch (err) {
      const message = err instanceof Error ? err.message : '同意状态更新失败，请稍后重试。';
      notify({ title: '更新失败', message, tone: 'error' });
    } finally {
      setAiConsentSaving(false);
    }
  };

  const applySharingUpdate = async (payload: SharingPreferencesUpdatePayload) => {
    setSharingSaving(true);
    try {
      const updated = await updateMySharingPreferences(payload);
      setSharingPrefs(updated);
      showSuccessToast();
    } catch (err) {
      const message = err instanceof Error ? err.message : '设置更新失败，请稍后重试。';
      notify({ title: '更新失败', message, tone: 'error' });
    } finally {
      setSharingSaving(false);
    }
  };

  const applyToggle = (id: string, newState: boolean) => {
    switch (id) {
      case 'trial-permission':
        void applySharingUpdate({ clinicalTrial: newState });
        break;
      case 'donation-permission':
        void applySharingUpdate({ dataDonation: newState });
        break;
      case 'hospital-sync':
        void applySharingUpdate({ hospitalSync: newState });
        break;
      case 'community-share':
        void applySharingUpdate({ communityShare: newState });
        break;
      case AI_TOGGLE_IDS.personal:
        void applyAiConsentUpdate({ personal: newState });
        break;
      case AI_TOGGLE_IDS.thirdParty:
        void applyAiConsentUpdate({ thirdParty: newState });
        break;
      case AI_TOGGLE_IDS.preciseValues:
        void applyAiConsentUpdate({ preciseValues: newState });
        break;
    }
  };

  const showSuccessToast = () => {
    setIsSuccessToastVisible(true);
    setTimeout(() => {
      setIsSuccessToastVisible(false);
    }, 3000);
  };

  // Real record count for the donation card. There is no donation
  // pipeline yet, so the honest number to show is "how many of my
  // records are in scope for sharing" — the submission total. An
  // earlier version hard-coded "12 条" here, which showed users a
  // donation history that never happened.
  const [shareableCount, setShareableCount] = useState<number | null>(null);
  const donationGranted = sharingPrefs?.flags.dataDonation ?? false;

  useEffect(() => {
    if (!donationGranted) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // page/pageSize 1: we only need the `total` counter.
        const timeline = await getSubmissionTimeline(1, 1);
        if (!cancelled) setShareableCount(timeline.total);
      } catch {
        // Leave as null → the card renders "—" instead of a made-up
        // number. The count is informational, never block the screen.
        if (!cancelled) setShareableCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [donationGranted]);

  const getDonationStatus = () => {
    // `sharingPrefs === null` is "not loaded yet / the request failed",
    // and `?? false` collapsed it into the same value as an explicit
    // denial — so the screen asserted 未授权 about a state it had not
    // read. On a consent screen that is the assertion that matters
    // most, and the patient's next move is to grant something they may
    // already have granted.
    if (!sharingPrefs) {
      return {
        status: '读取中',
        statusColor: COLOR.inkMuted,
        grantedAt: '--',
        shareableRecords: '--',
      };
    }
    if (!donationGranted) {
      return {
        status: '未授权',
        statusColor: COLOR.inkMuted,
        grantedAt: '--',
        shareableRecords: '--',
      };
    }

    return {
      status: '已授权',
      statusColor: COLOR.good,
      // Same YYYY-MM-DD formatter the AI-consent rows use, so the
      // screen doesn't mix date formats.
      grantedAt: formatGrantDate(sharingPrefs?.timestamps.dataDonationAt ?? null) ?? '—',
      shareableRecords: shareableCount === null ? '—' : `${shareableCount} 条`,
    };
  };

  const donationStatus = getDonationStatus();

  const renderAiConsentSection = () => {
    if (aiConsentLoading) {
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI 数据授权</Text>
          <Text
            style={{
              paddingHorizontal: 24,
              paddingVertical: 12,
              color: COLOR.inkMuted,
              fontSize: 13,
            }}
          >
            正在加载同意状态...
          </Text>
        </View>
      );
    }

    if (aiConsentError) {
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI 数据授权</Text>
          <Text
            style={{
              paddingHorizontal: 24,
              paddingVertical: 12,
              color: COLOR.inkMuted,
              fontSize: 13,
            }}
          >
            {aiConsentError}
          </Text>
        </View>
      );
    }

    if (!aiConsent) return null;

    const { flags, timestamps, level } = aiConsent;
    const personalLabel = formatConsentDateLabel(timestamps.personalAt, flags.personal);
    const thirdPartyLabel = formatConsentDateLabel(timestamps.thirdPartyAt, flags.thirdParty);
    const preciseLabel = formatConsentDateLabel(timestamps.preciseValuesAt, flags.preciseValues);
    const preciseAllowed = flags.personal && flags.thirdParty;
    const levelLabel =
      level === 'precise'
        ? '当前等级：精确（AI 可读原始数值）'
        : level === 'basic'
          ? '当前等级：基础（AI 可读临床化字段）'
          : '当前等级：未授权（AI 拒绝回答）';
    // The two-switch requirement was previously undocumented — users
    // enabled one switch, still got the consent wall in QnA, and had
    // no way to know why.
    const comboHint =
      '「个人数据」和「第三方 LLM」两项都开启后，智能问答才可用；精确数值是可选的第三档。';

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>AI 数据授权</Text>
        <Text
          style={{
            paddingHorizontal: 24,
            paddingTop: 4,
            color: COLOR.inkMuted,
            fontSize: 12,
          }}
        >
          {levelLabel}
        </Text>
        <Text
          style={{
            paddingHorizontal: 24,
            paddingTop: 6,
            paddingBottom: 12,
            color: COLOR.inkMuted,
            fontSize: 12,
            lineHeight: 18,
          }}
        >
          {comboHint}
        </Text>

        <View style={styles.settingItem}>
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>个人数据用于 AI</Text>
            <Text style={styles.settingDescription}>
              允许 AI 在回答问题时引用你档案/报告中已脱敏的字段
              {personalLabel}
            </Text>
          </View>
          <ToggleSwitch
            accessibilityLabel="个人数据用于 AI"
            isEnabled={flags.personal}
            disabled={aiConsentSaving || isConfirming}
            onToggle={(newState) => void requestToggle(AI_TOGGLE_IDS.personal, newState)}
          />
        </View>

        <View style={styles.settingItem}>
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>第三方 LLM 处理</Text>
            <Text style={styles.settingDescription}>
              问题发送给受托处理方「硅基流动 SiliconFlow」（api.siliconflow.cn，境内）推理，模型
              DeepSeek-V3
              {thirdPartyLabel}
            </Text>
          </View>
          <ToggleSwitch
            accessibilityLabel="第三方 LLM 处理"
            isEnabled={flags.thirdParty}
            disabled={aiConsentSaving || isConfirming}
            onToggle={(newState) => void requestToggle(AI_TOGGLE_IDS.thirdParty, newState)}
          />
        </View>

        <View style={styles.settingItem}>
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>精确数值授权</Text>
            <Text style={styles.settingDescription}>
              允许 AI 看到 D4Z4 重复数、甲基化百分比等原始数值
              {preciseLabel}
              {!preciseAllowed ? '\n需要先开启上面两项' : ''}
            </Text>
          </View>
          <ToggleSwitch
            accessibilityLabel="精确数值授权"
            isEnabled={flags.preciseValues}
            disabled={aiConsentSaving || isConfirming || !preciseAllowed}
            onToggle={(newState) => void requestToggle(AI_TOGGLE_IDS.preciseValues, newState)}
          />
        </View>

        {/* A row that navigates, so it says so. It was a bare Touchable
            with a chevron and no accessibilityRole — on the privacy
            screen of all places, the audit trail was unreachable by
            screen reader. */}
        <Pressable
          style={styles.settingItem}
          accessibilityRole="button"
          accessibilityLabel="查看 AI 调用记录"
          accessibilityHint="打开审计历史，查看每次问答的模型、工具与字段"
          // expo-router's typed-routes union is regenerated by
          // `expo start`; the new screen file is recognised at runtime
          // but tsc hasn't seen it yet. Cast for now.
          onPress={() => router.push('/p-audit_history' as never)}
        >
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>查看 AI 调用记录</Text>
            <Text style={styles.settingDescription}>
              每次问答的元数据（模型、工具、字段、状态），不含提示词原文
            </Text>
          </View>
          <Icon name="chevron-right" size={12} color={COLOR.inkMuted} />
        </Pressable>
      </View>
    );
  };

  /** Render the four data-sharing toggles. Pulled out as its own
   *  function to mirror `renderAiConsentSection` — loading and
   *  error states share the same shape. */
  const renderSharingSection = () => {
    if (sharingLoading) {
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>数据授权</Text>
          <Text
            style={{
              paddingHorizontal: 24,
              paddingVertical: 12,
              color: COLOR.inkMuted,
              fontSize: 13,
            }}
          >
            正在加载共享设置...
          </Text>
        </View>
      );
    }

    if (sharingError) {
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>数据授权</Text>
          <Text
            style={{
              paddingHorizontal: 24,
              paddingVertical: 12,
              color: COLOR.inkMuted,
              fontSize: 13,
            }}
          >
            {sharingError}
          </Text>
        </View>
      );
    }

    if (!sharingPrefs) return null;
    const { flags } = sharingPrefs;

    return (
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
            accessibilityLabel="临床试验数据授权"
            isEnabled={flags.clinicalTrial}
            disabled={sharingSaving || isConfirming}
            onToggle={(newState) => void requestToggle('trial-permission', newState)}
          />
        </View>

        {/* 匿名化数据捐赠 */}
        <View style={styles.settingItem}>
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>匿名化数据捐赠</Text>
            <Text style={styles.settingDescription}>将您的匿名化数据捐赠给FSHD科研项目</Text>
          </View>
          <ToggleSwitch
            accessibilityLabel="匿名化数据捐赠"
            isEnabled={flags.dataDonation}
            disabled={sharingSaving || isConfirming}
            onToggle={(newState) => void requestToggle('donation-permission', newState)}
          />
        </View>

        {/* 医院数据同步 */}
        <View style={styles.settingItem}>
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>医院数据同步</Text>
            <Text style={styles.settingDescription}>
              允许医院HIS系统同步您的日常记录数据到个人档案
            </Text>
          </View>
          <ToggleSwitch
            accessibilityLabel="医院数据同步"
            isEnabled={flags.hospitalSync}
            disabled={sharingSaving || isConfirming}
            onToggle={(newState) => void requestToggle('hospital-sync', newState)}
          />
        </View>

        {/* 社区内容分享 */}
        <View style={styles.settingItem}>
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>社区内容分享</Text>
            <Text style={styles.settingDescription}>允许在社区中分享您的康复经验和训练视频</Text>
          </View>
          <ToggleSwitch
            accessibilityLabel="社区内容分享"
            isEnabled={flags.communityShare}
            disabled={sharingSaving || isConfirming}
            onToggle={(newState) => void requestToggle('community-share', newState)}
          />
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 顶部导航栏 — ScreenHeader adds the 首页 control the hand-rolled
          row never had. Privacy is typically reached from 我的 → 隐私设置
          → 数据捐赠, so leaving it took two targeted presses. */}
      <ScreenHeader title="隐私设置" style={styles.header} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* AI 数据授权 */}
        {renderAiConsentSection()}

        {/* 数据授权设置 */}
        {renderSharingSection()}

        {/* 数据捐赠详情 */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>数据捐赠详情</Text>

          <View style={styles.donationInfoCard}>
            <View style={styles.donationInfoHeader}>
              <Text style={styles.donationInfoTitle}>了解数据捐赠</Text>
              {/* Beside a heading, so `plain` is legal here — position
                  establishes that it is interactive. It had no
                  accessibilityRole at all before. */}
              <Button
                label="查看详情"
                trailingIcon="chevron-right"
                variant="plain"
                compact
                accessibilityLabel="查看数据捐赠详情"
                onPress={handleDonationDetailsPress}
              />
            </View>

            <View style={styles.donationStatus}>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>捐赠状态</Text>
                <Text style={[styles.statusValue, { color: donationStatus.statusColor }]}>
                  {donationStatus.status}
                </Text>
              </View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>授权时间</Text>
                <Text style={styles.statusValue}>{donationStatus.grantedAt}</Text>
              </View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>可共享记录</Text>
                <Text style={styles.statusValue}>{donationStatus.shareableRecords}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* 隐私保护说明 */}
        <View style={styles.section}>
          <View style={styles.privacyNoticeCard}>
            <View style={styles.privacyNoticeHeader}>
              <View style={styles.privacyIconContainer}>
                <Icon name="shield-halved" size={14} color={COLOR.accent} />
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
                    <Text style={styles.privacyNoticeText}>严格遵守HIPAA、GDPR等国际隐私标准</Text>
                  </View>
                  <View style={styles.privacyNoticeItem}>
                    <Text style={styles.bulletPoint}>•</Text>
                    <Text style={styles.privacyNoticeText}>区块链存证数据操作日志，确保可追溯</Text>
                  </View>
                  <View style={styles.privacyNoticeItem}>
                    <Text style={styles.bulletPoint}>•</Text>
                    <Text style={styles.privacyNoticeText}>
                      支持“最小必要”授权原则，您可随时撤销
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* 确认弹窗 now comes from useAppDialog() — see requestToggle. */}

      {/* 成功提示 */}
      <SuccessToast isVisible={isSuccessToastVisible} message="设置已更新" />
    </SafeAreaView>
  );
};

export default PrivacySettingsScreen;
