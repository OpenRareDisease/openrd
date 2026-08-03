import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, withSpring } from 'react-native-reanimated';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, MOTION, RADIUS, SPACE, TYPE } from '../../lib/design';

/**
 * A segmented control.
 *
 * Why this rather than a row of chips
 * -----------------------------------
 * These screens filter one view by a set of mutually-exclusive options
 * —「全部 / 肺功能 / 膈肌超声」,「全部 / 心电图 / 心脏超声」— and drew
 * them as independent rounded pills. A row of pills is the shape iOS
 * uses for *multi*-select tags; the shape for "pick exactly one of
 * these" is a single track with one selected segment inside it. Drawn
 * as separate pills, nothing says the options are exclusive, and the
 * selected one differs from the rest only by tint.
 *
 * The track does that work: it is visibly one object, so the thing
 * moving inside it is visibly one selection.
 *
 * The moving pill
 * ---------------
 * The selection indicator slides on a spring rather than appearing.
 * That is not decoration — it is what tells the eye that the same
 * indicator moved from A to B, rather than one highlight vanishing and
 * an unrelated one appearing. `MOTION.move` has slight overshoot for
 * exactly that reason.
 *
 * Scrolls horizontally when the segments do not fit, because these
 * filters can run to five or six options and truncating a filter label
 * makes it unreadable.
 */

const TRACK_INSET = 3;

export interface Segment {
  key: string;
  label: string;
}

interface SegmentedControlProps {
  segments: Segment[];
  value: string;
  onChange: (key: string) => void;
  /** Announced by screen readers as the group's purpose, e.g. 「报告分类」. */
  accessibilityLabel?: string;
  /** Outer spacing. The control owns its own shape but not its place on
   *  the page — callers that replaced a laid-out row need to keep the
   *  margin that row had. */
  style?: ViewStyle;
}

const SegmentedControl = ({
  segments,
  value,
  onChange,
  accessibilityLabel,
  style,
}: SegmentedControlProps) => {
  // Measured rather than assumed: the labels are Chinese of varying
  // length, so equal-width segments would leave 全部 swimming and clip
  // 膈肌超声.
  const [widths, setWidths] = useState<number[]>([]);

  const index = Math.max(
    0,
    segments.findIndex((segment) => segment.key === value),
  );

  const measured = widths.length === segments.length && widths.every((w) => w > 0);
  const offset = useDerivedValue(() =>
    withSpring(measured ? widths.slice(0, index).reduce((sum, w) => sum + w, 0) : 0, MOTION.move),
  );
  const width = useDerivedValue(() => withSpring(measured ? (widths[index] ?? 0) : 0, MOTION.move));

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
    width: width.value,
  }));

  const handleLayout = (i: number) => (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setWidths((previous) => {
      if (previous[i] === next) return previous;
      const copy = [...previous];
      copy[i] = next;
      return copy;
    });
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
      // A horizontal ScrollView is still a flex child of whatever column
      // it lands in, and without this it claims the leftover height —
      // 48pt of control inside a 137pt box, with the form pushed down
      // below the fold. It must hug its track.
      style={[styles.root, style]}
    >
      <View
        style={styles.track}
        accessibilityRole="tablist"
        accessibilityLabel={accessibilityLabel}
      >
        {/* Rendered under the labels, not around them: wrapping the
            selected label in its own pill would remount it on every
            change and there would be nothing left to animate. */}
        {measured ? <Animated.View style={[styles.pill, pillStyle]} /> : null}

        {segments.map((segment, i) => {
          const selected = segment.key === value;
          return (
            <Pressable
              key={segment.key}
              onLayout={handleLayout(i)}
              style={styles.segment}
              // The segment is inset by TRACK_INSET on every side, so
              // its own box is MIN_TOUCH_TARGET - 6. Reclaim the inset:
              // the band between the segment and the track edge looks
              // like part of the control and should behave like it.
              hitSlop={TRACK_INSET}
              onPress={() => onChange(segment.key)}
              accessibilityRole="tab"
              // Native reads `accessibilityState`; react-native-web
              // 0.20 silently drops it, so on web every segment
              // rendered role="tab" with no aria-selected and the
              // selected one was indistinguishable from the rest —
              // which is the one thing a segmented control exists to
              // convey. aria-* is first-class in RN 0.71+ and maps
              // back to accessibilityState on device.
              accessibilityState={{ selected }}
              aria-selected={selected}
              accessibilityLabel={segment.label}
            >
              <Text
                style={[styles.label, selected ? styles.labelSelected : null]}
                numberOfLines={1}
              >
                {segment.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
};

export default SegmentedControl;

const styles = StyleSheet.create({
  root: {
    flexGrow: 0,
    flexShrink: 0,
  },
  scroll: {
    paddingRight: SPACE.gutter,
  },
  track: {
    flexDirection: 'row',
    alignItems: 'stretch',
    alignSelf: 'flex-start',
    padding: TRACK_INSET,
    borderRadius: RADIUS.control + TRACK_INSET,
    backgroundColor: COLOR.well,
  },
  /** The selection. White rather than accent-tinted: on iOS the moving
   *  segment reads as a raised surface, and the accent is spent on the
   *  label instead — one accent per control. */
  pill: {
    position: 'absolute',
    top: TRACK_INSET,
    bottom: TRACK_INSET,
    left: TRACK_INSET,
    borderRadius: RADIUS.control,
    backgroundColor: COLOR.surface,
  },
  segment: {
    minHeight: MIN_TOUCH_TARGET - TRACK_INSET * 2,
    paddingHorizontal: SPACE.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    ...TYPE.label,
    color: COLOR.inkMuted,
  },
  labelSelected: {
    color: COLOR.accent,
  },
});
