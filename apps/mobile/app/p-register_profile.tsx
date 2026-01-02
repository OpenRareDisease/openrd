import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-register_profile';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
