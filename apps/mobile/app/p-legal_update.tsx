import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-legal_update';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
