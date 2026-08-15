import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../common/ScreenHeader';
import Button from '../common/Button';
import Icon from '../common/Icon';
import styles from './styles';
import { ApiError } from '../../lib/api';
import { COLOR } from '../../lib/design';
import { listTrials } from '../../lib/trials-api';
import {
  CHINA_REGISTRY_NAME,
  CHINA_REGISTRY_URL,
  COVERAGE_NOTE_CTGOV_ONLY,
  TRIALS_DISCLAIMER,
  TRIALS_INTRO,
  TRIAL_SOURCE_NAMES,
  describeChinaCoverage,
  describeCtgovStaleness,
  describeEmptyList,
  groupTrials,
  hasChinaSite,
  readRegistryDay,
  shownListFetchedOn,
  trialPhaseLabel,
  trialStatusLabel,
  type CoverageNotice,
  type TrialRecord,
  type TrialsSnapshot,
} from '../../lib/trials';

/**
 * 临床试验 —— what the registries say, and when we copied it.
 *
 * THE THREE SENTENCES THIS SCREEN EXISTS TO CARRY, and none of them is
 * a decoration that can be moved below the fold:
 *
 *  1. 拉取于 <日期>. The list is a cache filled by a host cron, not a
 *     live query — the API deliberately never calls a registry inside a
 *     patient's request, because a hung overseas fetch from a mainland
 *     VPS is a spinner on their screen. An undated copy of a registry
 *     is a present-tense claim nobody checked, so when the snapshot
 *     carries no readable timestamp this screen shows no list at all.
 *  2. 不含仅在国内登记的试验，国内请查 chinadrugtrials.org.cn. Printed
 *     when it is true of the list on screen; replaced — not dropped —
 *     by a truer sentence when it is not. lib/trials.ts owns which.
 *  3. 是否参加请与主诊医生商量.
 *
 * WHAT IT IS NOT ALLOWED TO SAY. No eligibility («你可能符合»), no
 * results, and no status word we invented. A card's chip is
 * `status_zh` — our own fixed mapping, made once on the server — or
 * the registry's English if we have no mapping for it. The corpus
 * snapshot this replaces machine-translated `Recruiting` into「招聘」;
 * that is the standing example of why nothing here guesses.
 *
 * WHO IS READING. Someone on a mid-range Android inside WeChat's
 * in-app browser, with weak grip and limited arm elevation. Every
 * control here is a real 48pt box — no `compact` buttons — because
 * react-native-web does not read `hitSlop`, so on the export that ships
 * the drawn box is the whole target (see Button.tsx). Nothing is an
 * image, so the browser's own zoom and a screen reader both work on it,
 * and the two strings worth pasting into a message to a doctor — the
 * registry title and the NCT number — are `selectable`.
 *
 * Every string, every grouping decision and every failure sentence
 * lives in lib/trials.ts, where they are asserted without a renderer.
 */

const TrialCard = ({ trial }: { trial: TrialRecord }) => {
  const phase = trialPhaseLabel(trial.phase);
  const updatedOn = readRegistryDay(trial.sourceUpdatedAt);
  const registry = TRIAL_SOURCE_NAMES[trial.source];

  return (
    <View style={styles.card}>
      <View style={styles.chipRow}>
        <View style={styles.statusChip}>
          <Text style={styles.statusChipText}>{trialStatusLabel(trial)}</Text>
        </View>
        {/* A fact off the registry's location list, not a judgement
            about this reader: `hasChinaSite` matches the literal
            "China" and nothing else. It is here because it is the one
            thing on the card that changes whether the rest is worth
            reading for someone in mainland China. */}
        {hasChinaSite(trial) ? (
          <View style={styles.siteChip}>
            <Text style={styles.siteChipText}>注册库列有中国站点</Text>
          </View>
        ) : null}
      </View>

      {/* Verbatim, and selectable: registry titles are English, and the
          useful thing a patient can do with one is paste it into a
          search or into a message to their neurologist. */}
      <Text style={styles.cardTitle} selectable>
        {trial.title}
      </Text>

      <View style={styles.factGrid}>
        <Fact label="登记号" value={trial.sourceId} selectable />
        <Fact label="期别" value={phase ?? '注册库未标注'} />
        <Fact label="申办方" value={trial.sponsor ?? '注册库未标注'} />
        <Fact
          label="试验地点"
          // The registry's own spelling, untranslated. A table of
          // country names would be 200 guesses maintained by hand, and
          // this page's whole stance is that a guess is worse than the
          // source's word.
          value={trial.countries.length > 0 ? trial.countries.join('、') : '注册库未标注'}
        />
        <Fact label="注册库" value={registry} />
        <Fact
          label="注册库更新于"
          // Null here means the day did not arrive as a calendar day we
          // could read — never「没更新过」. See readRegistryDay.
          value={updatedOn ?? '注册库未提供'}
        />
      </View>

      <Button
        label="打开注册库原始记录"
        variant="tinted"
        fullWidth
        trailingIcon="arrow-up-right-from-square"
        accessibilityLabel={`在${registry}上打开 ${trial.sourceId} 的原始记录`}
        accessibilityHint="会离开本应用，在浏览器里打开注册库页面"
        // `openURL` without a `canOpenURL` guard: the client already
        // refused anything that is not http(s) (lib/trials-api.ts), and
        // canOpenURL answers false on web for links that work.
        onPress={() => {
          void Linking.openURL(trial.url);
        }}
      />
    </View>
  );
};

const Fact = ({
  label,
  value,
  selectable,
}: {
  label: string;
  value: string;
  selectable?: boolean;
}) => (
  <View style={styles.fact}>
    <Text style={styles.factLabel}>{label}</Text>
    <Text style={styles.factValue} selectable={selectable}>
      {value}
    </Text>
  </View>
);

const Notice = ({ notice }: { notice: CoverageNotice }) => (
  <View style={[styles.notice, notice.tone === 'warn' ? styles.noticeWarn : null]}>
    {notice.tone === 'warn' ? (
      <Icon name="triangle-exclamation" size={16} color={COLOR.warn} />
    ) : null}
    <Text style={[styles.noticeText, notice.tone === 'warn' ? styles.noticeTextWarn : null]}>
      {notice.text}
    </Text>
  </View>
);

const TrialsScreen = () => {
  const [snapshot, setSnapshot] = useState<TrialsSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Per-group override of `spec.initiallyExpanded`. Absent means the
   *  spec's own default still stands. */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);
      setSnapshot(await listTrials());
    } catch (error) {
      // Cleared, not kept: a half-failed reload that left the previous
      // snapshot on screen would keep printing its 拉取于 date over a
      // list this screen can no longer vouch for.
      setSnapshot(null);
      setErrorMessage(
        error instanceof ApiError || error instanceof Error
          ? error.message
          : '暂时读不到试验名单，请稍后重试。',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Non-null exactly when this render draws a list — and then it is the
   * day that list is dated. lib/trials.ts owns the rule (see
   * `shownListFetchedOn`) because the sentences above the list are
   * written against it: a date here and no date there would put
   *「下面这份名单…」over an empty screen.
   */
  const fetchedOn = useMemo(() => (snapshot ? shownListFetchedOn(snapshot) : null), [snapshot]);
  const groups = useMemo(() => (snapshot ? groupTrials(snapshot.trials) : []), [snapshot]);
  /**
   * The scope sentence and the disclaimer stand whether or not the
   * fetch worked. A reader who hits the error state is exactly the one
   * who needs to be told that this page never covered the mainland
   * registry and where to go instead — dropping it there would make
   * the sentence a reward for a successful load.
   *
   * With no snapshot there are certainly no mainland records on
   * screen, so the fixed sentence is the true one.
   */
  const coverage = useMemo<CoverageNotice>(
    () =>
      snapshot
        ? describeChinaCoverage(snapshot)
        : { tone: 'plain', text: COVERAGE_NOTE_CTGOV_ONLY },
    [snapshot],
  );
  const staleness = useMemo(() => (snapshot ? describeCtgovStaleness(snapshot) : null), [snapshot]);

  /**
   * Three mutually exclusive outcomes of a successful request, in the
   * order they are checked:
   *
   *  - `isEmpty` — the request worked and returned no trials at all.
   *    `describeEmptyList` says which kind of empty, and it is checked
   *    FIRST because an empty snapshot can still carry a `fetched_at`
   *    from a source block whose records all failed to parse, and
   *    answering that with the undated-list refusal below would blame
   *    the wrong thing.
   *  - `isUndated` — there are trials but not one readable copy time.
   *    That is a bug on our side, and drawing 92 undated studies
   *    through it is the one thing this feature is not allowed to do.
   *  - otherwise the list is drawn, dated.
   */
  const isEmpty = Boolean(snapshot) && groups.length === 0;
  const isUndated = Boolean(snapshot) && groups.length > 0 && !fetchedOn;
  const canShowList = Boolean(fetchedOn);

  // `snapshot` and `errorMessage` are never both set: `load` writes one
  // and clears the other on every path. So the three branches below do
  // not need to re-check for an error, and the error card cannot appear
  // beside a list.

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.safeArea}>
        <ScreenHeader title="临床试验" />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Rides the list, because every sentence in it is about the
              list:「这一页是那一天抄下来的副本」and「要点开原始记录才看
              得到」both need records under them. A snapshot whose rows
              all failed to parse still carries a `fetched_at`, so this
              block used to appear, dated, over the empty state. */}
          {fetchedOn ? (
            <View style={styles.freshness}>
              <Text style={styles.freshnessValue}>{`拉取于 ${fetchedOn}`}</Text>
              <Text style={styles.freshnessNote}>
                这一页是我们在那一天从注册库抄下来的副本，不是打开页面时的实时查询。之后注册库上的改动，要点开原始记录才看得到。
              </Text>
              {/* Sits with the date because that is the only thing it
                  can change. It re-reads the copy on our server — the
                  one the host cron writes — and does NOT go out to the
                  registry, so the hint says so rather than letting the
                  word「重新读取」imply a live lookup. */}
              <Button
                label="重新读取"
                variant="tinted"
                busy={isLoading}
                accessibilityHint="重新读取服务器上已经抓好的副本，不会现在去访问注册库"
                onPress={() => void load()}
              />
            </View>
          ) : null}

          {staleness ? <Notice notice={staleness} /> : null}

          <Text style={styles.intro}>{TRIALS_INTRO}</Text>

          <Notice notice={coverage} />

          {/* The notice tells the reader where the rest of the trials
              are; this is the door. It is always here, not only when
              the scraper is down, because even a working scrape of
              chinadrugtrials.org.cn is page-scraping a site with no
              public API —「可能不完整」is the permanent condition of
              that half, so「去原站看」is permanently the right advice.
              http, not https: that is the scheme the platform serves. */}
          <Button
            label="打开国内登记平台"
            variant="tinted"
            fullWidth
            trailingIcon="arrow-up-right-from-square"
            accessibilityLabel={`打开${CHINA_REGISTRY_NAME}`}
            accessibilityHint="会离开本应用，在浏览器里打开该平台首页"
            onPress={() => {
              void Linking.openURL(CHINA_REGISTRY_URL);
            }}
            style={styles.coverageLink}
          />

          <Text style={styles.disclaimer}>{TRIALS_DISCLAIMER}</Text>

          {/* Only while there is nothing to show. A reload with a list
              already on screen announces itself through 重新读取's own
              spinner instead of pushing the list down. */}
          {isLoading && !snapshot ? (
            <View style={styles.stateCard}>
              <View style={styles.loadingRow}>
                <ActivityIndicator />
                <Text style={styles.stateTitle}>正在读取已抓取的名单</Text>
              </View>
              <Text style={styles.stateText}>
                读的是服务器上已经抓好的副本，不会现去访问注册库，所以通常很快。
              </Text>
            </View>
          ) : null}

          {errorMessage ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>暂时读不到试验名单</Text>
              <Text style={styles.stateText}>{errorMessage}</Text>
              <Text style={styles.stateText}>
                这一页读不到不代表注册库上没有试验。可以稍后再打开，或直接到 clinicaltrials.gov
                上查询。
              </Text>
              <Button label="重新加载" variant="tinted" onPress={() => void load()} />
            </View>
          ) : null}

          {isUndated ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>这份名单没有抓取时间，暂不显示</Text>
              <Text style={styles.stateText}>
                名单本身读回来了，但没有一条记录带着可读的抓取时间，没法说明它有多新。一份不知道什么时候抄的试验名单会被当成当前状态来读，所以这里宁可不显示。
              </Text>
              <Button label="重新加载" variant="tinted" onPress={() => void load()} />
            </View>
          ) : null}

          {isEmpty && snapshot ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateTitle}>这次没有取到任何记录</Text>
              <Text style={styles.stateText}>{describeEmptyList(snapshot)}</Text>
              <Button label="重新加载" variant="tinted" onPress={() => void load()} />
            </View>
          ) : null}

          {canShowList
            ? groups.map((group) => {
                const isOpen = expanded[group.spec.key] ?? group.spec.initiallyExpanded;
                return (
                  <View key={group.spec.key} style={styles.group}>
                    <Pressable
                      style={styles.groupHeader}
                      onPress={() =>
                        setExpanded((current) => ({ ...current, [group.spec.key]: !isOpen }))
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`${group.spec.title}，${group.trials.length} 项`}
                      accessibilityHint={isOpen ? '收起这一组' : '展开这一组'}
                      // react-native-web 0.20 drops accessibilityState;
                      // aria-expanded is what actually reaches the
                      // screen reader on the export that ships.
                      accessibilityState={{ expanded: isOpen }}
                      aria-expanded={isOpen}
                    >
                      <Text style={styles.groupTitle} accessibilityRole="header">
                        {group.spec.title}
                      </Text>
                      <View style={styles.groupCount}>
                        <Text style={styles.groupCountText}>{`${group.trials.length} 项`}</Text>
                      </View>
                      <Icon
                        name={isOpen ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={COLOR.inkSoft}
                      />
                    </Pressable>

                    {/* Only 其他状态 carries one today: its title says
                        what the group is not, and the rows inside it can
                        include studies that are still enrolling. Outside
                        the `isOpen` branch on purpose — a reader who
                        collapsed the group is exactly the one who needs
                        to know what they just put away. */}
                    {group.spec.note ? (
                      <Text style={styles.groupNote}>{group.spec.note}</Text>
                    ) : null}

                    {isOpen
                      ? group.trials.map((trial) => (
                          <TrialCard key={`${trial.source}:${trial.sourceId}`} trial={trial} />
                        ))
                      : null}
                  </View>
                );
              })
            : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
};

export default TrialsScreen;
