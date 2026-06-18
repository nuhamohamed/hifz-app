import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { useFonts } from 'expo-font';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PostSessionQuizScreen from './screens/PostSessionQuizScreen';
import PreSessionQuizScreen from './screens/PreSessionQuizScreen';
import RecitationScreen from './screens/RecitationScreen';
import SessionSummaryScreen from './screens/SessionSummaryScreen';
import SettingsScreen from './screens/SettingsScreen';
import TodayScreen from './screens/TodayScreen';
import MemorizedJuzScreen from './screens/onboarding/MemorizedJuzScreen';
import ScheduleScreen from './screens/onboarding/ScheduleScreen';
import SignInScreen from './screens/onboarding/SignInScreen';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const Stack = createNativeStackNavigator();

export default function App() {
  const [fontsLoaded] = useFonts({
    UthmanicHafs: require('./assets/UthmanicHafs_V22.ttf'),
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <SQLiteProvider
      databaseName="mushaf.db"
      // forceOverwrite keeps the device copy in sync with the bundled DB
      // (it gained the surahs table after the first version shipped)
      assetSource={{ assetId: require('./assets/mushaf.db'), forceOverwrite: true }}
    >
      <NavigationContainer>
        <Stack.Navigator
          initialRouteName="Today"
          screenOptions={{ headerShown: false }}
        >
          <Stack.Screen name="Today" component={TodayScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="SignIn" component={SignInScreen} />
          <Stack.Screen name="MemorizedJuz" component={MemorizedJuzScreen} />
          <Stack.Screen name="Schedule" component={ScheduleScreen} />
          <Stack.Screen
            name="PreSessionQuiz"
            component={PreSessionQuizScreen}
          />
          <Stack.Screen name="Recitation" component={RecitationScreen} />
          <Stack.Screen
            name="PostSessionQuiz"
            component={PostSessionQuizScreen}
          />
          <Stack.Screen
            name="SessionSummary"
            component={SessionSummaryScreen}
          />
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style="auto" />
    </SQLiteProvider>
  );
}
