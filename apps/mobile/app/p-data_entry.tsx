import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-data_entry';

/**
 * Data entry renders here again.
 *
 * It briefly held a tab slot (as `(tabs)/p-record`), and this file was
 * a redirect pointing at it. Recording is an action rather than a
 * destination, so it moved out of the bar and into the raised center
 * button (see AppTabBar) — which means this route is the real screen
 * once more, and every `router.push('/p-data_entry')` call site lands
 * on it directly instead of bouncing through a redirect.
 */
export default function DataEntry() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
