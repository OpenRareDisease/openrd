export const ASSISTIVE_DEVICE_OPTIONS = ['AFO', '手杖', '助行器', '轮椅', '无创通气'] as const;

export type AssistiveDeviceOption = (typeof ASSISTIVE_DEVICE_OPTIONS)[number];

/**
 * Mirrors AMBULATION_STATES in the API's profile.constants.ts, which
 * migration 022 turned from a boolean into these three strings and then
 * pinned with a CHECK constraint on baseline_payload. Widening the set
 * means editing both.
 *
 * `unable` is the state the boolean could not hold at all: before 022 a
 * patient who cannot walk had to answer 「需要辅助」, and the Vignos
 * grade-9 sync had nowhere to write what the timeline already said.
 */
export const AMBULATION_STATES = ['independent', 'assisted', 'unable'] as const;

export type AmbulationState = (typeof AMBULATION_STATES)[number];

/** A state, or '' for 「还没答」 — which is not one of the states. */
export type AmbulationChoice = AmbulationState | '';

export const AMBULATION_LABELS: Record<AmbulationState, string> = {
  independent: '可独立行走',
  assisted: '需要辅助',
  unable: '无法行走',
};

export const AMBULATION_OPTIONS: Array<{
  value: AmbulationState;
  label: string;
}> = AMBULATION_STATES.map((value) => ({ value, label: AMBULATION_LABELS[value] }));

const isAmbulationState = (value: unknown): value is AmbulationState =>
  typeof value === 'string' && (AMBULATION_STATES as readonly string[]).includes(value);

const splitCustomAssistiveDevices = (value: string) =>
  value
    .split(/[、，,；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

/**
 * Read a stored `currentStatus.independentlyAmbulatory` into the form.
 *
 * This used to match only `true` / `false`, and after 022 back-filled
 * the column to strings it returned '' for every profile that had ever
 * answered — the radio group rendered blank and the save below wrote
 * the blank back, deleting an answer the patient never touched. Any
 * value we cannot place still becomes '', so the form never shows a
 * selection the patient did not make.
 *
 * The boolean branch is the read-side mirror of the one in the API's
 * profile.schema.ts: it only matters in the window where a handset has
 * this build but the server it talks to has not run 022 yet, and rows
 * on disk are still `true` / `false`. `false → assisted` reproduces the
 * label that patient tapped and asserts nothing more.
 */
export const toAmbulationChoice = (value?: AmbulationState | boolean | null): AmbulationChoice => {
  if (isAmbulationState(value)) {
    return value;
  }
  if (value === true) {
    return 'independent';
  }
  if (value === false) {
    return 'assisted';
  }
  return '';
};

/** '' means the question is unanswered, which is what null says on the
 *  wire. Every real answer — including `unable`, which has no boolean
 *  equivalent — travels as itself. */
export const fromAmbulationChoice = (value: AmbulationChoice): AmbulationState | null =>
  value === '' ? null : value;

/** The label for a stored value, or null when there is nothing to
 *  show. Read-only surfaces (档案, 随访小结) share it so a state added
 *  here cannot go on rendering as 「未填写」 in one of them. */
export const ambulationLabel = (value?: AmbulationState | boolean | null): string | null => {
  const choice = toAmbulationChoice(value);
  return choice === '' ? null : AMBULATION_LABELS[choice];
};

/** True when the patient has told us walking is not unaided — i.e. any
 *  answered state other than `independent`. Used to word hints, never
 *  to pre-fill a record. */
export const isAmbulationLimited = (value?: AmbulationState | boolean | null): boolean => {
  const choice = toAmbulationChoice(value);
  return choice === 'assisted' || choice === 'unable';
};

export const splitAssistiveDevices = (devices?: string[] | null) => {
  const selected: AssistiveDeviceOption[] = [];
  const custom: string[] = [];

  for (const device of devices ?? []) {
    if (!device) {
      continue;
    }
    if ((ASSISTIVE_DEVICE_OPTIONS as readonly string[]).includes(device)) {
      selected.push(device as AssistiveDeviceOption);
    } else {
      custom.push(device);
    }
  }

  return {
    selected,
    customText: custom.join('、'),
  };
};

export const mergeAssistiveDevices = (selected: AssistiveDeviceOption[], customText: string) => {
  return Array.from(new Set([...selected, ...splitCustomAssistiveDevices(customText)]));
};
