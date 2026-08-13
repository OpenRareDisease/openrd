import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-referral';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
