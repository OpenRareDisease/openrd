import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Button from '../common/Button';
import ListGroup, { Row } from '../common/ListGroup';
import {
  ApiError,
  getClinicalPassportSummary,
  getMyPatientProfile,
  type ClinicalPassportSummary,
  type PatientProfile,
} from '../../lib/api';
import { formatDateLabel } from '../../lib/clinical-visuals';
import { COLOR } from '../../lib/design';
import { buildDataAssetOverview } from '../../lib/data-asset';
import { buildPatientVisualizationCards } from '../../lib/followup-analytics';
import { ambulationLabel } from '../../lib/profile-baseline-options';
import { buildReportInsights } from '../../lib/report-insights';
import ScreenHeader from '../common/ScreenHeader';
import styles from './styles';

const archiveNavItems = [
  {
    route: '/p-report_management',
    icon: 'file-medical',
    title: '报告管理',
    description: '按分类和时间整理全部报告',
  },
  {
    route: '/p-clinical_passport',
    icon: 'id-card',
    title: '临床护照',
    description: '门诊可直接出示的关键信息摘要',
  },
  {
    route: '/p-manage',
    icon: 'wave-square',
    title: '病程管理',
    description: '时间轴与趋势变化可视化',
  },
] as const;

// Semantic colours, kept clearly apart from the accent so teal never
// has to mean "good" — see lib/design.ts.
const trendMeta = {
  better: {
    label: '改善',
    color: COLOR.good,
    backgroundColor: COLOR.goodWash,
  },
  stable: {
    label: '平稳',
    color: COLOR.inkMuted,
    backgroundColor: COLOR.well,
  },
  worse: {
    label: '加重',
    color: COLOR.alert,
    backgroundColor: COLOR.alertWash,
  },
  new: {
    label: '新增',
    color: COLOR.warn,
    backgroundColor: COLOR.warnWash,
  },
} as const;

const formatGenderLabel = (value?: string | null) => {
  if (!value) return '未填写';
  if (value === 'male' || value === '男') return '男';
  if (value === 'female' || value === '女') return '女';
  return value;
};

const formatAgeLabel = (profile: PatientProfile | null) => {
  if (!profile) return '未填写';
  const birthYear = profile.baseline?.foundation?.birthYear;
  if (typeof birthYear === 'number' && birthYear > 1900) {
    return `${new Date().getFullYear() - birthYear} 岁左右`;
  }
  if (profile.dateOfBirth) {
    const birthDate = new Date(profile.dateOfBirth);
    if (!Number.isNaN(birthDate.getTime())) {
      const now = new Date();
      let age = now.getFullYear() - birthDate.getFullYear();
      const monthDiff = now.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) {
        age -= 1;
      }
      return `${age} 岁`;
    }
  }
  return '未填写';
};

const formatRegionLabel = (profile: PatientProfile | null) => {
  if (!profile) return '未填写';
  const regionLabel = profile.baseline?.foundation?.regionLabel;
  if (regionLabel) return regionLabel;
  return (
    [profile.regionProvince, profile.regionCity, profile.regionDistrict]
      .filter(Boolean)
      .join(' ') || '未填写'
  );
};

const formatAmbulationLabel = (profile: PatientProfile | null) =>
  ambulationLabel(profile?.baseline?.currentStatus?.independentlyAmbulatory) ?? '未填写';

const formatAssistiveDevicesLabel = (profile: PatientProfile | null) => {
  const devices = profile?.baseline?.currentStatus?.assistiveDevices?.filter(Boolean) ?? [];
  return devices.length ? devices.join('、') : '未记录';
};

const normalizeDisplayValue = (value?: string | null) => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '—') {
    return null;
  }
  return trimmed;
};

const uniqueDisplayValues = (values: Array<string | null | undefined>) =>
  Array.from(new Set(values.map((value) => normalizeDisplayValue(value)).filter(Boolean)));

const buildPassportId = (
  profile: PatientProfile | null,
  passport?: ClinicalPassportSummary | null,
) =>
  passport?.passportId ||
  (profile?.id
    ? `FSHD-${profile.id.replace(/-/g, '').slice(0, 10).toUpperCase()}`
    : 'FSHD-UNASSIGNED');

export default function ArchiveScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [passport, setPassport] = useState<ClinicalPassportSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadData = async (refresh = false) => {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      setErrorMessage(null);
      const [profileData, passportData] = await Promise.all([
        getMyPatientProfile(),
        getClinicalPassportSummary(),
      ]);
      setProfile(profileData);
      setPassport(passportData);
    } catch (error) {
      setProfile(null);
      setPassport(null);
      setErrorMessage(error instanceof ApiError ? error.message : '暂时无法加载我的档案。');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData().catch(() => undefined);
  }, []);

  const assetOverview = useMemo(
    () => (profile ? buildDataAssetOverview(profile) : null),
    [profile],
  );
  const visualizationCards = useMemo(() => buildPatientVisualizationCards(profile), [profile]);
  const reportInsights = useMemo(
    () => buildReportInsights(profile?.documents ?? [], profile),
    [profile],
  );
  const displayName =
    profile?.preferredName?.trim() ||
    profile?.fullName?.trim() ||
    passport?.patientName ||
    '我的档案';
  const passportId = buildPassportId(profile, passport);
  const reportCount = profile?.documents.length ?? 0;
  // `parsed` is what the async pipeline writes (migration 011);
  // `processed` / `completed` are the pre-pipeline vocabulary that
  // migration kept for old rows. Matching only the legacy pair meant
  // this counter read 0 on every account whose reports were parsed by
  // the current code — which is all of them.
  const RECOGNIZED_STATUSES = ['parsed', 'processed', 'completed'];
  const recognizedReportCount =
    profile?.documents.filter((item) => RECOGNIZED_STATUSES.includes(item.status)).length ?? 0;
  const diagnosisDateText =
    profile?.baseline?.foundation?.diagnosisYear !== undefined &&
    profile?.baseline?.foundation?.diagnosisYear !== null
      ? `${profile.baseline.foundation.diagnosisYear}`
      : profile?.diagnosisDate?.slice(0, 10) ||
        normalizeDisplayValue(reportInsights.diagnosisDate) ||
        normalizeDisplayValue(passport?.diagnosis.diagnosisDate) ||
        '未填写';
  const diagnosisTypeText =
    profile?.baseline?.diseaseBackground?.diagnosisType ||
    normalizeDisplayValue(reportInsights.geneticType) ||
    normalizeDisplayValue(passport?.diagnosis.geneticType) ||
    '等待报告识别';
  const geneticInfoText =
    uniqueDisplayValues([
      profile?.geneticMutation,
      normalizeDisplayValue(reportInsights.geneticType),
      profile?.baseline?.diseaseBackground?.d4z4
        ? `D4Z4 ${profile.baseline.diseaseBackground.d4z4}`
        : reportInsights.d4z4Repeats !== '—'
          ? `D4Z4 ${reportInsights.d4z4Repeats}`
          : passport?.diagnosis.d4z4Repeats && passport.diagnosis.d4z4Repeats !== '—'
            ? `D4Z4 ${passport.diagnosis.d4z4Repeats}`
            : null,
      profile?.baseline?.diseaseBackground?.haplotype
        ? `单倍型 ${profile.baseline.diseaseBackground.haplotype}`
        : reportInsights.haplotype !== '—'
          ? `单倍型 ${reportInsights.haplotype}`
          : null,
      profile?.baseline?.diseaseBackground?.methylation
        ? `甲基化 ${profile.baseline.diseaseBackground.methylation}`
        : reportInsights.methylationValue !== '—'
          ? `甲基化 ${reportInsights.methylationValue}`
          : passport?.diagnosis.methylationValue && passport.diagnosis.methylationValue !== '—'
            ? `甲基化 ${passport.diagnosis.methylationValue}`
            : null,
    ]).join(' · ') || '等待相关报告识别';

  const consoleSections = useMemo(
    () => [
      {
        key: 'personal',
        title: '个人基本信息',
        items: [
          { label: '姓名', value: displayName },
          { label: '性别', value: formatGenderLabel(profile?.gender) },
          { label: '年龄', value: formatAgeLabel(profile) },
          { label: '所在地区', value: formatRegionLabel(profile) },
        ],
      },
      {
        key: 'fshd',
        title: 'FSHD 相关信息',
        items: [
          { label: '临床护照 ID', value: passportId, accent: true },
          {
            label: '确诊时间',
            value: diagnosisDateText,
          },
          {
            label: '分型/诊断方式',
            value: diagnosisTypeText,
          },
          {
            label: '遗传信息',
            value: geneticInfoText,
          },
        ],
      },
      {
        key: 'background',
        title: '疾病背景',
        items: [
          {
            label: '首发部位',
            value: profile?.baseline?.diseaseBackground?.onsetRegion || '未填写',
          },
          {
            label: '家族史',
            value: profile?.baseline?.diseaseBackground?.familyHistory || '未填写',
          },
          { label: '当前行走', value: formatAmbulationLabel(profile) },
          { label: '辅具', value: formatAssistiveDevicesLabel(profile) },
        ],
      },
    ],
    [diagnosisDateText, diagnosisTypeText, displayName, geneticInfoText, passportId, profile],
  );
  return (
    <SafeAreaView style={styles.container}>
      {/* Was a page-wide LinearGradient. A gradient behind a record
          lowers the contrast of everything set on it; the page is now
          flat paper and the hierarchy comes from rules and type. */}
      <View style={styles.backgroundGradient}>
        {/* Since the archive left the tab bar it renders no AppTabBar
            and the root stack hides its header, so this row is the
            only way out — without it the sole exit is the iOS edge
            swipe, the gesture our users are least able to perform.
            `MY ARCHIVE` used to sit above the title; it said nothing
            我的档案 does not already say.

            Outside the ScrollView, matching p-data_entry: this page is
            long (hero, data-asset console, nav list, visualisation
            digest), and inside the scroller the only navigation
            surface on the screen scrolled away — a patient several
            hundred points down had no back and no home and had to
            fling all the way up to find one. A sticky header is the
            other way to do it, but hoisting keeps the ScrollView's
            refreshControl and content indices alone. */}
        <ScreenHeader title="我的档案" />
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadData(true).catch(() => undefined)}
              tintColor={COLOR.accent}
            />
          }
        >
          <View style={styles.header}>
            <View style={styles.headerActionRow}>
              <Button
                label="记录数据"
                icon="plus"
                variant="prominent"
                compact
                onPress={() => router.push('/p-data_entry')}
              />
            </View>
          </View>

          {/* The one filled block on this screen: whose record this is,
              plus the three counts that describe it. Everything below
              is set on the page. */}
          {/* Suppressed on a failed load, the same guard the data-asset
              console directly below already had. `loadData`'s catch
              nulls the profile, so a failed request produced exactly
              the shape of a brand-new empty account: the hero asserted
              FSHD-UNASSIGNED, 0 报告总数, 0 已识别 and 「已建立患者档案」
              — the app telling a patient whose network blipped that
              their record is empty, directly above the error saying it
              could not read it. */}
          {errorMessage ? null : (
            <View style={styles.section}>
              <View style={styles.heroCard}>
                <Text style={styles.heroTitle}>{displayName}</Text>
                <Text style={styles.heroMeta}>{passportId}</Text>
                <Text style={styles.heroSummary}>
                  已建立患者档案、临床护照与系统检查入口。这里集中查看个人信息、FSHD
                  相关信息和患者端可视化。
                </Text>
                <View style={styles.reportStatGrid}>
                  <View style={styles.reportStatCard}>
                    <Text style={styles.reportStatValue}>{reportCount}</Text>
                    <Text style={styles.reportStatLabel}>报告总数</Text>
                  </View>
                  <View style={styles.reportStatCard}>
                    <Text style={styles.reportStatValue}>{recognizedReportCount}</Text>
                    <Text style={styles.reportStatLabel}>已识别</Text>
                  </View>
                  <View style={styles.reportStatCard}>
                    <Text style={styles.reportStatValue}>
                      {formatDateLabel(passport?.latestUpdatedAt ?? profile?.updatedAt)}
                    </Text>
                    <Text style={styles.reportStatLabel}>最近更新</Text>
                  </View>
                </View>
              </View>
            </View>
          )}

          {/* Data-asset overview: completeness, report coverage,
              record continuity, and freshness at a glance — every gap
              chip deep-links to where it gets filled. */}
          {assetOverview ? (
            <View style={styles.section}>
              <View style={styles.assetCard}>
                <View style={styles.assetHeaderRow}>
                  <Text style={styles.assetTitle}>我的数据资产</Text>
                  <Text style={styles.assetPercent}>{assetOverview.completenessPercent}%</Text>
                </View>
                <View style={styles.assetProgressTrack}>
                  <View
                    style={[
                      styles.assetProgressFill,
                      { width: `${assetOverview.completenessPercent}%` },
                    ]}
                  />
                </View>
                {assetOverview.gaps.length > 0 ? (
                  <View style={styles.assetGapRow}>
                    <Text style={styles.assetGapLead}>待补充：</Text>
                    {assetOverview.gaps.map((gap) => (
                      <Button
                        key={gap.key}
                        label={gap.label}
                        variant="tinted"
                        compact
                        trailingIcon="arrow-right"
                        onPress={() => router.push(gap.route)}
                      />
                    ))}
                  </View>
                ) : (
                  <Text style={styles.assetGapDone}>核心资料已齐全，保持记录就好。</Text>
                )}
                <View style={styles.assetSignalList}>
                  {(
                    [
                      ['coverage', assetOverview.coverage],
                      ['continuity', assetOverview.continuity],
                      ['freshness', assetOverview.freshness],
                    ] as const
                  ).map(([key, signal]) => (
                    <View key={key} style={styles.assetSignalRow}>
                      <View
                        style={[
                          styles.assetSignalDot,
                          signal.tone === 'ok'
                            ? styles.assetSignalDotOk
                            : styles.assetSignalDotWarn,
                        ]}
                      />
                      <Text style={styles.assetSignalText}>{signal.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          ) : null}

          {/* Archive sub-pages live here as in-page navigation — the
              header stays a title + one primary action, so the home
              screen remains the single global hub. */}
          <View style={styles.section}>
            {/* These were hand-rolled Touchables with no accessibilityRole
                — three cards that navigate, reaching a screen reader as
                unlabelled text. ListGroup.Row is what the pattern is for:
                it carries the role, the name, the press fill and the 48pt
                target, and it draws the chevron on exactly the rows that
                navigate, which is what makes the chevron mean anything. */}
            <ListGroup>
              {archiveNavItems.map((nav) => (
                <Row
                  key={nav.route}
                  icon={nav.icon}
                  label={nav.title}
                  detail={nav.description}
                  onPress={() => router.push(nav.route)}
                />
              ))}
            </ListGroup>
          </View>

          {errorMessage ? (
            <View style={styles.section}>
              <View style={styles.stateWrap}>
                <Text style={styles.stateText}>{errorMessage}</Text>
                <Button
                  label="重新加载"
                  icon="rotate-right"
                  variant="tinted"
                  onPress={() => loadData().catch(() => undefined)}
                />
              </View>
            </View>
          ) : null}

          {/* Hidden when the profile never arrived. The catch nulls
              `profile`, and every field helper answers null with
              「未填写」/「未记录」— so a failed request rendered a
              complete, plausible, entirely false archive: the screen
              told the patient they had filled in nothing. */}
          {profile ? (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionTitle}>档案控制台</Text>
                  <Text style={styles.sectionSubtitle}>集中查看个人基本信息和 FSHD 关键背景。</Text>
                </View>
              </View>

              <View style={styles.consoleStack}>
                {consoleSections.map((section) => (
                  <View key={section.key} style={styles.consoleCard}>
                    <Text style={styles.consoleTitle}>{section.title}</Text>
                    {/* Label/value rows on one aligned column instead of a
                      2-up grid of tinted mini-cards: values line up, and
                      a long 遗传信息 string no longer needs a special
                      full-width variant. */}
                    <View style={styles.consoleItemGrid}>
                      {section.items.map((item) => (
                        <View key={`${section.key}-${item.label}`} style={styles.consoleItemCard}>
                          <Text style={styles.consoleItemLabel}>{item.label}</Text>
                          <Text
                            style={[
                              styles.consoleItemValue,
                              item.accent && styles.consoleItemValueAccent,
                            ]}
                          >
                            {item.value}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* 患者端数据可视化 used to be rendered here *and* on 病程,
              from the same `buildPatientVisualizationCards` source —
              two copies of one answer, which is why "我最近是不是变差
              了" felt like it needed cross-referencing. The charts now
              live on 病程 only; the archive keeps the digest below and
              points at the full view. */}
          <View style={styles.crossLinkSection}>
            <ListGroup>
              <Row
                icon="wave-square"
                label="趋势与受累可视化在「病程」"
                detail="时间轴、MRI 受累图和日常记录曲线都集中在那里，不再分两处显示。"
                onPress={() => router.push('/p-manage')}
              />
            </ListGroup>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>记录摘要</Text>
                <Text style={styles.sectionSubtitle}>整合最近一次患者端记录。</Text>
              </View>
            </View>

            {/* Was a card wrapping a list wrapping one tinted card per
                item — three boxes deep for a three-line summary. Now
                each entry is a rule-separated block on the page, with
                the value promoted above its own description. */}
            <View style={styles.visualizationDigestCard}>
              {visualizationCards.map((item) => {
                const meta = trendMeta[item.trend];
                return (
                  <View key={`${item.key}-digest`} style={styles.visualizationDigestItem}>
                    <View style={styles.visualizationDigestTopRow}>
                      <Text style={styles.visualizationDigestTitle}>{item.label}</Text>
                      <View
                        style={[styles.summaryBadge, { backgroundColor: meta.backgroundColor }]}
                      >
                        <Text style={[styles.summaryBadgeText, { color: meta.color }]}>
                          {meta.label}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.visualizationDigestValue}>{item.latestDisplay}</Text>
                    <Text style={styles.visualizationDigestText}>{item.summary}</Text>
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {isLoading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={COLOR.accent} />
            <Text style={styles.loadingText}>正在整理我的档案...</Text>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}
