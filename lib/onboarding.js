import { supabase } from './supabase';

// Each step's own data doubles as a resume marker so a user who closes the
// app mid-onboarding picks back up close to where they left off. Gender and
// Notifications are skippable, so a resume after skipping either may re-show
// that step rather than jumping straight to AllSet -- acceptable, since
// re-answering a skippable question is harmless.
export async function getOnboardingResumePoint(userId) {
  const [userResult, portionsResult] = await Promise.all([
    supabase
      .from('users')
      .select('name, session_minutes, gender, notification_time, onboarding_completed')
      .eq('id', userId)
      .maybeSingle(),
    supabase
      .from('memorized_portions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ]);

  const user = userResult.data;

  if (user?.onboarding_completed) return null; // onboarding complete
  // Nothing answered yet -- this is a first launch, so lead with the value
  // proposition before asking for anything.
  if (!user?.name && (portionsResult.count ?? 0) === 0) return 'Welcome';
  if (!user?.name) return 'Name';
  if ((portionsResult.count ?? 0) === 0) return 'Memorization';
  if (user.session_minutes == null) return 'Time';
  if (!user.gender) return 'Gender';
  if (!user.notification_time) return 'Notifications';
  return 'AllSet';
}
