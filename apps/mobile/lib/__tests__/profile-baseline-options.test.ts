import {
  AMBULATION_OPTIONS,
  AMBULATION_STATES,
  ambulationLabel,
  fromAmbulationChoice,
  isAmbulationLimited,
  mergeAssistiveDevices,
  splitAssistiveDevices,
  toAmbulationChoice,
} from '../profile-baseline-options';

describe('ambulation round-trip', () => {
  // The bug this fences: migration 022 rewrote the stored value from
  // true/false to a string, `toAmbulationChoice` still matched only
  // booleans, and 基础档案 therefore opened with the radio group blank
  // and saved that blank back as null. One unrelated edit — a phone
  // number — erased an answer the patient never touched.
  it.each(AMBULATION_STATES)('reads %s back out of a stored baseline unchanged', (state) => {
    expect(fromAmbulationChoice(toAmbulationChoice(state))).toBe(state);
  });

  it('offers every state as an option, including the one the boolean could not hold', () => {
    expect(AMBULATION_OPTIONS.map((option) => option.value)).toEqual([...AMBULATION_STATES]);
    // 'unable' arrives on its own from the Vignos grade-9 sync. Without
    // a radio for it, a patient who opens the form cannot put it back
    // after clearing it, and the profile and the timeline start
    // disagreeing again — the thing 022 was written to stop.
    expect(AMBULATION_OPTIONS.map((option) => option.label)).toContain('无法行走');
  });

  it('treats only an unanswered question as null', () => {
    expect(fromAmbulationChoice('')).toBeNull();
    expect(toAmbulationChoice(null)).toBe('');
    expect(toAmbulationChoice(undefined)).toBe('');
  });

  it('still reads the pre-022 booleans a server without the migration serves', () => {
    expect(toAmbulationChoice(true)).toBe('independent');
    expect(toAmbulationChoice(false)).toBe('assisted');
  });

  it('shows a label for every state rather than 未填写', () => {
    expect(ambulationLabel('independent')).toBe('可独立行走');
    expect(ambulationLabel('assisted')).toBe('需要辅助');
    expect(ambulationLabel('unable')).toBe('无法行走');
    expect(ambulationLabel(null)).toBeNull();
  });

  it('counts assisted and unable as walking that is not unaided', () => {
    expect(isAmbulationLimited('assisted')).toBe(true);
    expect(isAmbulationLimited('unable')).toBe(true);
    expect(isAmbulationLimited('independent')).toBe(false);
    expect(isAmbulationLimited(null)).toBe(false);
  });
});

describe('assistive devices', () => {
  it('splits stored devices into the known options and free text', () => {
    const { selected, customText } = splitAssistiveDevices(['AFO', '轮椅', '定制鞋垫']);
    expect(selected).toEqual(['AFO', '轮椅']);
    expect(customText).toBe('定制鞋垫');
  });

  it('merges without duplicating a device typed as well as tapped', () => {
    expect(mergeAssistiveDevices(['AFO'], 'AFO、定制鞋垫')).toEqual(['AFO', '定制鞋垫']);
  });
});
