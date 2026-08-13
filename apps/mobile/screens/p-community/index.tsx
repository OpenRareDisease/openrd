import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenHeader from '../common/ScreenHeader';
import SegmentedControl from '../common/SegmentedControl';
import ToggleSwitch from '../common/ToggleSwitch';
import Icon from '../common/Icon';
import StoryCard from './StoryCard';
import ReadOriginalSheet from './ReadOriginalSheet';
import styles from './styles';
import { COLOR } from '../../lib/design';
import {
  COMMUNITY_CAVEAT,
  COMMUNITY_INTRO,
  STORY_COUNT,
  STORY_HOOKS,
  STORY_THEMES,
  storiesForTheme,
  type Story,
  type StoryThemeId,
} from '../../lib/community-stories-content';
import Button from '../common/Button';
import {
  areStoryHooksEnabled,
  resetStoryHookDismissals,
  setStoryHooksEnabled,
} from './story-hooks';

/**
 * 病友经验 — the peer-experience shelf.
 *
 * This screen used to be seven lines of `UnavailableScreen`. The reason
 * it starts here rather than with a forum is in the header of
 * lib/community-stories-content.ts: these 21 narratives are already
 * published and already bylined, so a shelf built from them needs no
 * moderation queue, no posting surface, and collects no new personal
 * information from anybody.
 *
 * Three things on this page are load-bearing and should survive edits:
 *
 *  1. **The caveat sits above the stories, not below them.** It is the
 *     sentence that keeps twenty-one lives from being read as a
 *     prognosis, and it is quoted from a patient rather than asserted
 *     by us because it is more credible in his words.
 *  2. **The serial stays in order.** `storiesForTheme` sorts serial
 *     parts ascending inside an otherwise newest-first shelf, and the
 *     cards are visually joined. Part 3 opens on a father already dying
 *     and part 4 on the morning he dies — a feed-shaped default would
 *     present that memoir backwards.
 *  3. **Contextual stories are off, and the switch says what it does
 *     before it is touched.** The trigger list is printed under the
 *     switch in the off state, so a patient can see exactly what would
 *     start happening rather than finding out by having it happen.
 */
const CommunityScreen = () => {
  const [themeId, setThemeId] = useState<StoryThemeId>(STORY_THEMES[0].id);
  const [readingOriginal, setReadingOriginal] = useState<Story | null>(null);
  const [hooksEnabled, setHooksEnabled] = useState(false);

  useEffect(() => {
    let active = true;
    void areStoryHooksEnabled().then((enabled) => {
      if (active) setHooksEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  const theme = useMemo(
    () => STORY_THEMES.find((candidate) => candidate.id === themeId) ?? STORY_THEMES[0],
    [themeId],
  );
  const stories = useMemo(() => storiesForTheme(theme.id), [theme.id]);

  const segments = useMemo(
    () => STORY_THEMES.map((candidate) => ({ key: candidate.id, label: candidate.title })),
    [],
  );

  const handleToggleHooks = useCallback((next: boolean) => {
    // Optimistic: the switch answers the finger immediately and the
    // write follows. A failed write reads as false next launch, which
    // is the safe direction — see story-hooks.ts.
    setHooksEnabled(next);
    void setStoryHooksEnabled(next);
  }, []);

  const handleResetDismissals = useCallback(() => {
    void resetStoryHookDismissals();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.safeArea}>
        <ScreenHeader title="病友经验" />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>{COMMUNITY_INTRO}</Text>
          <Text style={styles.caveat}>{COMMUNITY_CAVEAT}</Text>

          <SegmentedControl
            segments={segments}
            value={theme.id}
            onChange={(key) => setThemeId(key as StoryThemeId)}
            accessibilityLabel="经验分类"
            style={styles.themeControl}
          />

          <Text style={styles.themeBlurb}>{theme.blurb}</Text>

          <Text style={styles.countLine}>
            {theme.title + ' · ' + stories.length + ' 篇（共 ' + STORY_COUNT + ' 篇）'}
          </Text>

          {stories.length === 0 ? (
            <Text style={styles.empty}>这一栏暂时还没有故事。</Text>
          ) : (
            stories.map((story, index) => {
              const previous = stories[index - 1];
              const continuesSerial = Boolean(
                story.serial &&
                  previous?.serial &&
                  previous.serial.name === story.serial.name &&
                  previous.serial.part === story.serial.part - 1,
              );
              return (
                <StoryCard
                  key={story.id}
                  story={story}
                  continuesSerial={continuesSerial}
                  onReadOriginal={setReadingOriginal}
                />
              );
            })
          )}

          {/* ---------------------------------------------------------
              The contextual-story switch.

              It lives here, on the shelf, and nowhere else. Putting it
              in Settings would mean a patient discovers the feature by
              having it fire at them; putting it in the flow that
              triggers it would mean asking「要不要看别人的故事」in the
              same moment they recorded a fall, which is the prompt this
              whole design exists to avoid sending.
              --------------------------------------------------------- */}
          <View style={styles.settingsBlock}>
            <Text style={styles.settingsTitle} accessibilityRole="header">
              在记录的时候顺带看到这些故事
            </Text>
            <Text style={styles.settingsBody}>
              默认关闭。打开之后，只有在下面这几种记录之后，才会出现一张可以一键关掉的卡片。它不判断你的记录，也不代表任何变化；任何一张关掉之后就不会再出现。
            </Text>

            <View style={styles.settingsRow}>
              <Text style={styles.settingsRowLabel}>记录时显示病友故事</Text>
              <ToggleSwitch
                isEnabled={hooksEnabled}
                onToggle={handleToggleHooks}
                accessibilityLabel="记录时显示病友故事"
                accessibilityHint="默认关闭。打开后，在记录跌倒、把爬楼测试标记为今天做不了、或第一次记录踝足矫形器之后，会出现一张可以一键关掉的病友故事卡片。"
              />
            </View>

            <View style={styles.triggerList}>
              {STORY_HOOKS.map((hook) => (
                <View key={hook.id} style={styles.triggerItem}>
                  <Icon name="chevron-right" size={12} color={COLOR.inkFaint} />
                  <Text style={styles.triggerText}>{hook.trigger}</Text>
                </View>
              ))}
            </View>

            {/* The only caller of resetStoryHookDismissals, and the
                reason dismissal is allowed to be permanent: without a
                way back,「一键关掉」would be irreversible, and a patient
                who closed a card on a bad day could never undo it. It
                appears only while the feature is on, because it has
                nothing to undo otherwise. */}
            {hooksEnabled ? (
              <Button
                label="让关掉过的卡片重新出现"
                variant="plain"
                onPress={handleResetDismissals}
              />
            ) : null}
          </View>
        </ScrollView>

        <ReadOriginalSheet story={readingOriginal} onClose={() => setReadingOriginal(null)} />
      </View>
    </SafeAreaView>
  );
};

export default CommunityScreen;
