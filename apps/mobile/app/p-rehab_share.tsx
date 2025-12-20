import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-rehab_share';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
