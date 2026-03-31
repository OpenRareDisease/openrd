import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-report_detail';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
