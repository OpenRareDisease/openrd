import { Tabs } from 'expo-router';
import AppTabBar from '../../screens/common/AppTabBar';

/**
 * Four destinations: 今天 / 病程 / 问答 / 我的, plus the center action.
 *
 * 我的档案 left the bar — not because it matters less, but because it
 * is reference material you reach for from 我的 rather than a place you
 * set out for. 问答 stayed: asking about something you are already
 * looking at happens in the drawer, but a question that arrives on its
 * own needs somewhere to go. Recording is the bar's center action (see
 * AppTabBar), which keeps the most frequent task one thumb away from
 * every screen.
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
