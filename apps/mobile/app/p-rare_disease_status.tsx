import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-rare_disease_status';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
