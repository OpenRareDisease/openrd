export const ASSISTIVE_DEVICE_OPTIONS = ['AFO', '手杖', '助行器', '轮椅', '无创通气'] as const;

export type AssistiveDeviceOption = (typeof ASSISTIVE_DEVICE_OPTIONS)[number];
export type AmbulationChoice = 'independent' | 'assisted' | '';

export const AMBULATION_OPTIONS: Array<{
  value: AmbulationChoice;
  label: string;
}> = [
  { value: 'independent', label: '可独立行走' },
  { value: 'assisted', label: '需要辅助' },
];

const splitCustomAssistiveDevices = (value: string) =>
  value
    .split(/[、，,；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

export const toAmbulationChoice = (value?: boolean | null): AmbulationChoice => {
  if (value === true) {
    return 'independent';
  }
  if (value === false) {
    return 'assisted';
  }
  return '';
};

export const fromAmbulationChoice = (value: AmbulationChoice): boolean | null => {
  if (value === 'independent') {
    return true;
  }
  if (value === 'assisted') {
    return false;
  }
  return null;
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
