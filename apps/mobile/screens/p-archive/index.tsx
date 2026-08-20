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
  readPassportValueOrigins,
  type ClinicalPassportSummary,
  type PassportValueOrigin,
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

/**
 * 「D4Z4 3（报告读取）」 — one printed value with the source the API
 * recorded beside it, or null for a value the passport did not print.
 *
 * The bracket is the API's own `labelZh` and the shape is the API's
 * own: `withValueOrigin` in profile.passport.ts writes
 * 「值（来源）」 into the markdown export and the referral pack, the
 * passport screen sets the same phrase under the value, and the share
 * page prints it beside one. This screen is one tap from that passport
 * and prints the same three values, so a second vocabulary here would
 * be the app disagreeing with itself about where a number came from —
 * including the API's own 「转录自非基因报告文件」, which is the whole
 * difference between a laboratory's number and a clinic's transcription
 * of one.
 *
 * `absent` gets no bracket: 「—（未填）」 is two ways of saying one
 * thing, and `normalizeDisplayValue` has already dropped the value.
 * A null origin gets none either — the note under the card is what
 * says the server did not send them, because a missing bracket read as
 * 「off a report」 is the one direction this record exists to prevent.
 *
 * The prefix is attached only once there is something to attach it to,
 * so no row can come out as a bare 「D4Z4」.
 */
const labelledValue = (
  prefix: string | null,
  value: string | null | undefined,
  origin: PassportValueOrigin | null,
) => {
  const normalized = normalizeDisplayValue(value);
  if (!normalized) return null;
  const labelled = prefix ? `${prefix} ${normalized}` : normalized;
  return origin && origin.kind !== 'absent' ? `${labelled}（${origin.labelZh}）` : labelled;
};

/** One card of the 档案控制台: label/value rows, and — where there is
 *  one — a line about the rows rather than another row. Written out
 *  rather than inferred from the literal, so that the card carrying a
 *  `note` does not change how the other cards' items are typed. */
interface ConsoleSection {
  key: string;
  title: string;
  items: Array<{ label: string; value: string; accent?: boolean }>;
  note?: string | null;
}

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
  /**
   * THE TWO GENETIC ROWS COME OFF THE PASSPORT, WHOLE.
   *
   * Both used to be assembled here field by field, and every field
   * preferred the archive's own copy to the report's, falling through
   * to the report only where the archive was empty:
   * `baseline.diseaseBackground.diagnosisType` for 分型, `.d4z4` for
   * D4Z4, `.haplotype` for 单倍型, `.methylation` for 甲基化.
   *
   * That is the per-row merge `pickGeneticEvidenceDocument` exists to
   * forbid. 分型, 单倍型, EcoRI 片段, D4Z4 重复数 and 甲基化 are one
   * assay's reading, and a line holding a repeat count out of the
   * archive next to a haplotype read off a laboratory report reads as
   * one report that stated both — which is the sentence the whole
   * picker was written to stop this product saying. Rendered before the
   * change, on a profile whose archive said FSHD2 / 10 / 55% and whose
   * one parsed genetics report said FSHD1 / 3 / 4qA / 25%: this row
   * printed 「FSHD1 · D4Z4 10 · 单倍型 4qA · 甲基化 55%」 — three sources
   * in five words — while 分型/诊断方式 directly above it printed FSHD2
   * and 临床护照 printed FSHD1 · 3 · 25%.
   *
   * `passport.diagnosis` is the answer everything else already uses.
   * The API resolves each of these values off the ONE document the
   * picker names and falls back to the archive per value with an origin
   * recorded beside it (`valueOrigins`), which is what the passport
   * screen, the share page, the referral pack and both registry exports
   * print. Reading it here is what makes 我的档案 and 临床护照 incapable
   * of naming different numbers for the same assay.
   *
   * 单倍型 is gone rather than re-sourced. It is on no passport row —
   * the API prints it only inside the joined 基因证据 string, and only
   * ever off the report — so the archive's own copy, which this line
   * used to prefer, appears nowhere else in the product. A patient whose
   * report states one still sees it on 临床护照 and 病程.
   *
   * `profile.geneticMutation` is gone for the opposite reason: it is not
   * dropped, it is already inside `diagnosis.geneticType`, which the API
   * resolves as report → baseline → that column.
   *
   * AND EACH VALUE KEEPS THE SOURCE IT ARRIVED WITH. The move brought
   * `valueOrigins` onto this screen along with the numbers, and for one
   * round the numbers were printed without it — 「FSHD1 · D4Z4 3 · 甲基化
   * 25%」, the same line whether a laboratory measured them, an
   * administrator took them down over the phone, or this platform read
   * them off a 病历摘要 quoting somebody's report. A tap away, 临床护照
   * prints each of those three states differently under the same value.
   * The bracket is the API's own phrase; see `labelledValue`.
   */
  const valueOrigins = useMemo(
    () => readPassportValueOrigins(passport?.diagnosis.valueOrigins),
    [passport],
  );
  /**
   * The three values this card takes off the passport whole.
   *
   * `diagnosisDate` is the fourth key in the map and is deliberately
   * not here: 确诊时间 above is resolved on this screen from the
   * baseline's 确诊年份, then the profile column, then the report
   * insights, and only then the passport — so the passport's origin for
   * its own 诊断日期 is not a statement about the string this row
   * prints. A bracket taken from it would be attributing one value's
   * source to another.
   */
  const originFor = (key: 'geneticType' | 'd4z4Repeats' | 'methylationValue') =>
    valueOrigins?.[key] ?? null;
  const diagnosisTypeText =
    labelledValue(null, passport?.diagnosis.geneticType, originFor('geneticType')) ??
    '等待报告识别';
  const geneticInfoText =
    uniqueDisplayValues([
      labelledValue(null, passport?.diagnosis.geneticType, originFor('geneticType')),
      labelledValue('D4Z4', passport?.diagnosis.d4z4Repeats, originFor('d4z4Repeats')),
      labelledValue('甲基化', passport?.diagnosis.methylationValue, originFor('methylationValue')),
    ]).join(' · ') || '等待相关报告识别';
  /**
   * The line that has to be there when the brackets are not.
   *
   * `readPassportValueOrigins` returns null for an API build that sends
   * no origins at all — this app is a web export WeChat caches for days
   * — and silence would then be read as 「every one of these came off a
   * report」 by anyone who has learned what the bracket means. Written
   * only when the passport actually printed one of the three: a card
   * showing 等待报告识别 has no value whose source could be missing.
   *
   * The wording is the passport's own 逐项来源 note, narrowed to the
   * values this card prints.
   */
  const missingOriginsNote =
    passport && !valueOrigins && geneticInfoText !== '等待相关报告识别'
      ? '服务端这一版没有把逐项来源发全：上面这几个值是从报告里读出来的，还是谁填进去的，本平台这次说不出来。'
      : null;

  const consoleSections = useMemo<ConsoleSection[]>(
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
        note: missingOriginsNote,
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
    [
      diagnosisDateText,
      diagnosisTypeText,
      displayName,
      geneticInfoText,
      missingOriginsNote,
      passportId,
      profile,
    ],
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
                    {/* Only 「the server did not send the sources」 ever
                        writes one of these, and it is written only
                        while there is a value above it whose source is
                        missing — see `missingOriginsNote`. */}
                    {section.note ? (
                      <Text style={styles.consoleCardNote}>{section.note}</Text>
                    ) : null}
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
