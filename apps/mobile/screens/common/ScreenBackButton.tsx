import React from 'react';
import { StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { FontAwesome6 } from '@expo/vector-icons';
import { CLINICAL_COLORS } from '../../lib/clinical-visuals';
import { DEFAULT_BACK_FALLBACK, goBackOrFallback } from '../../lib/navigation';

interface ScreenBackButtonProps {
  fallbackHref?: Href;
  style?: StyleProp<ViewStyle>;
}

const ScreenBackButton: React.FC<ScreenBackButtonProps> = ({
  fallbackHref = DEFAULT_BACK_FALLBACK,
  style,
}) => {
  const router = useRouter();

  return (
    <TouchableOpacity
      accessibilityLabel="返回上一页"
      accessibilityRole="button"
      activeOpacity={0.75}
      onPress={() => goBackOrFallback(router, fallbackHref)}
      style={[styles.button, style]}
    >
      <FontAwesome6 name="arrow-left" size={16} color={CLINICAL_COLORS.textSoft} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: CLINICAL_COLORS.panel,
    borderWidth: 1,
    borderColor: CLINICAL_COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ScreenBackButton;
