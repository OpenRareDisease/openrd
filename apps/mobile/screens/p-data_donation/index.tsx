import { COLOR } from '../../lib/design';
import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Button from '../common/Button';
import ToggleSwitch from '../common/ToggleSwitch';
import Icon from '../common/Icon';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import styles from './styles';

import {
  ApiError,
  getMySharingPreferences,
  updateMySharingPreferences,
  type SharingPreferences,
} from '../../lib/api';
import ScreenHeader from '../common/ScreenHeader';
import { useAppDialog } from '../common/feedback/AppDialog';

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
  const { confirm, notify } = useAppDialog();
  const [prefs, setPrefs] = useState<SharingPreferences | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // A confirmation is open. Both entry points (the switch and the
  // 立即开启 button) check it, so a second press can't stack a second
  // dialog and leave the first promise unresolved.
  const [isConfirming, setIsConfirming] = useState(false);
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

  /**
   * Ask before either direction, then apply.
   *
   * Turning donation *off* used to fire straight from the switch with
   * no confirmation at all — a revocation of a research grant, one
   * stray press away, on a control sized for a fingertip. It now asks,
   * with the destructive treatment, and says the one thing a patient
   * cannot undo here: data already merged into the research set stays
   * there.
   */
  const requestToggle = async (enable: boolean) => {
    if (isLoading || isSubmitting || isConfirming) return;

    setIsConfirming(true);
    let confirmed = false;
    try {
      confirmed = enable
        ? await confirm({
            title: '确认开启数据捐赠',
            message:
              '开启后，您的医疗数据将经过严格脱敏处理，用于FSHD科研研究。您可以随时关闭捐赠功能。',
            confirmLabel: '确认开启',
          })
        : await confirm({
            title: '确认关闭数据捐赠',
            message:
              '关闭后，不会再有新的匿名化数据进入科研库。此前已捐赠并汇入研究的数据无法撤回。',
            confirmLabel: '关闭捐赠',
            cancelLabel: '继续捐赠',
            destructive: true,
          });
    } finally {
      setIsConfirming(false);
    }
    if (!confirmed) return;

    await toggleDonation(enable);
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
      // Both: the dialog is unmissable (the 立即开启 button sits in the
      // status section, far below the inline error next to the switch,
      // so the inline text alone can land off-screen), and the inline
      // copy survives dismissal so the reason stays next to the
      // control that still shows the old state.
      setSubmitError(message);
      notify({
        title: enable ? '开启失败' : '关闭失败',
        message,
        tone: 'error',
      });
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
        <ScreenHeader title="数据捐赠" style={styles.header} />
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 32,
            gap: 16,
          }}
        >
          <Icon name="user-plus" size={32} color={COLOR.inkMuted} />
          <Text
            style={{
              color: COLOR.ink,
              fontSize: 16,
              fontWeight: '600',
              textAlign: 'center',
            }}
          >
            还需要完善个人档案
          </Text>
          <Text
            style={{
              color: COLOR.inkMuted,
              fontSize: 13,
              textAlign: 'center',
              lineHeight: 20,
            }}
          >
            数据捐赠需要先建立个人健康档案。完成档案后即可在此处管理捐赠授权。
          </Text>
          <Button
            label="前往完善档案"
            variant="prominent"
            onPress={() => router.replace('/p-register_profile')}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header sits outside the ScrollView: it carries the only way
          back and the only way home, and scrolling it off the top of a
          long page took that away exactly when the patient wanted it. */}
      <ScreenHeader title="数据捐赠" style={styles.header} />

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Intro */}
        <View style={styles.donationIntroSection}>
          <View style={styles.introCard}>
            <LinearGradient
              colors={[COLOR.accent, COLOR.accent]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.donationIcon}
            >
              <Icon name="heart" size={18} color={COLOR.ink} />
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
                {/* `isDonationEnabled` is `Boolean(prefs?.flags?.…)`,
                    and a failed load leaves `prefs` null — so the
                    switch rendered and announced OFF for a patient who
                    had granted donation, and was still tappable, so
                    flipping it "on" would re-grant something already
                    granted. Say we don't know instead. */}
                <Text style={styles.toggleDescription}>
                  {loadError
                    ? '暂时读不到当前授权状态，请重试后再操作'
                    : '您的贡献将帮助推动FSHD研究进展'}
                </Text>
              </View>
              {/* Was a hand-rolled copy of 隐私设置's switch, sharing
                  its 26pt height, its missing hitSlop and its snapping
                  thumb. Same component now. */}
              <ToggleSwitch
                isEnabled={isDonationEnabled}
                disabled={isLoading || isSubmitting || isConfirming || Boolean(loadError)}
                accessibilityLabel="允许匿名化数据捐赠"
                onToggle={(next) => void requestToggle(next)}
              />
            </View>
          </View>
          {isLoading && (
            <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center' }}>
              <ActivityIndicator size="small" color={COLOR.accent} />
              <Text style={{ marginLeft: 8, color: COLOR.inkMuted }}>正在加载共享偏好…</Text>
            </View>
          )}
          {loadError && (
            <View style={{ marginTop: 8 }}>
              <Text style={{ color: COLOR.warn }}>{loadError}</Text>
              <Button
                label="重试"
                icon="rotate-right"
                variant="tinted"
                compact
                onPress={() => void load()}
              />
            </View>
          )}
          {submitError && <Text style={{ marginTop: 8, color: COLOR.warn }}>{submitError}</Text>}
        </View>

        {/* Status */}
        <View style={styles.donationStatusSection}>
          <Text style={styles.sectionTitle}>捐赠状态</Text>

          {/* `prefs === null` means the request has not landed (or
              failed), and Boolean(undefined) turned that into the same
              answer as an explicit "off" — so the card asserted
              暂未开启数据捐赠 about a state it had not read, and offered
              a button to enable something that may already be on. */}
          {!prefs ? (
            <View style={styles.notDonatingCard}>
              <View style={styles.notDonatingIcon}>
                <Icon name="heart" size={18} color={COLOR.inkMuted} />
              </View>
              <Text style={styles.notDonatingTitle}>
                {loadError ? '读取捐赠状态失败' : '正在读取捐赠状态'}
              </Text>
              <Text style={styles.notDonatingDescription}>
                {loadError ?? '稍等一下，读到之后这里会显示你当前的授权状态。'}
              </Text>
            </View>
          ) : !isDonationEnabled ? (
            <View style={styles.notDonatingCard}>
              <View style={styles.notDonatingIcon}>
                <Icon name="heart" size={18} color={COLOR.inkMuted} />
              </View>
              <Text style={styles.notDonatingTitle}>暂未开启数据捐赠</Text>
              <Text style={styles.notDonatingDescription}>
                开启捐赠后，您的数据将为FSHD研究做出重要贡献
              </Text>
              <Button
                label="立即开启"
                icon="heart"
                variant="prominent"
                busy={isSubmitting || isConfirming}
                disabled={isLoading}
                onPress={() => void requestToggle(true)}
              />
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

      {/* The confirmation is `useAppDialog().confirm` now — see
          requestToggle. The screen-local Modal it replaces could only
          ever ask about turning donation ON; turning it OFF, the one
          direction that revokes a research grant, never asked at all. */}

      {isSuccessToastVisible && (
        <View style={styles.successToast}>
          <Icon name="circle-check" size={12} color={COLOR.good} />
          <Text style={styles.successToastText}>设置已保存</Text>
        </View>
      )}
    </SafeAreaView>
  );
};

export default DataDonationScreen;
