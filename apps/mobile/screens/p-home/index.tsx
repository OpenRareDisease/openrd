import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Button from '../common/Button';
import ListGroup, { Row } from '../common/ListGroup';
import Icon from '../common/Icon';
import {
  ApiError,
  getMyPatientProfile,
  getProgressionSummary,
  type PatientProfile,
  type ProgressionSummary,
} from '../../lib/api';
import { formatDateLabel } from '../../lib/clinical-visuals';
import { COLOR } from '../../lib/design';
import { buildGuidanceCards } from '../../lib/guidance-cards';
import AskAboutDrawer from '../common/AskAboutDrawer';
import styles from './styles';

/**
 * 今天 — the brief, not the directory.
 *
 * This screen used to open with six quick-action cards, three of
 * which duplicated tabs sitting two centimetres below them. That
 * layout answered "what can this app do"; a patient opening it
 * already knows, and is asking something else entirely: am I getting
 * worse, and is there anything I'm supposed to do today.
 *
 * So the first thing on screen is now a sentence about *them* —
 * assembled from the same progression data the old screen buried
 * three sections down — followed only by things that are actually
 * actionable right now. Navigation happens by following a finding,
 * not by reading an index.
 */

const TREND_META: Record<
  ProgressionSummary['changeCards'][number]['trend'],
  { color: string; label: string; icon: string }
> = {
  better: { color: COLOR.good, label: '改善', icon: 'arrow-trend-down' },
  stable: { color: COLOR.inkMuted, label: '平稳', icon: 'minus' },
  worse: { color: COLOR.alert, label: '加重', icon: 'arrow-trend-up' },
  new: { color: COLOR.warn, label: '新增', icon: 'circle-plus' },
};

const DAY_MS = 24 * 60 * 60 * 1000;

const greetingForHour = (hour: number): string => {
  if (hour < 5) return '夜深了';
  if (hour < 11) return '早上好';
  if (hour < 14) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
};

const todayLabel = (now: Date): string => {
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${now.getMonth() + 1}月${now.getDate()}日 · ${weekdays[now.getDay()]}`;
};

/**
 * Whole calendar days between a timestamp and now.
 *
 * Deliberately not `(now - then) / 24h`: recording at 20:00 and
 * opening the app at 09:00 the next morning is 13 hours, which floors
 * to 0 and tells the patient「今天已经记录过了」under a header that
 * already says tomorrow's date. Recording at night and checking in the
 * morning is this product's modal usage, so the arithmetic has to
 * agree with the calendar the patient is reading.
 */
const daysSince = (iso: string | null | undefined, now: number): number | null => {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.max(0, Math.round((startOfDay(new Date(now)) - startOfDay(then)) / DAY_MS));
};

const HomeScreen = () => {
  const router = useRouter();
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [summary, setSummary] = useState<ProgressionSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [askVisible, setAskVisible] = useState(false);

  const guidanceCards = useMemo(() => buildGuidanceCards(profile), [profile]);

  const loadData = async (refresh = false) => {
    if (refresh) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }

    try {
      setErrorMessage(null);
      const [profileData, summaryData] = await Promise.all([
        getMyPatientProfile(),
        getProgressionSummary(),
      ]);
      setProfile(profileData);
      setSummary(summaryData);
    } catch (error) {
      setProfile(null);
      setSummary(null);
      setErrorMessage(
        error instanceof ApiError ? error.message : '暂时无法整理今天的简报，请稍后重试。',
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData().catch(() => undefined);
  }, []);

  // One clock reading per load rather than per render: `todayLabel`
  // and the greeting derive from it, and recomputing on every render
  // made them jitter without ever actually refreshing across midnight.
  const now = useMemo(() => new Date(), [isLoading, isRefreshing]);
  const displayName = profile?.preferredName?.trim() || profile?.fullName?.trim() || '朋友';

  const staleDays = daysSince(summary?.currentStatus.lastFollowupAt ?? null, now.getTime());

  // NOTE: the「待解读报告」row used to be computed here as well as in
  // lib/guidance-cards.ts, and the two rendered next to each other —
  // same count, same destination, two wordings. guidance-cards is the
  // single source of truth now.

  const changeCards = summary?.changeCards?.slice(0, 3) ?? [];
  const reviewItems = summary?.recommendedReviewItems?.slice(0, 3) ?? [];

  return (
    <SafeAreaView style={styles.container}>
      {/* Plain paper. The page gradient was doing decorative work at
          the cost of making every surface on top of it low-contrast. */}
      <View style={styles.backgroundGradient}>
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
            <Text style={styles.eyebrow}>{todayLabel(now)}</Text>
            <Text style={styles.pageTitle}>
              {greetingForHour(now.getHours())}，{displayName}
            </Text>
          </View>

          {/* 简报 — the single most important thing we can say today.
              Phase 1 sources it from the server's progression narrative
              and the local rule engine; phase 2 swaps the body for a
              real LLM brief and keeps this layout. */}
          <View style={styles.briefCard}>
            <View style={styles.briefHead}>
              <View style={styles.briefDot} />
              <Text style={styles.briefLabel}>今日简报</Text>
            </View>

            {errorMessage ? (
              <>
                <Text style={styles.briefText}>{errorMessage}</Text>
                <Button
                  label="重新加载"
                  icon="rotate-right"
                  variant="tinted"
                  onPress={() => loadData().catch(() => undefined)}
                />
              </>
            ) : (
              <>
                <Text style={styles.briefHeadline}>
                  {summary?.currentStatus.headline ?? '正在建立你的病程基线'}
                </Text>
                <Text style={styles.briefText}>
                  {summary?.currentStatus.detail ??
                    '再记录几次日常状态，这里就会开始告诉你变化在哪。'}
                </Text>

                <View style={styles.briefActions}>
                  {/* Opens in place rather than navigating to 问答:
                      the brief is the thing being asked about, and
                      losing it off-screen to ask about it was exactly
                      the round trip this redesign removes. */}
                  <Button
                    label="这什么意思"
                    variant="prominent"
                    onPress={() => setAskVisible(true)}
                  />
                  <Button
                    label="看完整病程"
                    variant="tinted"
                    onPress={() => router.push('/p-manage')}
                  />
                </View>
              </>
            )}
          </View>

          {/* 待办 — only things the patient can act on right now. An
              empty list here is a legitimate, good outcome; we say so
              rather than manufacturing a task. */}
          {/* 待办 — only things the patient can act on right now. An
              empty list here is a legitimate, good outcome; we say so
              rather than manufacturing a task.

              Gated on `!errorMessage` as well: when the load fails,
              `profile` is null and buildGuidanceCards(null) returns its
              first-run card. A patient with three years of records was
              being shown「暂时无法整理今天的简报」and「从第一步开始」
              at the same time. */}
          {!errorMessage && guidanceCards.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>需要你</Text>

              {/* Hand-rolled Touchables with no accessibilityRole: the
                  home screen's 需要你 list — the app's own prompts to
                  the patient — reached a screen reader as unlabelled
                  text. And `rowIconWrap` was `display: 'none'`, so each
                  row still rendered an Icon into a hidden box. Same
                  ListGroup.Row as 档案 now, icon included. */}
              <ListGroup>
                {guidanceCards.map((card) => (
                  <Row
                    key={card.key}
                    icon={card.icon as string}
                    label={card.title}
                    detail={card.description}
                    onPress={() =>
                      card.params
                        ? router.push({ pathname: card.route, params: card.params })
                        : router.push(card.route)
                    }
                  />
                ))}
              </ListGroup>
            </View>
          ) : null}

          {/* 最近的变化 — the answer to "am I getting worse", stated
              before the patient has to go looking for it. */}
          {changeCards.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionHeadRow}>
                <Text style={styles.sectionTitle}>最近的变化</Text>
                <Button
                  label="全部"
                  variant="plain"
                  compact
                  trailingIcon="chevron-right"
                  onPress={() => router.push('/p-manage')}
                />
              </View>

              {changeCards.map((card) => {
                const meta = TREND_META[card.trend];
                return (
                  <View key={card.id} style={styles.actionRow}>
                    <View style={[styles.rowStripe, { backgroundColor: meta.color }]} />
                    <View style={styles.rowTextWrap}>
                      <Text style={styles.rowTitle}>{card.title}</Text>
                      <Text style={styles.rowSubtitle}>{card.detail}</Text>
                    </View>
                    <View style={[styles.trendBadge, { borderColor: meta.color }]}>
                      <Icon name={meta.icon} size={10} color={meta.color} />
                      <Text style={[styles.trendBadgeText, { color: meta.color }]}>
                        {meta.label}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* 记录节奏 — a single honest line about data freshness,
              replacing the old three-metric hero whose numbers
              (report count, profile completeness) nobody acts on. */}
          {!errorMessage ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>记录节奏</Text>
              <ListGroup>
                <Row
                  icon="pen-to-square"
                  label={
                    staleDays === null
                      ? '还没有日常记录'
                      : staleDays === 0
                        ? '今天已经记录过了'
                        : `距上次记录 ${staleDays} 天`
                  }
                  detail={
                    summary?.currentStatus.lastFollowupAt
                      ? `最近一次：${formatDateLabel(summary.currentStatus.lastFollowupAt)}`
                      : '记一条只要 30 秒，趋势曲线从第二条开始出现'
                  }
                  onPress={() => router.push('/p-data_entry')}
                />
              </ListGroup>
            </View>
          ) : null}

          {reviewItems.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>下次门诊可以提</Text>
              {reviewItems.map((item) => (
                <View key={item} style={styles.reviewItem}>
                  <Icon name="circle-check" size={12} color={COLOR.accent} />
                  <Text style={styles.reviewItemText}>{item}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>

        {isLoading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator color={COLOR.accent} />
            <Text style={styles.loadingText}>正在整理今天的简报...</Text>
          </View>
        ) : null}

        {/* No context ref: the brief spans every source at once, so
            pinning it to one object would be a lie. */}
        <AskAboutDrawer
          visible={askVisible}
          onClose={() => setAskVisible(false)}
          suggestions={['我最近是不是变差了', '这段时间有什么变化', '下次门诊我该问什么']}
        />
      </View>
    </SafeAreaView>
  );
};

export default HomeScreen;
