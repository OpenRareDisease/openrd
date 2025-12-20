import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-trial_square';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
