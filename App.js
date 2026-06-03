import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PostSessionQuizScreen from './screens/PostSessionQuizScreen';
import PreSessionQuizScreen from './screens/PreSessionQuizScreen';
import RecitationScreen from './screens/RecitationScreen';
import SessionSummaryScreen from './screens/SessionSummaryScreen';
import TodayScreen from './screens/TodayScreen';

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Today" component={TodayScreen} />
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
    </>
  );
}
