import { SafeAreaProvider } from 'react-native-safe-area-context';
import Page from '../screens/p-disability_assessment';

export default function Index() {
  return (
    <SafeAreaProvider>
      <Page />
    </SafeAreaProvider>
  );
}
