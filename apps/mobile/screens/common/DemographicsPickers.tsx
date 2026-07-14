import { StyleSheet, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import {
  type DateParts,
  getBirthDayOptions,
  getCityOptions,
  getDistrictOptions,
  birthMonthOptions,
  birthYearOptions,
  provinceOptions,
} from '../../lib/demographics-options';
import { CLINICAL_COLORS } from '../../lib/clinical-visuals';

/**
 * Shared demographic pickers for every profile-shaped form.
 *
 * Before this existed, the register screen had wheel pickers while the
 * profile-edit screen asked for free-text "YYYY-MM-DD" / province
 * names — the same fields, two input methods, and only the free-text
 * one could produce malformed values. Both screens now render these.
 *
 * The cascade rules live HERE so callers can't get them wrong:
 * - changing year/month clears a day that no longer exists (Feb 30);
 * - changing province clears city+district; changing city clears
 *   district.
 * Callers receive the fully-consistent next value via onChange.
 */

interface BirthDatePickersProps {
  value: DateParts;
  onChange: (next: DateParts) => void;
}

export const BirthDatePickers = ({ value, onChange }: BirthDatePickersProps) => {
  const dayOptions = getBirthDayOptions(value.year, value.month);

  const update = (part: keyof DateParts, partValue: string) => {
    const next = { ...value, [part]: partValue };
    if (part !== 'day' && next.year && next.month && next.day) {
      const validDays = getBirthDayOptions(next.year, next.month).map((option) => option.value);
      if (!validDays.includes(next.day)) {
        next.day = '';
      }
    }
    onChange(next);
  };

  return (
    <View style={pickerStyles.row}>
      <View style={[pickerStyles.wrapper, pickerStyles.column]}>
        <Picker
          selectedValue={value.year}
          onValueChange={(v) => update('year', String(v))}
          style={pickerStyles.picker}
        >
          <Picker.Item label="年份" value="" />
          {birthYearOptions.map((option) => (
            <Picker.Item key={option.value} label={option.label} value={option.value} />
          ))}
        </Picker>
      </View>
      <View style={[pickerStyles.wrapper, pickerStyles.column]}>
        <Picker
          selectedValue={value.month}
          onValueChange={(v) => update('month', String(v))}
          style={pickerStyles.picker}
        >
          <Picker.Item label="月份" value="" />
          {birthMonthOptions.map((option) => (
            <Picker.Item key={option.value} label={option.label} value={option.value} />
          ))}
        </Picker>
      </View>
      <View style={[pickerStyles.wrapper, pickerStyles.column]}>
        <Picker
          selectedValue={value.day}
          onValueChange={(v) => update('day', String(v))}
          style={pickerStyles.picker}
        >
          <Picker.Item label="日期" value="" />
          {dayOptions.map((option) => (
            <Picker.Item key={option.value} label={option.label} value={option.value} />
          ))}
        </Picker>
      </View>
    </View>
  );
};

export interface RegionValue {
  province: string;
  city: string;
  district: string;
}

interface RegionPickersProps {
  value: RegionValue;
  onChange: (next: RegionValue) => void;
}

export const RegionPickers = ({ value, onChange }: RegionPickersProps) => {
  const cityOptions = getCityOptions(value.province);
  const districtOptions = getDistrictOptions(value.province, value.city);

  return (
    <View style={pickerStyles.stack}>
      <View style={pickerStyles.wrapper}>
        <Picker
          selectedValue={value.province}
          onValueChange={(v) => onChange({ province: String(v), city: '', district: '' })}
          style={pickerStyles.picker}
        >
          <Picker.Item label="请选择省份" value="" />
          {provinceOptions.map((option) => (
            <Picker.Item key={option.value} label={option.label} value={option.value} />
          ))}
        </Picker>
      </View>
      <View style={pickerStyles.wrapper}>
        <Picker
          selectedValue={value.city}
          onValueChange={(v) => onChange({ ...value, city: String(v), district: '' })}
          enabled={cityOptions.length > 0}
          style={pickerStyles.picker}
        >
          <Picker.Item label="请选择城市" value="" />
          {cityOptions.map((option) => (
            <Picker.Item key={option.value} label={option.label} value={option.value} />
          ))}
        </Picker>
      </View>
      <View style={pickerStyles.wrapper}>
        <Picker
          selectedValue={value.district}
          onValueChange={(v) => onChange({ ...value, district: String(v) })}
          enabled={districtOptions.length > 0}
          style={pickerStyles.picker}
        >
          <Picker.Item label="请选择区县" value="" />
          {districtOptions.map((option) => (
            <Picker.Item key={option.value} label={option.label} value={option.value} />
          ))}
        </Picker>
      </View>
    </View>
  );
};

const pickerStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  stack: {
    gap: 12,
  },
  column: {
    flex: 1,
  },
  wrapper: {
    width: '100%',
    borderRadius: 8,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    overflow: 'hidden',
  },
  picker: {
    width: '100%',
    color: CLINICAL_COLORS.text,
    backgroundColor: CLINICAL_COLORS.panel,
  },
});
