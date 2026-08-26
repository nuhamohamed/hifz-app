import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useFonts, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold } from '@expo-google-fonts/outfit';
import { C } from './design';
import { MockupContextProvider } from './MockupContext';

import WelcomeMockup from './WelcomeMockup';
import OnboardingNameMockup from './OnboardingNameMockup';
import OnboardingMemorizationMockup from './OnboardingMemorizationMockup';
import OnboardingTimeMockup from './OnboardingTimeMockup';
import OnboardingGenderMockup from './OnboardingGenderMockup';
import OnboardingNotificationsMockup from './OnboardingNotificationsMockup';
import OnboardingReminderTimeMockup from './OnboardingReminderTimeMockup';
import AllSetMockup from './AllSetMockup';
import TodayMockup from './TodayMockup';
import PreSessionMockup from './PreSessionMockup';
import RecitationMockup from './RecitationMockup';
import PostSessionMockup from './PostSessionMockup';
import SummaryMockup from './SummaryMockup';
import TransitionMockup from './TransitionMockup';
import SessionReviewMockup from './SessionReviewMockup';
import RecitationDemoScreen from './RecitationDemoScreen';

const Stack = createNativeStackNavigator();

function FontLoader({ children }) {
  const [loaded] = useFonts({
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
  });
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (loaded) {
      Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  }, [loaded]);

  if (!loaded) {
    return (
      <View style={styles.loading}>
        <View style={styles.loadingDot} />
      </View>
    );
  }

  return <Animated.View style={[{ flex: 1 }, { opacity }]}>{children}</Animated.View>;
}

export default function MockupNavigator() {
  return (
    <MockupContextProvider>
    <FontLoader>
      <Stack.Navigator
        initialRouteName="MockupWelcome"
        screenOptions={{ headerShown: false, animation: 'fade' }}
      >
        <Stack.Screen name="MockupWelcome" component={WelcomeMockup} />
        <Stack.Screen name="MockupOnboardingName" component={OnboardingNameMockup} />
        <Stack.Screen name="MockupOnboardingMemorization" component={OnboardingMemorizationMockup} />
        <Stack.Screen name="MockupOnboardingTime" component={OnboardingTimeMockup} />
        <Stack.Screen name="MockupOnboardingGender" component={OnboardingGenderMockup} />
        <Stack.Screen name="MockupOnboardingNotifications" component={OnboardingNotificationsMockup} />
        <Stack.Screen name="MockupReminderTime" component={OnboardingReminderTimeMockup} />
        <Stack.Screen name="MockupAllSet" component={AllSetMockup} />
        <Stack.Screen name="MockupToday" component={TodayMockup} />
        <Stack.Screen name="MockupPreSession" component={PreSessionMockup} />
        <Stack.Screen name="MockupTransition" component={TransitionMockup} />
        <Stack.Screen name="MockupRecitation" component={RecitationMockup} />
        <Stack.Screen name="MockupPostSession" component={PostSessionMockup} />
        <Stack.Screen name="MockupSummary" component={SummaryMockup} />
        <Stack.Screen name="MockupSessionReview" component={SessionReviewMockup} />
        <Stack.Screen name="MockupRecitationDemo" component={RecitationDemoScreen} />
      </Stack.Navigator>
    </FontLoader>
    </MockupContextProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: C.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: C.cobalt,
    opacity: 0.4,
  },
});
