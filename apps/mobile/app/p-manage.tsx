import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-manage';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
