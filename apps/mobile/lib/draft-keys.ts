/**
 * Storage keys for patient-scoped drafts.
 *
 * These live here rather than next to the screens that write them so
 * that logout can clear them without re-declaring the strings. The
 * first version of the logout fix did re-declare them and got one
 * wrong (`.formDraft` vs `.draft`) — a silent miss, because clearing
 * a key that was never written looks exactly like success.
 *
 * Why it matters that these are cleared: the profile draft holds
 * name, date of birth, phone, email, family history and D4Z4 counts;
 * the entry drafts hold whatever the patient last typed. All of it
 * sits in SecureStore, which `AsyncStorage.multiRemove` cannot reach.
 * FSHD is autosomal dominant, so several affected members of one
 * family sharing a device is the ordinary case for this cohort — a
 * leftover draft means the next person to open「编辑档案」finds
 * someone else's details pre-filled and one tap from being saved as
 * their own.
 */

/** Register/edit profile form draft. */
export const PROFILE_FORM_DRAFT_KEY = 'openrd.registerProfile.draft';

/**
 * Interrupted-registration draft: phone number + identity, written on
 * every keystroke of the 注册 form. Passwords, the OTP code and the OTP
 * request id are stripped before it is persisted, so no secret is in
 * here — but a mobile number is 个人信息 on its own, and this key used
 * to be declared privately inside p-login_register, which meant it was
 * in neither of the two lists anything sweeps.
 */
export const REGISTER_FORM_DRAFT_KEY = 'openrd.register.draft';

/**
 * How long an unfinished registration may keep the phone number on the
 * device.
 *
 * The draft used to be cleared in exactly one place — after a
 * *successful* register — so an abandoned attempt kept the number for
 * ever: nobody is logged in on that device, so logout never runs and
 * the key sweep below never fires. On the shared browser this cohort
 * actually uses (FSHD is autosomal dominant; several affected members
 * of one family on one device is the ordinary case), family member A
 * types 13800138000, never receives the SMS, gives up — and days later
 * B taps 注册 and finds A's number pre-filled.
 *
 * 24h is the honest span of「I stepped away to read the SMS and came
 * back」. Past that the restore is no longer serving the person who
 * typed it, so the draft is discarded on read rather than shown.
 */
export const REGISTER_FORM_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Data-entry drafts, one per form section. */
export const DATA_ENTRY_DRAFT_KEYS = {
  entryMode: 'openrd.dataEntry.entryMode',
  followup: 'openrd.dataEntry.followup',
  event: 'openrd.dataEntry.event',
  /**
   * Which 在家计时测试 rows a half-finished save already left on the
   * server, per test — see PendingTimedTestSave in
   * screens/p-data_entry/TimedTestForm.tsx.
   *
   * Not a draft: a draft is what the patient typed and has not sent,
   * and closing the card is how they throw one away. This is the
   * opposite — rows that ARE sent, which nothing on the device can
   * un-write, because `addFunctionTest` is a bare INSERT with no unique
   * constraint. It is in this registry for both of the reasons the
   * drafts are. It must survive navigating off the screen, or the card
   * reopens blank and enabled with no visit id and posts the stored
   * rows a second time. And it must not survive a sign-out, because it
   * names one person's visit id and the answers they gave.
   */
  timedPendingSaves: 'openrd.dataEntry.timedPendingSaves',
} as const;

/**
 * 门诊准备 note drafted on the clinical-passport screen.
 *
 * Not a form draft, but it belongs in the same list for the same
 * reason: it is an AI summary of one patient's measurements, reports
 * and recent changes, and it survives across app launches so the note
 * generated at home is still there in the waiting room. On a shared
 * family device that persistence is exactly what makes clearing it at
 * logout non-optional.
 */
export const VISIT_PREP_NOTE_KEY = 'openrd.clinicalPassport.visitPrep';

/**
 * Every draft key logout must clear, in the SecureStore-backed store.
 * Adding a draft anywhere in the app means adding it here.
 */
export const PATIENT_SCOPED_SECURE_KEYS: string[] = [
  PROFILE_FORM_DRAFT_KEY,
  // Listed even though the ordinary abandonment path never reaches
  // logout: a registration that DID complete, followed by a logout,
  // must not leave the number behind either, and the registry
  // invariant this file's header states is「every draft key is in
  // here」, not「every key logout happens to be able to reach」.
  // The time bound above is what covers the never-logged-in case.
  REGISTER_FORM_DRAFT_KEY,
  VISIT_PREP_NOTE_KEY,
  ...Object.values(DATA_ENTRY_DRAFT_KEYS),
];

/**
 * 孕期时间线's due date.
 *
 * Device-local by design and never sent to the server — but that is an
 * argument for not uploading it, not for leaving it behind on logout.
 * FSHD is autosomal dominant, so several affected members of one family
 * sharing one phone is the ordinary case here (the same reasoning
 * already written above for the registration draft). A due date that
 * survives logout means the next family member to open 孕期时间线 sees a
 * live week number computed from someone else's pregnancy.
 *
 * It lives here rather than beside its writer because that is exactly
 * how it came to be swept by nothing: a key declared next to the screen
 * that sets it is a key nobody reviewing the sweep list ever sees.
 * lib/api.ts folds this into PATIENT_SCOPED_CACHE_KEYS.
 */
export const PREGNANCY_DUE_DATE_KEY = 'openrd.pregnancy.dueDate';
