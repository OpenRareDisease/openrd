import { useEffect, useState } from 'react';
import { Alert, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import styles from './styles';
import { CLINICAL_COLORS } from '../../lib/clinical-visuals';
import ScreenBackButton from '../common/ScreenBackButton';
import ToggleSwitch from './components/ToggleSwitch';
import ConfirmModal from './components/ConfirmModal';
import SuccessToast from './components/SuccessToast';
import {
  ApiError,
  type ConsentDetails,
  type ConsentUpdatePayload,
  getMyConsent,
  updateMyConsent,
} from '../../lib/api';

interface ToggleInfo {
  id: string;
  newState: boolean;
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

  // 开关状态管理（旧的本地 mock toggles，待后端接入）
  const [isTrialPermissionEnabled, setIsTrialPermissionEnabled] = useState(true);
  const [isDonationPermissionEnabled, setIsDonationPermissionEnabled] = useState(false);
  const [isHospitalSyncEnabled, setIsHospitalSyncEnabled] = useState(true);
  const [isCommunityShareEnabled, setIsCommunityShareEnabled] = useState(true);

  // AI 同意状态（来自后端）
  const [aiConsent, setAiConsent] = useState<ConsentDetails | null>(null);
  const [aiConsentLoading, setAiConsentLoading] = useState(true);
  const [aiConsentError, setAiConsentError] = useState<string | null>(null);
  const [aiConsentSaving, setAiConsentSaving] = useState(false);

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

  // 弹窗和提示状态
  const [isConfirmModalVisible, setIsConfirmModalVisible] = useState(false);
  const [isSuccessToastVisible, setIsSuccessToastVisible] = useState(false);
  const [currentToggleInfo, setCurrentToggleInfo] = useState<ToggleInfo | null>(null);
  const [modalConfig, setModalConfig] = useState({
    title: '',
    message: '',
    icon: '',
  });

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
      case AI_TOGGLE_IDS.personal:
        title = newState ? '开启个人数据用于 AI' : '关闭个人数据用于 AI';
        message = newState
          ? '开启后，AI 助手在回答问题时可以引用你的档案和报告中已脱敏的字段。原始姓名、身份证、电话等绝不会出现在提示词里。'
          : '关闭后，AI 助手将无法引用你的任何个人数据；为了完全停用 AI 还需要同时关闭"第三方 LLM 处理"。';
        icon = newState ? 'user-shield' : 'circle-xmark';
        break;
      case AI_TOGGLE_IDS.thirdParty:
        title = newState ? '允许第三方 LLM 处理' : '关闭第三方 LLM 处理';
        message = newState
          ? '开启后，你的问题会被发送到云端大模型（SiliconFlow / DeepSeek）做推理。我们只发送脱敏后的提示词，并保留每一次调用的审计记录。'
          : '关闭后，AI 助手将无法回答你的问题。';
        icon = newState ? 'cloud-arrow-up' : 'cloud-slash';
        break;
      case AI_TOGGLE_IDS.preciseValues:
        title = newState ? '开启精确数值授权' : '关闭精确数值授权';
        message = newState
          ? '开启后，AI 可以看到精确的 D4Z4 重复数、甲基化百分比、具体报告日期等原始数值。这些数据更有助于精准建议，但属于敏感信息。需要同时开启上面两项。'
          : '关闭后，AI 只会看到临床化的描述（如"D4Z4 短"），具体数值不会进入提示词。';
        icon = newState ? 'wand-magic-sparkles' : 'minus-circle';
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

  const applyAiConsentUpdate = async (payload: ConsentUpdatePayload) => {
    setAiConsentSaving(true);
    try {
      const updated = await updateMyConsent(payload);
      setAiConsent(updated);
      showSuccessToast();
    } catch (err) {
      const message = err instanceof Error ? err.message : '同意状态更新失败，请稍后重试。';
      Alert.alert('更新失败', message);
    } finally {
      setAiConsentSaving(false);
    }
  };

  const confirmToggle = () => {
    if (!currentToggleInfo) return;

    const { id, newState } = currentToggleInfo;

    switch (id) {
      case 'trial-permission':
        setIsTrialPermissionEnabled(newState);
        showSuccessToast();
        break;
      case 'donation-permission':
        setIsDonationPermissionEnabled(newState);
        showSuccessToast();
        break;
      case 'hospital-sync':
        setIsHospitalSyncEnabled(newState);
        showSuccessToast();
        break;
      case 'community-share':
        setIsCommunityShareEnabled(newState);
        showSuccessToast();
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
        statusColor: CLINICAL_COLORS.textMuted,
        lastDonation: '--',
        donatedCount: '0 条',
      };
    }

    return {
      status: '已授权',
      statusColor: CLINICAL_COLORS.success,
      lastDonation: new Date().toLocaleDateString(),
      donatedCount: '12 条',
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
              color: CLINICAL_COLORS.textMuted,
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
              color: CLINICAL_COLORS.textMuted,
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

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>AI 数据授权</Text>
        <Text
          style={{
            paddingHorizontal: 24,
            paddingTop: 4,
            paddingBottom: 12,
            color: CLINICAL_COLORS.textMuted,
            fontSize: 12,
          }}
        >
          {levelLabel}
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
            isEnabled={flags.personal}
            disabled={aiConsentSaving}
            onToggle={(newState) => showConfirmModal(AI_TOGGLE_IDS.personal, newState)}
          />
        </View>

        <View style={styles.settingItem}>
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>第三方 LLM 处理</Text>
            <Text style={styles.settingDescription}>
              问题发送到云端大模型推理（SiliconFlow / DeepSeek）
              {thirdPartyLabel}
            </Text>
          </View>
          <ToggleSwitch
            isEnabled={flags.thirdParty}
            disabled={aiConsentSaving}
            onToggle={(newState) => showConfirmModal(AI_TOGGLE_IDS.thirdParty, newState)}
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
            isEnabled={flags.preciseValues}
            disabled={aiConsentSaving || !preciseAllowed}
            onToggle={(newState) => showConfirmModal(AI_TOGGLE_IDS.preciseValues, newState)}
          />
        </View>

        <TouchableOpacity
          style={styles.settingItem}
          activeOpacity={0.7}
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
          <FontAwesome6 name="chevron-right" size={12} color={CLINICAL_COLORS.textMuted} />
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 顶部导航栏 */}
      <View style={styles.header}>
        <ScreenBackButton />
        <Text style={styles.headerTitle}>隐私设置</Text>
        <View style={styles.headerPlaceholder} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* AI 数据授权 */}
        {renderAiConsentSection()}

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
              <Text style={styles.settingDescription}>将您的匿名化数据捐赠给FSHD科研项目</Text>
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
              <Text style={styles.settingDescription}>允许在社区中分享您的康复经验和训练视频</Text>
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
                  <FontAwesome6 name="chevron-right" size={10} color={CLINICAL_COLORS.accent} />
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
                <FontAwesome6 name="shield-halved" size={14} color={CLINICAL_COLORS.accent} />
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
      <SuccessToast isVisible={isSuccessToastVisible} message="设置已更新" />
    </SafeAreaView>
  );
};

export default PrivacySettingsScreen;
