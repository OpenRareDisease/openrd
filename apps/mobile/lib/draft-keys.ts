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

/** Data-entry drafts, one per form section. */
export const DATA_ENTRY_DRAFT_KEYS = {
  entryMode: 'openrd.dataEntry.entryMode',
  followup: 'openrd.dataEntry.followup',
  event: 'openrd.dataEntry.event',
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
  VISIT_PREP_NOTE_KEY,
  ...Object.values(DATA_ENTRY_DRAFT_KEYS),
];
