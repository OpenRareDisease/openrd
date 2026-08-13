import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-genetics_family';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
