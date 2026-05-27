import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import styles from './styles';

interface ToggleSwitchProps {
  isEnabled: boolean;
  onToggle: (newState: boolean) => void;
  /** When true, the switch renders dimmed and ignores presses. Used
   *  by Phase 3a for the precise-values toggle when the base pair
   *  is not yet granted. */
  disabled?: boolean;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ isEnabled, onToggle, disabled }) => {
  const handlePress = () => {
    if (disabled) return;
    onToggle(!isEnabled);
  };

  return (
    <TouchableOpacity
      style={[
        styles.toggleSwitch,
        isEnabled && styles.toggleSwitchActive,
        disabled && { opacity: 0.4 },
      ]}
      onPress={handlePress}
      activeOpacity={disabled ? 1 : 0.8}
      disabled={disabled}
    >
      <View style={[styles.toggleThumb, isEnabled && styles.toggleThumbActive]} />
    </TouchableOpacity>
  );
};

export default ToggleSwitch;
