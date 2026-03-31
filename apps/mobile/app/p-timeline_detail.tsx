import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-timeline_detail';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
