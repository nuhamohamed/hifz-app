import { useCallback, useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import * as WebBrowser from 'expo-web-browser';
import { StatusBar } from 'expo-status-bar';
import { SQLiteProvider } from 'expo-sqlite';
import { useFonts } from 'expo-font';
import { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold } from '@expo-google-fonts/outfit';
import { ActivityIndicator, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PostSessionQuizScreen from './screens/PostSessionQuizScreen';
import PreSessionQuizScreen from './screens/PreSessionQuizScreen';
import RecitationScreen from './screens/RecitationScreen';
import SessionSummaryScreen from './screens/SessionSummaryScreen';
import SettingsScreen from './screens/SettingsScreen';
import TodayScreen from './screens/TodayScreen';
import WelcomeScreen from './screens/onboarding/WelcomeScreen';
import NameScreen from './screens/onboarding/NameScreen';
import MemorizedJuzScreen from './screens/onboarding/MemorizedJuzScreen';
import TimeScreen from './screens/onboarding/TimeScreen';
import GenderScreen from './screens/onboarding/GenderScreen';
import NotificationsScreen from './screens/onboarding/NotificationsScreen';
import ReminderTimeScreen from './screens/onboarding/ReminderTimeScreen';
import AllSetScreen from './screens/onboarding/AllSetScreen';
import DevMenuScreen from './screens/DevMenuScreen';
import MockupNavigator from './screens/mockups/MockupNavigator';
import { supabase } from './lib/supabase';
import { colors } from './lib/theme';
import { getOnboardingResumePoint } from './lib/onboarding';
import { ensureSession } from './lib/auth';
import { OnboardingProvider, useOnboarding } from './lib/OnboardingContext';

// Dismisses the OAuth browser sheet once the redirect lands back in the app.
WebBrowser.maybeCompleteAuthSession();

// expo-notifications 0.32 replaced shouldShowAlert with shouldShowBanner and
// shouldShowList. Returning only the old key left both new ones undefined,
// which reads as false, so a reminder firing while the app was open presented
// nothing at all. shouldShowAlert stays for backwards compatibility.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Each navigator needs its OWN stack instance. Sharing one means React sees the
// same component type when swapping OnboardingNavigator for MainNavigator,
// reuses the mounted navigator, and keeps its old route state -- leaving the
// user staring at the last onboarding screen forever.
// Must be a module-level constant. Inlining this object literal in the JSX
// gives it a new identity on every render, which restarts SQLiteProvider's
// asset copy, drops it back to "not ready", and stops it rendering children --
// freezing the UI on whatever screen was last committed.
const MUSHAF_ASSET = {
  assetId: require('./assets/mushaf.db'),
  // forceOverwrite keeps the device copy in sync with the bundled DB
  // (it gained the surahs table after the first version shipped)
  forceOverwrite: true,
};

const OnboardingStack = createNativeStackNavigator();
const MainStack = createNativeStackNavigator();

function LoadingScreen() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

// Anonymous sign-in is the only thing standing between launch and a usable
// app, so a failure here needs to say so rather than spin forever.
function AuthErrorScreen({ message }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, padding: 24 }}>
      <Text style={{ color: colors.text, fontSize: 16, textAlign: 'center', marginBottom: 8 }}>
        Couldn't start a session
      </Text>
      <Text style={{ color: colors.textMid, fontSize: 14, textAlign: 'center' }}>{message}</Text>
    </View>
  );
}

function OnboardingNavigator({ initialRouteName }) {
  return (
    <OnboardingStack.Navigator
      // In a dev build the tester lands on DevMenu first, so recitation is
      // reachable without walking all eight setup screens after every database
      // reset. __DEV__ is false in a release build, so real users go straight
      // to their resume point and DevMenu is not registered at all.
      initialRouteName={__DEV__ ? 'DevMenu' : initialRouteName}
      screenOptions={{ headerShown: false }}
    >
      {__DEV__ ? (
        <OnboardingStack.Screen name="DevMenu" component={DevMenuScreen} />
      ) : null}
      {__DEV__ ? (
        <OnboardingStack.Screen name="Mockups" component={MockupNavigator} />
      ) : null}
      <OnboardingStack.Screen name="Welcome" component={WelcomeScreen} />
      <OnboardingStack.Screen name="Name" component={NameScreen} />
      <OnboardingStack.Screen name="Memorization" component={MemorizedJuzScreen} />
      <OnboardingStack.Screen name="Time" component={TimeScreen} />
      <OnboardingStack.Screen name="Gender" component={GenderScreen} />
      <OnboardingStack.Screen name="Notifications" component={NotificationsScreen} />
      <OnboardingStack.Screen name="ReminderTime" component={ReminderTimeScreen} />
      <OnboardingStack.Screen name="AllSet" component={AllSetScreen} />
    </OnboardingStack.Navigator>
  );
}

function MainNavigator() {
  return (
    <MainStack.Navigator initialRouteName="Today" screenOptions={{ headerShown: false }}>
      <MainStack.Screen name="Today" component={TodayScreen} />
      <MainStack.Screen name="Settings" component={SettingsScreen} />
      <MainStack.Screen name="PreSessionQuiz" component={PreSessionQuizScreen} />
      <MainStack.Screen name="Recitation" component={RecitationScreen} />
      <MainStack.Screen name="PostSessionQuiz" component={PostSessionQuizScreen} />
      <MainStack.Screen name="SessionSummary" component={SessionSummaryScreen} />
      {__DEV__ ? (
        <MainStack.Screen name="Mockups" component={MockupNavigator} />
      ) : null}
    </MainStack.Navigator>
  );
}

// Reads the phase from context rather than receiving it as children.
// SQLiteProvider is memo'd with a comparator that ignores `children`, so a
// changed child element is silently discarded and the old screen stays
// mounted. Context updates propagate through that bailout; children do not.
function RootNavigator() {
  const { resumePoint } = useOnboarding();
  return resumePoint ? (
    <OnboardingNavigator initialRouteName={resumePoint} />
  ) : (
    <MainNavigator />
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    UthmanicHafs: require('./assets/UthmanicHafs_V22.ttf'),
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
  });
  // undefined = still checking, null = signed out, object = signed in
  const [session, setSession] = useState(undefined);
  // undefined = still checking, string = onboarding route to resume at, null = onboarding complete
  const [resumePoint, setResumePoint] = useState(undefined);
  const [authError, setAuthError] = useState(null);
  // Once onboarding is finished, no in-flight resume-point fetch may undo it.
  const onboardingDone = useRef(false);

  useEffect(() => {
    let mounted = true;
    // No sign-in screen: the first launch silently creates an anonymous
    // Supabase user so every user_id-keyed write keeps working. Signing in
    // later links that same UUID rather than creating a new one.
    ensureSession()
      .then((newSession) => {
        if (mounted) setSession(newSession);
      })
      .catch((error) => {
        if (mounted) setAuthError(error.message);
      });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (newSession) setSession(newSession);
    });
    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  // Keyed on the user id rather than the session object: Supabase hands back a
  // fresh session object on every token refresh, and re-fetching on those was
  // racing the completeOnboarding() below.
  const userId = session?.user?.id;

  useEffect(() => {
    if (!userId) {
      setResumePoint(undefined);
      return;
    }
    let mounted = true;
    getOnboardingResumePoint(userId).then((point) => {
      // A fetch started before onboarding finished would otherwise resolve
      // afterwards and send the user back to the last onboarding screen.
      if (mounted && !onboardingDone.current) setResumePoint(point);
    });
    return () => {
      mounted = false;
    };
  }, [userId]);

  // AllSetScreen calls this directly after writing onboarding_completed to
  // Supabase, so the app can switch to the main tab flow immediately instead
  // of waiting on a re-fetch.
  const completeOnboarding = useCallback(() => {
    onboardingDone.current = true;
    setResumePoint(null);
  }, []);

  // Anonymous sign-in runs before anything renders, so "no session yet" is a
  // loading state rather than a signed-out one.
  const isCheckingAuth = !authError && (!session || resumePoint === undefined);

  if (!fontsLoaded || isCheckingAuth) {
    return <LoadingScreen />;
  }

  if (authError) {
    return <AuthErrorScreen message={authError} />;
  }

  return (
    <OnboardingProvider value={{ completeOnboarding, resumePoint }}>
      <SQLiteProvider databaseName="mushaf.db" assetSource={MUSHAF_ASSET}>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
        <StatusBar style="auto" />
      </SQLiteProvider>
    </OnboardingProvider>
  );
}
