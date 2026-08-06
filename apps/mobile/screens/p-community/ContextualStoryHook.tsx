import { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import Icon from '../common/Icon';
import Button from '../common/Button';
import styles from './styles';
import { COLOR, INTERACTION } from '../../lib/design';
import type { StoryHookId } from '../../lib/community-stories-content';
import { dismissStoryHook, resolveStoryHook, type ResolvedStoryHook } from './story-hooks';

/**
 * A peer story offered beside something the patient just recorded.
 *
 * NOT MOUNTED ANYWHERE YET. The three trigger points live in
 * screens/p-data_entry, which this lane does not own, so the component
 * and its preference are finished and tested but nothing renders them
 * in the app today. Wiring is one line at each site:
 *
 *   <ContextualStoryHook hookId="fall-logged" />
 *   <ContextualStoryHook hookId="stair-test-cannot" />
 *   <ContextualStoryHook hookId="first-afo" />
 *
 * placed after the entry is saved, not beside the input. It renders
 * **nothing at all** unless the patient has switched contextual stories
 * on from the community screen — which nobody has by default. See
 * story-hooks.ts for why that default is not negotiable.
 *
 * What this component does NOT do, on purpose:
 *
 *  - It never renders a spinner, a skeleton or a placeholder while it
 *    is deciding. The decision is a storage read, and the honest
 *    rendering of "probably nothing" is nothing. A 200ms grey box
 *    appearing after a fall entry and then vanishing is still the app
 *    reacting visibly to a decline.
 *  - It never says anything about what was recorded, and never uses a
 *    word from the progression vocabulary (加重, 下降, 变差, 注意).
 *    The lede's job is to state, out loud, that the card is not a
 *    judgement — a patient cannot be expected to infer the absence of
 *    a judgement from a card that appeared unbidden.
 *  - It has no "remind me later". Dismissal is final for that context,
 *    because a card that comes back on the next bad day means the app
 *    is keeping count.
 *
 * Dismissal is optimistic: local state hides it immediately and the
 * persistent write follows. If the write fails the card stays gone for
 * this session, which is the direction that cannot hurt anyone.
 */
interface ContextualStoryHookProps {
  hookId: StoryHookId;
  /** Fires after a dismissal so a parent can collapse its own spacing. */
  onDismissed?: () => void;
}

const ContextualStoryHook = ({ hookId, onDismissed }: ContextualStoryHookProps) => {
  const router = useRouter();
  const [resolved, setResolved] = useState<ResolvedStoryHook | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    void resolveStoryHook(hookId).then((next) => {
      if (active) setResolved(next);
    });
    return () => {
      active = false;
    };
  }, [hookId]);

  if (!resolved || dismissed) return null;

  const { hook, story, excerpt } = resolved;

  const handleDismiss = () => {
    setDismissed(true);
    onDismissed?.();
    void dismissStoryHook(hook.id);
  };

  return (
    <View style={styles.hookCard} accessibilityLabel={hook.title}>
      <View style={styles.hookHeader}>
        <View style={styles.hookHeaderText}>
          <Text style={styles.hookTitle} accessibilityRole="header">
            {hook.title}
          </Text>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="不再显示这类内容"
          accessibilityHint="关掉这张卡片，之后记录同类内容时不会再出现"
          activeOpacity={INTERACTION.pressOpacity}
          onPress={handleDismiss}
          style={styles.hookDismiss}
        >
          <Icon name="xmark" size={16} color={COLOR.inkMuted} />
        </TouchableOpacity>
      </View>

      <Text style={styles.hookLede}>{hook.lede}</Text>

      <View style={styles.quote}>
        <View style={styles.quoteRule} />
        <View style={{ flex: 1 }}>
          <Text style={styles.quoteText} selectable>
            {excerpt.text}
          </Text>
          <Text style={styles.quoteAttribution}>
            {'—— ' + story.origin.byline + '《' + story.title + '》'}
          </Text>
        </View>
      </View>

      <View style={styles.hookFooter}>
        <Button
          label="去病友经验"
          variant="plain"
          trailingIcon="chevron-right"
          onPress={() => router.push('/p-community')}
        />
      </View>
    </View>
  );
};

export default ContextualStoryHook;
