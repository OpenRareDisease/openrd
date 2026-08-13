/**
 * Whether a peer story may appear beside something a patient just
 * recorded — and, by default, no.
 *
 * The failure this exists to prevent
 * ----------------------------------
 * The obvious version of this feature is: patient logs a fall, app
 * shows a story about falling. It reads as empathy in a design review
 * and as a diagnosis on a phone. The patient did not ask a question;
 * they entered a measurement, and the app answered with a stranger's
 * decline. There is no wording that undoes that, because the
 * *appearance* of the card is the message: something I typed made the
 * app decide I needed comforting. In a disease whose defining fear is
 * "am I getting worse", an unbidden story after a bad entry is a
 * progression alert wearing empathy.
 *
 * So the rules, in the order they are enforced below:
 *
 *  1. **Off unless explicitly turned on.** Not "off until we see how
 *     it goes", not "on for new users". `resolveStoryHook` returns
 *     null when the preference has never been written, when it fails
 *     to parse, and when reading storage throws. There is no code path
 *     in this file that shows a hook to someone who did not switch it
 *     on. The tests below the belt-line assert each of those three.
 *  2. **One tap makes it stop.** Dismissal is per-context and
 *     persistent. A hook the patient dismissed after their first fall
 *     must not return after their second — otherwise "dismiss" means
 *     "snooze until the next bad day", which is worse than never
 *     offering it, because now the app looks like it is keeping count.
 *  3. **Dismissing one does not turn off the others**, and turning the
 *     whole thing off does not erase which ones were dismissed. Those
 *     are different decisions and a patient may make them separately.
 *
 * Why AsyncStorage and not the SecureStore-backed session store: this
 * is a display preference, not patient data. Nothing here records that
 * a fall happened, what was recorded, or when — only which cards this
 * device has been told to stop drawing. Deliberately: a store of
 * "which decline prompts fired" would be a progression log by another
 * name, and it would then need to be in PATIENT_SCOPED_SECURE_KEYS and
 * cleared at logout. It is cheaper and safer not to hold it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  STORY_HOOKS,
  getExcerpt,
  getHook,
  getStory,
  type StoryHookId,
} from '../../lib/community-stories-content';
import type { Story, StoryExcerpt, StoryHook } from '../../lib/community-stories-content';

/** Master switch. Absent means off. */
export const STORY_HOOKS_ENABLED_KEY = 'openrd.community.storyHooks.enabled';

/** Per-context dismissals, as a JSON array of hook ids. */
export const STORY_HOOKS_DISMISSED_KEY = 'openrd.community.storyHooks.dismissed';

/**
 * Read the master switch.
 *
 * Every non-'true' outcome — missing key, junk value, storage error —
 * resolves to false. A preference this consequential does not get a
 * benefit of the doubt: if we cannot prove the patient turned it on,
 * they did not turn it on.
 */
export const areStoryHooksEnabled = async (): Promise<boolean> => {
  try {
    return (await AsyncStorage.getItem(STORY_HOOKS_ENABLED_KEY)) === 'true';
  } catch {
    return false;
  }
};

export const setStoryHooksEnabled = async (enabled: boolean): Promise<void> => {
  try {
    await AsyncStorage.setItem(STORY_HOOKS_ENABLED_KEY, enabled ? 'true' : 'false');
  } catch {
    // A preference that failed to save stays off on the next read,
    // which is the safe direction. Swallowed rather than surfaced:
    // there is nothing the patient could do about it and nothing is
    // lost by the failure.
  }
};

const readDismissed = async (): Promise<StoryHookId[]> => {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(STORY_HOOKS_DISMISSED_KEY);
  } catch {
    // Unreadable dismissals must not resurrect a dismissed card, and
    // the only way to guarantee that here is to treat the read failure
    // as "everything is dismissed" — which `resolveStoryHook` gets for
    // free, because it also refuses to show anything when the master
    // switch cannot be read.
    return STORY_HOOKS.map((hook) => hook.id);
  }
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const known = new Set(STORY_HOOKS.map((hook) => hook.id));
    return parsed.filter(
      (id): id is StoryHookId => typeof id === 'string' && known.has(id as StoryHookId),
    );
  } catch {
    return [];
  }
};

export const isStoryHookDismissed = async (id: StoryHookId): Promise<boolean> =>
  (await readDismissed()).includes(id);

/**
 * The one tap. Persistent and per-context by design — see rule 2.
 */
export const dismissStoryHook = async (id: StoryHookId): Promise<void> => {
  const current = await readDismissed();
  if (current.includes(id)) return;
  try {
    await AsyncStorage.setItem(STORY_HOOKS_DISMISSED_KEY, JSON.stringify([...current, id]));
  } catch {
    // Same reasoning as above, with one difference that matters: a
    // dismissal that failed to persist means the card can come back.
    // That is why the component also hides it for the rest of the
    // session in local state rather than relying on this write.
  }
};

/** Only reachable from the community screen's own settings row. */
export const resetStoryHookDismissals = async (): Promise<void> => {
  try {
    await AsyncStorage.removeItem(STORY_HOOKS_DISMISSED_KEY);
  } catch {
    // Nothing to do; the dismissals simply remain.
  }
};

export type ResolvedStoryHook = {
  hook: StoryHook;
  story: Story;
  excerpt: StoryExcerpt;
};

/**
 * What a data-entry screen calls. Returns null far more often than not,
 * and that is the point.
 *
 * Null when: hooks are off (the default), this context was dismissed,
 * the hook id is unknown, or the hook points at a story or excerpt
 * that no longer exists. The last two are not defensive padding — the
 * content file is edited by hand, and a hook whose excerpt was renamed
 * must render nothing rather than an empty quotation attributed to a
 * named patient.
 */
export const resolveStoryHook = async (id: StoryHookId): Promise<ResolvedStoryHook | null> => {
  if (!(await areStoryHooksEnabled())) return null;
  if (await isStoryHookDismissed(id)) return null;

  const hook = getHook(id);
  if (!hook) return null;

  const story = getStory(hook.storyId);
  if (!story) return null;

  const excerpt = getExcerpt(story, hook.excerptId);
  if (!excerpt) return null;

  return { hook, story, excerpt };
};
