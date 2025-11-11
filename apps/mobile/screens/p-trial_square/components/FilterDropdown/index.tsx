

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import styles from './styles';

interface FilterDropdownProps {
  phaseFilter: string;
  matchFilter: string;
  onPhaseFilterChange: (value: string) => void;
  onMatchFilterChange: (value: string) => void;
  onApplyFilter: () => void;
  onResetFilter: () => void;
}

const FilterDropdown: React.FC<FilterDropdownProps> = ({
  phaseFilter,
  matchFilter,
  onPhaseFilterChange,
  onMatchFilterChange,
  onApplyFilter,
  onResetFilter,
}) => {
  const phaseOptions = [
    { label: '全部阶段', value: '' },
    { label: 'I期', value: 'I' },
    { label: 'II期', value: 'II' },
    { label: 'III期', value: 'III' },
    { label: 'IV期', value: 'IV' },
  ];

  const matchOptions = [
    { label: '全部匹配度', value: '' },
    { label: '高匹配度(80%+)', value: 'high' },
    { label: '中匹配度(60%-79%)', value: 'medium' },
    { label: '低匹配度(<60%)', value: 'low' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.dropdown}>
        <Text style={styles.title}>筛选条件</Text>
        
        <View style={styles.formSection}>
          <Text style={styles.label}>试验阶段</Text>
          <View style={styles.optionsContainer}>
            {phaseOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.option,
                  phaseFilter === option.value && styles.selectedOption
                ]}
                onPress={() => onPhaseFilterChange(option.value)}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.optionText,
                  phaseFilter === option.value && styles.selectedOptionText
                ]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.formSection}>
          <Text style={styles.label}>匹配度</Text>
          <View style={styles.optionsContainer}>
            {matchOptions.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.option,
                  matchFilter === option.value && styles.selectedOption
                ]}
                onPress={() => onMatchFilterChange(option.value)}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.optionText,
                  matchFilter === option.value && styles.selectedOptionText
                ]}>
                  {option.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.applyButton}
            onPress={onApplyFilter}
            activeOpacity={0.8}
          >
            <Text style={styles.applyButtonText}>应用筛选</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.resetButton}
            onPress={onResetFilter}
            activeOpacity={0.8}
          >
            <Text style={styles.resetButtonText}>重置</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default FilterDropdown;

