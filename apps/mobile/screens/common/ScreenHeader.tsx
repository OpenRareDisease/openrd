import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import Icon from './Icon';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, HAIRLINE, INTERACTION, RADIUS, SPACE, TYPE } from '../../lib/design';
import { DEFAULT_BACK_FALLBACK, goBackOrFallback } from '../../lib/navigation';

/**
 * The header every stack screen gets: back, title, and home.
 *
 * Why home is a control and not just "press back a few times"
 * -----------------------------------------------------------
 * The root Stack runs with `headerShown: false`, and the tab bar only
 * renders on the three tab screens. So on a stack screen the only exit
 * was whatever that screen happened to draw — `p-data_entry` and
 * `p-qna` drew nothing at all, and `p-data_entry` is the target of the
 * centre FAB, i.e. the most-visited screen in the app. On iOS the sole
 * remaining way out was the left-edge swipe, which is exactly the
 * gesture the population this app is built for (progressive loss of
 * grip and fine motor control — see lib/a11y.ts) can least rely on.
 *
 * Back alone is also not enough once a patient has drilled several
 * screens deep from a brief: 报告详情 → 报告管理 → 档案 is three
 * presses to get home, each one a targeting task. One control that
 * says「首页」ends the trip in a single press.
 *
 * `router.replace` for home rather than `push`: home is not somewhere
 * you go *deeper* to, and pushing it would leave the whole trail on
 * the stack for back to walk again.
 */
interface ScreenHeaderProps {
  title?: string;
  /** Where back goes when there is no history — a deep link opened
   *  cold has nothing to pop. */
  fallbackHref?: Href;
  /** Hide the home control on screens that are one press from it
   *  anyway, or where leaving mid-task would lose work. */
  showHome?: boolean;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

const ScreenHeader = ({
  title,
  fallbackHref = DEFAULT_BACK_FALLBACK,
  showHome = true,
  right,
  style,
}: ScreenHeaderProps) => {
  const router = useRouter();

  return (
    <View style={[styles.header, style]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="返回上一页"
        activeOpacity={INTERACTION.pressOpacity}
        onPress={() => goBackOrFallback(router, fallbackHref)}
        style={styles.iconButton}
      >
        <Icon name="arrow-left" size={16} color={COLOR.inkSoft} />
      </TouchableOpacity>

      {title ? (
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View style={styles.spacer} />
      )}

      {right}

      {showHome ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="回到首页"
          activeOpacity={INTERACTION.pressOpacity}
          onPress={() => router.replace('/p-home')}
          style={styles.iconButton}
        >
          <Icon name="house" size={15} color={COLOR.inkSoft} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    paddingHorizontal: SPACE.gutter,
    paddingVertical: SPACE.sm,
  },
  iconButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: RADIUS.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLOR.surface,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
  },
  title: {
    ...TYPE.heading,
    flex: 1,
  },
  spacer: {
    flex: 1,
  },
});

export default ScreenHeader;
