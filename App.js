import { StatusBar } from 'expo-status-bar';
import RecitationScreen from './screens/RecitationScreen';
// import RecitationScreen from './screens/RecitationScreenRealtime';

export default function App() {
  return (
    <>
      <RecitationScreen />
      <StatusBar style="auto" />
    </>
  );
}
