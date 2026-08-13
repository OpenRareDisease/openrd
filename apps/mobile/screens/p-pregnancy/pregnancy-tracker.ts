/**
 * The optional due date — the only piece of state this feature holds.
 *
 * What it is
 * ----------
 * One string, 'YYYY-MM-DD', in AsyncStorage on this device. Absent
 * means the tracker is off, which is the default and the state every
 * failure resolves to.
 *
 * Why it never leaves the device
 * ------------------------------
 * A due date is a statement that the person is pregnant, which is
 * 医疗健康类敏感个人信息 under PIPL Art. 28 and therefore needs 单独同意
 * under Art. 29 — consent for this purpose, obtained separately, not
 * inherited from the profile-wide consent given at registration, which
 * said nothing about pregnancy. This module deliberately imports
 * nothing from lib/api: there is no request that could carry the value,
 * so it cannot reach the clinical passport, a share link, the AI
 * question payload, or the audit log by any later accident.
 * pregnancy-tracker.test.ts reads this file's own source and fails if
 * an import of the API client or a bare fetch ever appears in it.
 *
 * Three rules, in the order they matter
 * ------------------------------------
 *  1. **Never inferred.** Nothing writes this key except
 *     `saveDueDate`, and `saveDueDate` is called from exactly one
 *     place: the button under the consent checkbox. No screen derives
 *     pregnancy from an age, a symptom entry, a report, a search, or
 *     the fact that someone opened this page. Opening 孕期时间线 writes
 *     nothing at all.
 *  2. **One tap removes it.** `clearDueDate` is the whole withdrawal:
 *     no confirmation dialog, no reason, no second screen. The person
 *     most likely to press it is someone whose pregnancy has just
 *     ended, possibly badly, and every extra step is a step taken
 *     while a checklist is still on screen. A date-keyed reminder that
 *     survives a miscarriage is the way this feature hurts someone,
 *     and one tap is the budget for preventing it.
 *  3. **Nothing is recorded about the removal.** There is no
 *     「was tracking, stopped on 3 May」 flag — that record would be a
 *     pregnancy-outcome log by another name, would be exactly the kind
 *     of thing Art. 28 lists (discrimination in 就业、保险、婚育), and
 *     would need somewhere to be deleted from in its turn. The cost is
 *     that the neutral 「可以填一个预产期」 control reappears on a later
 *     visit. That is a control on a page the reader chose to open, not
 *     a notification; it is the cheaper of the two harms and it is
 *     chosen deliberately.
 *
 * Why AsyncStorage and not the SecureStore-backed session store: the
 * session store is swept by the patient-scoped key registry in
 * lib/api.ts on logout, and adding a key there is outside this lane.
 * The trade is stated honestly rather than papered over — see the
 * handoff note. In the meantime the value is device-local, is never
 * sent anywhere, and the page offers the one-tap delete on every
 * visit, which is the control that actually matters here.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { PREGNANCY_DUE_DATE_KEY } from '../../lib/draft-keys';
import { isPlausibleDueDate } from '../../lib/pregnancy-timeline-content';

/**
 * The one key. Namespaced like the other device-local preferences
 * (see screens/p-community/story-hooks.ts) so it is greppable.
 */
/** Re-exported for this module's existing callers. Owned by
 *  lib/draft-keys.ts, which is where the logout sweep list can see it. */
export { PREGNANCY_DUE_DATE_KEY };

/**
 * Read the stored due date, or null.
 *
 * Every non-answer resolves to null: missing key, junk value, a date
 * that is no longer plausible (it passed while the app was closed), or
 * a storage error. A stale date must not survive into a rendered week
 * number, so the validity check happens on read as well as on write —
 * the clock moves between them, and that is precisely the case that
 * matters.
 */
export const readDueDate = async (today: Date): Promise<string | null> => {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(PREGNANCY_DUE_DATE_KEY);
  } catch {
    // Unreadable storage means the page shows no date-keyed content.
    // The safe direction: silence, never a guessed week.
    return null;
  }
  if (!raw) return null;
  return isPlausibleDueDate(raw, today) ? raw : null;
};

/**
 * Why this is three states and not a boolean.
 *
 * The two ways a save fails need two different sentences. A single
 * `false` made the screen answer 「这个日期看起来不像预产期」 to a
 * browser whose storage was full or blocked — private-mode
 * localStorage and the WeChat webview both do this — so a reader who
 * had typed a perfectly good date was told to reformat it, retried,
 * and got the identical sentence every time with nothing on screen
 * saying the device had stored nothing.
 */
export type SaveDueDateResult = 'saved' | 'invalid' | 'storage-error';

/**
 * Store a due date.
 *
 * Refuses anything that is not a plausible due date rather than
 * storing it and letting the reader see an empty page — an implausible
 * value is almost always a typo in the year, and the honest response
 * is to say so at the input. A storage failure is NOT that, and says
 * so: see SaveDueDateResult.
 */
export const saveDueDate = async (value: string, today: Date): Promise<SaveDueDateResult> => {
  if (!isPlausibleDueDate(value, today)) return 'invalid';
  try {
    await AsyncStorage.setItem(PREGNANCY_DUE_DATE_KEY, value.trim());
    return 'saved';
  } catch {
    return 'storage-error';
  }
};

/**
 * The one tap.
 *
 * Resolves even when the write fails, because the caller must be free
 * to clear its own state and stop rendering immediately regardless.
 * Returns false only so a caller could report a failed erase; it must
 * never gate the screen's own hiding of the content on it — a person
 * who pressed this has stopped consenting whether or not the browser's
 * storage cooperated.
 */
export const clearDueDate = async (): Promise<boolean> => {
  try {
    await AsyncStorage.removeItem(PREGNANCY_DUE_DATE_KEY);
    return true;
  } catch {
    return false;
  }
};
