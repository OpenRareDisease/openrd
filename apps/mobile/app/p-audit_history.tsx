import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-audit_history';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
