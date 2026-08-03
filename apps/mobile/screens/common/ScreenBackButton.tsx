import React from 'react';
import { StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Icon from './Icon';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, INTERACTION, RADIUS } from '../../lib/design';
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
      activeOpacity={INTERACTION.pressOpacity}
      onPress={() => goBackOrFallback(router, fallbackHref)}
      style={[styles.button, style]}
    >
      {/* Bumped 16 → 18 and softened to full ink: with the tinted disc
          gone the glyph is the whole control, so it has to carry the
          weight the container used to. */}
      <Icon name="arrow-left" size={18} color={COLOR.ink} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    // Shared by most stack screens, so this one constant governs the
    // back target app-wide.
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    // Was a filled 24pt-radius sand disc — an icon parked in a tinted
    // circle, the single most generic thing in the old header. The
    // touch target is unchanged; only the decoration is gone. The
    // radius survives for the press ripple on Android and matches the
    // squared-off backButton p-clinical_passport already migrated to.
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default ScreenBackButton;
