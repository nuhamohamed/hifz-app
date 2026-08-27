import { createContext, useContext } from 'react';

// App.js provides this so AllSetScreen can flip the root navigator over to
// the main tab flow immediately after finishing onboarding, without needing
// a full re-fetch of onboarding status from Supabase.
const OnboardingContext = createContext({
  completeOnboarding: () => {},
  restartOnboarding: () => {},
});

export const OnboardingProvider = OnboardingContext.Provider;
export const useOnboarding = () => useContext(OnboardingContext);
