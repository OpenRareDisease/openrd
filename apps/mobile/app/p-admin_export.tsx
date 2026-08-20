import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-admin/full-export';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
