import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-admin/patient-record';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
