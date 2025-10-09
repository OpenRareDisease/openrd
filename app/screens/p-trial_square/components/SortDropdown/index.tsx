

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import styles from './styles';

interface SortDropdownProps {
  sortOption: string;
  onSortChange: (value: string) => void;
}

const SortDropdown: React.FC<SortDropdownProps> = ({ sortOption, onSortChange }) => {
  const sortOptions = [
    { label: '匹配度从高到低', value: 'match' },
    { label: '最新发布', value: 'newest' },
    { label: '距离最近', value: 'location' },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.dropdown}>
        <Text style={styles.title}>排序方式</Text>
        
        <View style={styles.optionsContainer}>
          {sortOptions.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={styles.option}
              onPress={() => onSortChange(option.value)}
              activeOpacity={0.7}
            >
              <View style={styles.radioContainer}>
                <View style={[
                  styles.radio,
                  sortOption === option.value && styles.selectedRadio
                ]}>
                  {sortOption === option.value && <View style={styles.radioInner} />}
                </View>
                <Text style={styles.optionText}>{option.label}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
};

export default SortDropdown;

