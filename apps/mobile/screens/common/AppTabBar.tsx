import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Icon from './Icon';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { COMFORTABLE_TOUCH_TARGET, MIN_TOUCH_TARGET } from '../../lib/a11y';
import { COLOR, ELEVATION, HAIRLINE, INTERACTION } from '../../lib/design';

/**
 * Four destinations and one action.
 *
 * The old bar carried five tabs — 首页 / 问答 / 记录 / 我的档案 / 我的 —
 * of which 记录 is not a place at all but the single most frequent
 * thing a patient does. A destination you visit and an action you
 * perform don't belong in the same row: the action wants to be
 * reachable from every screen, the destinations want to be few.
 *
 * So 记一笔 leaves the row and becomes the raised center button,
 * which puts it *closer* to the thumb than it was as a tab, while
 * the row itself answers what navigation should:
 * 今天 (what's happening), 病程 (how I got here), 问答 (ask anything),
 * 我的 (who I am and what I've authorized).
 *
 * 问答 was cut from the bar in the first pass, on the reasoning that
 * asking had moved in-place into AskAboutDrawer. Use disproved it:
 * the drawer is pinned to an object — a chart, a report — and answers
 * a follow-up about *that*. A patient with a general question
 * (「怎么加入 FSHD 社区」) has no object to open it from, and the
 * drawer also discards the answer when it closes. A conversation you
 * can return to needs a destination, so it got its tab back.
 */

/** `href` is the navigation source of truth rather than
 *  `navigation.navigate(route.name)`: expo-router owns the URL, and
 *  routing by path keeps the browser address bar, deep links and the
 *  bar itself agreeing on where we are. */
const TAB_META: Record<
  string,
  {
    title: string;
    icon: string;
    href: '/p-home' | '/p-manage' | '/p-qna' | '/p-settings';
  }
> = {
  'p-home': { title: '今天', icon: 'sun', href: '/p-home' },
  'p-manage': { title: '病程', icon: 'wave-square', href: '/p-manage' },
  'p-qna': { title: '问答', icon: 'comments', href: '/p-qna' },
  'p-settings': { title: '我的', icon: 'user', href: '/p-settings' },
};

const AppTabBar = ({ state, navigation }: BottomTabBarProps) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // `index` is the redirect-only route (href: null); it never renders
  // a button but still occupies a slot in `state.routes`.
  const visibleRoutes = state.routes.filter((route) => TAB_META[route.name]);

  // Split around the center so the raised action button sits between
  // the two halves rather than on top of a real tab's touch target.
  //
  // The halves are weighted by how many tabs each holds, not given
  // `flex: 1` apiece, so an uneven split stays proportional. At today's
  // four tabs `Math.ceil(4 / 2)` splits 2/2 and the weighting is a
  // no-op — it is kept for the next time the count changes. The
  // regression it was written for happened at three tabs: the naive
  // split put two on the left and one on the right, and equal-flex
  // halves then handed the lone tab twice the width of its neighbours
  // — on a 375pt screen 我的 owned 145pt against 73pt each, visibly
  // lopsided, with a dead strip beside the FAB that navigated to 我的
  // when tapped.
  const midpoint = Math.ceil(visibleRoutes.length / 2);
  const leftRoutes = visibleRoutes.slice(0, midpoint);
  const rightRoutes = visibleRoutes.slice(midpoint);

  const renderTab = (route: (typeof visibleRoutes)[number]) => {
    const meta = TAB_META[route.name];
    const isFocused = state.routes[state.index]?.key === route.key;
    const color = isFocused ? COLOR.accent : COLOR.inkMuted;

    const onPress = () => {
      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (!isFocused && !event.defaultPrevented) {
        router.navigate(meta.href);
      }
    };

    return (
      <TouchableOpacity
        key={route.key}
        // `tab`, not `button`. ARIA does not list aria-selected as a
        // supported property of role=button (it is supported on tab,
        // option, row, gridcell, treeitem, columnheader, rowheader), so
        // browsers drop it from the accessibility tree: the bar used to
        // emit literally <div role="button" aria-selected="true"> and a
        // VoiceOver/NVDA user on the web export heard
        // 「今天，按钮」「病程，按钮」「问答，按钮」「我的，按钮」 — identical
        // whether or not that tab was the current one. The only other
        // cue for「you are here」is COLOR.accent vs COLOR.inkMuted below,
        // which a screen reader cannot see. Matches p-manage,
        // p-audit_history and SegmentedControl.
        //
        // The row deliberately does NOT carry accessibilityRole=
        // "tablist": 记一笔 is a button sitting between the two halves,
        // and a tablist may only own tabs — declaring one here would put
        // an invalid child in the group and leave the whole thing in an
        // undefined state. An orphan tab still exposes its selected
        // state; an invalid tablist may expose nothing.
        accessibilityRole="tab"
        // Native reads `accessibilityState`; react-native-web 0.20 drops
        // it entirely (it is absent from forwardedProps and
        // createDOMProps). aria-* is first-class in RN 0.71+ and maps
        // back to accessibilityState on device, so both must be present
        // — see SegmentedControl and Button. Passed unconditionally
        // rather than `isFocused ? { selected: true } : {}`, so an
        // unselected tab announces「not selected」instead of announcing
        // no state at all.
        accessibilityState={{ selected: isFocused }}
        aria-selected={isFocused}
        accessibilityLabel={meta.title}
        style={styles.tab}
        activeOpacity={INTERACTION.pressOpacity}
        onPress={onPress}
      >
        <Icon name={meta.icon} size={18} color={color} />
        <Text style={[styles.tabLabel, { color }]}>{meta.title}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.row}>
        <View style={[styles.half, { flex: leftRoutes.length }]}>{leftRoutes.map(renderTab)}</View>

        {/* Laid out inline rather than absolutely positioned above the
            bar: an overflowing child gets clipped on Android, and a
            record button that silently loses its top half on one
            platform is worse than one that sits flush. */}
        <View style={styles.centerSlot}>
          {/* Icon and label are one touchable. As siblings the label
              was inert — and it was a second a11y node reading「记一笔」
              that did nothing when activated, so a screen reader
              announced the action twice and only one of them worked. */}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="记一笔"
            style={styles.fabTouchable}
            activeOpacity={INTERACTION.pressOpacity}
            onPress={() => router.push('/p-data_entry')}
          >
            <View style={styles.fab}>
              <Icon name="plus" size={20} color={COLOR.onAccent} />
            </View>
            <Text style={styles.fabLabel}>记一笔</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.half, { flex: rightRoutes.length }]}>
          {rightRoutes.map(renderTab)}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    // Surface white against the paper page, so the bar reads as a
    // layer above the content rather than as another sand panel.
    backgroundColor: COLOR.surface,
    borderTopWidth: HAIRLINE,
    borderTopColor: COLOR.line,
    paddingTop: 8,
    ...ELEVATION.floating,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  half: {
    // `flex` is supplied per-half from the tab count above.
    flexDirection: 'row',
  },
  centerSlot: {
    width: 92,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 4,
  },
  tab: {
    flex: 1,
    // The old bar gave every item a 72pt-tall row; dropping to padding
    // alone quietly shrank the target to ~44. See lib/a11y.ts.
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingVertical: 4,
  },
  tabLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  fabTouchable: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  fabLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: COLOR.accent,
  },
  fab: {
    // The most-used control in the app — lib/a11y.ts names 记一笔
    // specifically as belonging to the comfortable tier.
    width: COMFORTABLE_TOUCH_TARGET,
    height: COMFORTABLE_TOUCH_TARGET,
    borderRadius: COMFORTABLE_TOUCH_TARGET / 2,
    backgroundColor: COLOR.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...ELEVATION.button,
  },
});

export default AppTabBar;
