import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-data_entry';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
