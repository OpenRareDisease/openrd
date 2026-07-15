import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FontAwesome6 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import styles from './styles';
import { CLINICAL_COLORS } from '../../lib/clinical-visuals';
import {
  ApiError,
  getMySharingPreferences,
  updateMySharingPreferences,
  type SharingPreferences,
} from '../../lib/api';
import ScreenBackButton from '../common/ScreenBackButton';

/**
 * Data donation screen.
 *
 * Previously this screen kept the donation flag in local state only,
 * with hard-coded "捐赠天数 / 数据条目" stats and a fake "上次捐赠时间"
 * that never reflected reality. That meant the privacy-settings screen
 * (which DOES write to /me/sharing-preferences) and this screen could
 * disagree about whether the user had actually granted donation —
 * patients legitimately thought they had granted/revoked donation when
 * they did neither.
 *
 * Both screens now share `dataDonation` on `sharing-preferences` and
 * the fake stat block is gone. If a future stats feature lands, it
 * should come from a real backend endpoint, not a literal.
 */
const DataDonationScreen = () => {
  const router = useRouter();
  const [prefs, setPrefs] = useState<SharingPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isConfirmModalVisible, setIsConfirmModalVisible] = useState(false);
  const [isSuccessToastVisible, setIsSuccessToastVisible] = useState(false);

  const isDonationEnabled = Boolean(prefs?.flags?.dataDonation);
  const lastDonationTime = prefs?.timestamps?.dataDonationAt ?? null;

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    setNeedsOnboarding(false);
    try {
      const fresh = await getMySharingPreferences();
      setPrefs(fresh);
    } catch (error) {
      // 404 = caller has no `patient_profiles` row yet (a newly
      // registered account that hasn't completed onboarding). The
      // generic "重试" button would never succeed — route them to
      // the onboarding screen instead.
      if (error instanceof ApiError && error.status === 404) {
        setNeedsOnboarding(true);
        return;
      }
      const message =
        error instanceof ApiError && error.message ? error.message : '加载共享偏好失败';
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDonationToggle = () => {
    if (isSubmitting) return;
    if (!isDonationEnabled) {
      setIsConfirmModalVisible(true);
    } else {
      void toggleDonation(false);
    }
  };

  const handleEnableDonationPress = () => {
    if (isSubmitting) return;
    setIsConfirmModalVisible(true);
  };

  const handleModalCancel = () => {
    setIsConfirmModalVisible(false);
  };

  const handleModalConfirm = () => {
    setIsConfirmModalVisible(false);
    void toggleDonation(true);
  };

  const toggleDonation = async (enable: boolean) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const updated = await updateMySharingPreferences({ dataDonation: enable });
      setPrefs(updated);
      setIsSuccessToastVisible(true);
      setTimeout(() => setIsSuccessToastVisible(false), 2000);
    } catch (error) {
      const message =
        error instanceof ApiError && error.message ? error.message : '更新失败，请稍后重试';
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formattedLastTime = lastDonationTime
    ? (() => {
        const d = new Date(lastDonationTime);
        return Number.isNaN(d.getTime())
          ? lastDonationTime
          : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
      })()
    : null;

  // No-profile guard: a freshly registered account that hasn't
  // finished onboarding (`patient_profiles` row missing) gets a 404
  // from /me/sharing-preferences. The generic "重试" button on the
  // bottom of the screen would never make that 404 go away. Render a
  // dedicated screen that explains the gap and routes them to the
  // onboarding flow.
  if (needsOnboarding) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <ScreenBackButton />
          <Text style={styles.pageTitle}>数据捐赠</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
            gap: 16,
          }}
        >
          <FontAwesome6 name="user-plus" size={32} color={CLINICAL_COLORS.textMuted} />
          <Text
            style={{
              color: CLINICAL_COLORS.text,
              fontSize: 16,
              fontWeight: '600',
              textAlign: 'center',
            }}
          >
            还需要完善个人档案
          </Text>
          <Text
            style={{
              color: CLINICAL_COLORS.textMuted,
              fontSize: 13,
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            数据捐赠需要先建立个人健康档案。完成档案后即可在此处管理捐赠授权。
          </Text>
          <TouchableOpacity
            style={styles.enableDonationButton}
            onPress={() => router.replace('/p-register_profile')}
          >
            <Text style={styles.enableDonationButtonText}>前往完善档案</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <ScreenBackButton />
          <Text style={styles.pageTitle}>数据捐赠</Text>
          <View style={styles.headerSpacer} />
        </View>

        {/* Intro */}
        <View style={styles.donationIntroSection}>
          <View style={styles.introCard}>
            <LinearGradient
              colors={[CLINICAL_COLORS.accent, CLINICAL_COLORS.accentStrong]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.donationIcon}
            >
              <FontAwesome6 name="heart" size={18} color={CLINICAL_COLORS.text} solid />
            </LinearGradient>
            <Text style={styles.introTitle}>为FSHD研究贡献力量</Text>
            <Text style={styles.introDescription}>
              您的匿名化数据将帮助科学家更好地了解FSHD，加速新药研发和治疗方案的改进，为全球FSHD患者带来希望。
            </Text>
          </View>
        </View>

        {/* Process */}
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
                <Text style={styles.stepDescription}>数据汇入中国 FSHD 病友群体数据库</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Toggle — wired to /me/sharing-preferences.dataDonation */}
        <View style={styles.donationToggleSection}>
          <View style={styles.toggleCard}>
            <View style={styles.toggleContent}>
              <View style={styles.toggleTextContainer}>
                <Text style={styles.toggleTitle}>允许匿名化数据捐赠</Text>
                <Text style={styles.toggleDescription}>您的贡献将帮助推动FSHD研究进展</Text>
              </View>
              <TouchableOpacity
                style={[
                  styles.toggleSwitch,
                  isDonationEnabled && styles.toggleSwitchActive,
                  (isLoading || isSubmitting) && { opacity: 0.6 },
                ]}
                onPress={handleDonationToggle}
                disabled={isLoading || isSubmitting}
              >
                <View style={[styles.toggleThumb, isDonationEnabled && styles.toggleThumbActive]} />
              </TouchableOpacity>
            </View>
          </View>
          {isLoading && (
            <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator size="small" color={CLINICAL_COLORS.accent} />
              <Text style={{ marginLeft: 8, color: CLINICAL_COLORS.textMuted }}>
                正在加载共享偏好…
              </Text>
            </View>
          )}
          {loadError && (
            <View style={{ marginTop: 8 }}>
              <Text style={{ color: CLINICAL_COLORS.warning }}>{loadError}</Text>
              <TouchableOpacity onPress={() => void load()} style={{ marginTop: 4 }}>
                <Text style={{ color: CLINICAL_COLORS.accent }}>重试</Text>
              </TouchableOpacity>
            </View>
          )}
          {submitError && (
            <Text style={{ marginTop: 8, color: CLINICAL_COLORS.warning }}>{submitError}</Text>
          )}
        </View>

        {/* Status */}
        <View style={styles.donationStatusSection}>
          <Text style={styles.sectionTitle}>捐赠状态</Text>

          {!isDonationEnabled ? (
            <View style={styles.notDonatingCard}>
              <View style={styles.notDonatingIcon}>
                <FontAwesome6 name="heart" size={18} color={CLINICAL_COLORS.textMuted} />
              </View>
              <Text style={styles.notDonatingTitle}>暂未开启数据捐赠</Text>
              <Text style={styles.notDonatingDescription}>
                开启捐赠后，您的数据将为FSHD研究做出重要贡献
              </Text>
              <TouchableOpacity
                style={[
                  styles.enableDonationButton,
                  (isLoading || isSubmitting) && { opacity: 0.6 },
                ]}
                onPress={handleEnableDonationPress}
                disabled={isLoading || isSubmitting}
              >
                <Text style={styles.enableDonationButtonText}>立即开启</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.donatingCard}>
              <Text style={styles.donatingTitle}>感谢您的爱心捐赠</Text>
              <Text style={styles.donatingDescription}>您的数据正在为FSHD研究提供重要支持</Text>
              {formattedLastTime && (
                <Text style={styles.lastDonationTime}>上次更新时间：{formattedLastTime}</Text>
              )}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Confirm modal */}
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
              <TouchableOpacity
                style={[styles.modalConfirmButton, isSubmitting && { opacity: 0.6 }]}
                onPress={handleModalConfirm}
                disabled={isSubmitting}
              >
                <Text style={styles.modalConfirmButtonText}>
                  {isSubmitting ? '处理中…' : '确认开启'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {isSuccessToastVisible && (
        <View style={styles.successToast}>
          <FontAwesome6 name="circle-check" size={12} color={CLINICAL_COLORS.success} />
          <Text style={styles.successToastText}>设置已保存</Text>
        </View>
      )}
    </SafeAreaView>
  );
};

export default DataDonationScreen;
