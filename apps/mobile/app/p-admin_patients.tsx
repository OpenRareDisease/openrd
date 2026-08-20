import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-admin/patient-list';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
