import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Icon from './Icon';
import { MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, HAIRLINE, INTERACTION, RADIUS, SPACE, TYPE } from '../../lib/design';

/**
 * A grouped list and the rows inside it — the app's answer to
 *「我看不出哪些是可点选的」.
 *
 * Affordance is a property of the primitive, not of each screen. Before
 * this, every screen assembled its own rows out of `TouchableOpacity` +
 * `View`, and whether a row got a chevron, a press state, or a 48pt
 * target depended on which screen you were on. Some rows navigated and
 * looked inert; some inert rows looked tappable.
 *
 * `<Row>` **does** something: it always has a chevron (or a supplied
 * accessory), always fills on press, always clears the touch-target
 * minimum — and `onPress` is required, so the chevron cannot appear on
 * a row that goes nowhere. A reader can therefore trust it, which is
 * the only way an affordance is worth anything.
 *
 * Rows that merely display are a plain `<View>`; there was an
 * `<InfoRow>` here for that and it never acquired a caller, so it went
 * rather than sitting in the file as a shape nothing holds.
 *
 * Separators inset to the text edge, the way an iOS grouped table does,
 * so the column of labels reads as a column rather than as a stack of
 * boxes.
 */

interface RowProps {
  label: string;
  /** Second line. Keep it to what the label can't say. */
  detail?: string;
  /** Leading icon name (see Icon.tsx). Optional — a row of pure text
   *  is often cleaner, and an icon per row turns a list into a menu. */
  icon?: string;
  /** Right-hand text, e.g. a current value. Sits before the chevron. */
  value?: string;
  /** Required. A row draws a chevron unconditionally, so a row that
   *  does not navigate would be drawing a promise it cannot keep —
   *  the exact lie this module exists to prevent. */
  onPress: () => void;
  /** Renders the label in the alert colour. For destructive rows only. */
  destructive?: boolean;
  disabled?: boolean;
  /** Replaces the chevron. Use for a switch or a spinner — anything
   *  that acts in place rather than navigating away. */
  accessory?: ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export const Row = ({
  label,
  detail,
  icon,
  value,
  onPress,
  destructive,
  disabled,
  accessory,
  accessibilityLabel,
  accessibilityHint,
}: RowProps) => (
  <Pressable
    style={({ pressed }) => [
      styles.row,
      pressed && !disabled ? styles.rowPressed : null,
      disabled ? styles.rowDisabled : null,
    ]}
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={accessibilityLabel ?? label}
    accessibilityHint={accessibilityHint}
    // See Button.tsx — react-native-web 0.20 drops accessibilityState.
    accessibilityState={{ disabled: Boolean(disabled) }}
    aria-disabled={Boolean(disabled)}
  >
    {icon ? <Icon name={icon} size={19} color={destructive ? COLOR.alert : COLOR.inkSoft} /> : null}

    <View style={styles.rowText}>
      <Text style={[styles.rowLabel, destructive ? styles.rowLabelDestructive : null]}>
        {label}
      </Text>
      {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
    </View>

    {value ? (
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    ) : null}

    {/* The chevron is the contract: it appears on rows that navigate
        and nowhere else. `accessory` replaces it for rows that act in
        place, which are not the same promise. */}
    {accessory ?? (
      <Icon name="chevron-right" size={INTERACTION.chevronSize} color={INTERACTION.chevronColor} />
    )}
  </Pressable>
);

interface ListGroupProps {
  /** Sits above the group, in the margin — an iOS section header. */
  title?: string;
  /** Sits below it, for the caveat a row can't carry. */
  footnote?: string;
  children: ReactNode;
}

const ListGroup = ({ title, footnote, children }: ListGroupProps) => {
  const rows = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <View style={styles.group}>
      {title ? <Text style={styles.groupTitle}>{title}</Text> : null}
      <View style={styles.groupBody}>
        {rows.map((row, index) => (
          // Index keys are safe here: the array is positional layout,
          // never reordered or filtered between renders.
          // eslint-disable-next-line react/no-array-index-key
          <View key={index}>
            {index > 0 ? <View style={styles.separator} /> : null}
            {row}
          </View>
        ))}
      </View>
      {footnote ? <Text style={styles.groupFootnote}>{footnote}</Text> : null}
    </View>
  );
};

export default ListGroup;

const styles = StyleSheet.create({
  group: {
    gap: SPACE.sm,
  },
  groupTitle: {
    ...TYPE.label,
    color: COLOR.inkMuted,
    paddingHorizontal: SPACE.xs,
  },
  groupBody: {
    backgroundColor: COLOR.surface,
    borderRadius: RADIUS.group,
    borderWidth: HAIRLINE,
    borderColor: COLOR.line,
    overflow: 'hidden',
  },
  groupFootnote: {
    ...TYPE.caption,
    paddingHorizontal: SPACE.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.md,
    minHeight: MIN_TOUCH_TARGET,
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.lg,
  },
  rowPressed: {
    backgroundColor: INTERACTION.pressFill,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    ...TYPE.bodyStrong,
  },
  rowLabelDestructive: {
    color: COLOR.alert,
  },
  rowDetail: {
    ...TYPE.caption,
  },
  rowValue: {
    ...TYPE.body,
    color: COLOR.inkMuted,
    maxWidth: '45%',
  },
  // Inset to the text edge, not the card edge — the iOS grouped-table
  // rule. A full-bleed line cuts the list into boxes; an inset one
  // lets the labels read as a single column.
  separator: {
    height: HAIRLINE,
    marginLeft: SPACE.lg,
    backgroundColor: COLOR.line,
  },
});
