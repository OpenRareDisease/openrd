import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-falls';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
