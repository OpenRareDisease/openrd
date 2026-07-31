import { Tabs } from 'expo-router';
import AppTabBar from '../../screens/common/AppTabBar';

/**
 * Three destinations: 今天 / 病程 / 我的.
 *
 * 问答 and 我的档案 left the bar — not because they matter less, but
 * because neither is a place you set out for. Asking is something you
 * do *about* something you're already looking at, so it now opens
 * from wherever that something is; the archive is reference material
 * you reach for from 我的. Recording moved to the bar's center action
 * (see AppTabBar), which keeps the most frequent task one thumb away
 * from every screen.
 */
export default function Layout() {
  return (
    <Tabs backBehavior="order" tabBar={(props) => <AppTabBar {...props} />}>
      <Tabs.Screen name="index" options={{ href: null }} />

      <Tabs.Screen name="p-home" options={{ title: '今天', headerShown: false }} />

      <Tabs.Screen name="p-manage" options={{ title: '病程', headerShown: false }} />

      <Tabs.Screen name="p-qna" options={{ title: '问答', headerShown: false }} />

      <Tabs.Screen name="p-settings" options={{ title: '我的', headerShown: false }} />
    </Tabs>
  );
}
