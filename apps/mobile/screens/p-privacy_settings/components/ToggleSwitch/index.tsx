

import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import styles from './styles';

interface ToggleSwitchProps {
  isEnabled: boolean;
  onToggle: (newState: boolean) => void;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ isEnabled, onToggle }) => {
  const handlePress = () => {
    onToggle(!isEnabled);
  };

  return (
    <TouchableOpacity
      style={[styles.toggleSwitch, isEnabled && styles.toggleSwitchActive]}
      onPress={handlePress}
      activeOpacity={0.8}
    >
      <View style={[styles.toggleThumb, isEnabled && styles.toggleThumbActive]} />
    </TouchableOpacity>
  );
};

export default ToggleSwitch;

