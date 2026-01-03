import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-about_us';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
