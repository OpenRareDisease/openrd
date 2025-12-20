import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-clinical_passport';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
