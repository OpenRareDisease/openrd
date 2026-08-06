import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-surveillance';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
