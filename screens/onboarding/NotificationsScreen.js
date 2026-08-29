import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import OnboardingProgressDots from '../../components/OnboardingProgressDots';
import { colors, fonts, spacing } from '../../lib/theme';

const LOGO = require('../../assets/logo.png');

export default function NotificationsScreen({ route, navigation }) {
  const name = route?.params?.name ?? 'there';
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }),
    ]).start();
  }, [opacity, scale]);

  // The answer was thrown away: whatever iOS said, the next screen appeared and
  // asked what time to be reminded, having no way to remind anyone. Someone who
  // tapped Don't Allow, or who had refused once before so no dialog appeared at
  // all, set a time that could never fire and was told nothing.
  const handleEnable = async () => {
    const { status, canAskAgain } = await Notifications.getPermissionsAsync();
    let granted = status === 'granted';

    if (!granted && canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.status === 'granted';
    }

    if (granted) {
      setDenied(false);
      navigation.navigate('ReminderTime', { name });
      return;
    }
    setDenied(true);
  };

  const handleSkip = () => {
    navigation.navigate('AllSet', { name });
  };

  const [denied, setDenied] = useState(false);

  return (
    <Animated.View style={[styles.screen, { opacity }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <OnboardingProgressDots current={5} total={7} />
        <Text style={styles.step}>Step 6 of 7</Text>
        <Text style={styles.question}>Stay on track</Text>
        <Text style={styles.sub}>We'll send you a gentle nudge at your chosen time.</Text>
      </View>

      <Animated.View style={[styles.illustration, { transform: [{ scale }] }]}>
        <View style={styles.notifCard}>
          <View style={styles.notifRow}>
            <View style={styles.notifIcon}>
              <Image source={LOGO} style={styles.notifLogoImg} />
            </View>
            <View style={styles.notifBody}>
              <Text style={styles.notifTitle}>Dawrah · now</Text>
              <Text style={styles.notifMsg}>Time for your revision, {name}. ✦</Text>
            </View>
          </View>
        </View>
        <Text style={styles.illuCaption}>You'll see something like this each day</Text>
      </Animated.View>

      <View style={styles.footer}>
        {denied ? (
          <View style={styles.deniedBox}>
            <Text style={styles.deniedText}>
              iOS is blocking notifications for Dawrah, so a reminder cannot be
              set from here. Turn them on in Settings and this will work.
            </Text>
            <TouchableOpacity onPress={() => Linking.openSettings()} activeOpacity={0.7}>
              <Text style={styles.deniedLink}>Open Settings</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        <TouchableOpacity style={styles.primaryBtn} onPress={handleEnable} activeOpacity={0.88}>
          <Text style={styles.primaryBtnText}>
            {denied ? 'Try again' : 'Enable reminders'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.skipBtn} onPress={handleSkip} activeOpacity={0.7}>
          <Text style={styles.skipBtnText}>
            {denied ? 'Continue without reminders' : 'Maybe later'}
          </Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingTop: 64, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  backBtn: { paddingBottom: spacing.sm, alignSelf: 'flex-start' },
  backBtnText: { fontFamily: fonts.medium, fontSize: 14, color: colors.textMid },
  step: {
    fontFamily: fonts.medium, fontSize: 13, color: colors.textMuted,
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm,
  },
  question: {
    fontFamily: fonts.semiBold, fontSize: 26, color: colors.text,
    letterSpacing: -0.3, marginBottom: spacing.sm, lineHeight: 34,
  },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMid, lineHeight: 21 },
  illustration: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  notifCard: {
    backgroundColor: colors.card, borderRadius: 16, padding: spacing.md, width: '100%',
    shadowColor: colors.text, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1, shadowRadius: 20, elevation: 6, marginBottom: spacing.md,
  },
  notifRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  notifIcon: {
    width: 44, height: 44, borderRadius: 12,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  notifLogoImg: {
    width: 26, height: 26, resizeMode: 'contain', tintColor: colors.white,
  },
  notifBody: { flex: 1 },
  notifTitle: { fontFamily: fonts.semiBold, fontSize: 13, color: colors.text, marginBottom: 3 },
  notifMsg: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMid },
  illuCaption: { fontFamily: fonts.regular, fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: 48, paddingTop: spacing.md, gap: 8 },
  deniedBox: {
    backgroundColor: colors.accentLight,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  deniedText: {
    fontFamily: fonts.regular, fontSize: 14, color: colors.textMid, lineHeight: 21,
  },
  deniedLink: {
    fontFamily: fonts.semiBold, fontSize: 15, color: colors.primary, marginTop: spacing.sm,
  },
  primaryBtn: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 17, alignItems: 'center' },
  primaryBtnText: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.white },
  skipBtn: { paddingVertical: 14, alignItems: 'center' },
  skipBtnText: { fontFamily: fonts.medium, fontSize: 15, color: colors.textMid },
});
