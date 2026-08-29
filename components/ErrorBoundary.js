import { Component, Fragment } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { colors, fonts, radius, spacing } from '../lib/theme';

/**
 * Catches a render error anywhere below it and offers a way out.
 *
 * Without this, a single bad render unmounts the whole tree and leaves a blank
 * screen with no way back except force-quitting the app. Sentry reports that it
 * happened, which helps us and does nothing at all for the person holding the
 * phone mid-session.
 *
 * Recovery is a real remount rather than a re-render. Clearing the error alone
 * would drop them straight back onto the screen that just failed, which fails
 * again immediately. Changing the key unmounts everything below, including the
 * navigation container, so they land back at the start rather than in a loop.
 *
 * The reassurance in the message is true and worth saying: the resume marker is
 * written after every confirmed ayah, and the session row stays in progress, so
 * a crash mid-recitation costs at most the ayah that was being recited.
 */
export default class ErrorBoundary extends Component {
  state = { error: null, generation: 0 };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // The component stack is the useful part: it names the screen that failed,
    // which the error alone usually does not.
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info?.componentStack } },
    });
  }

  handleReset = () => {
    this.setState((s) => ({ error: null, generation: s.generation + 1 }));
  };

  render() {
    const { error, generation } = this.state;

    if (!error) {
      return <Fragment key={generation}>{this.props.children}</Fragment>;
    }

    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>Something went wrong</Text>

          <Text style={styles.body}>
            Dawrah hit an error it could not recover from on its own. It has been
            reported to us automatically, with no part of your recitation
            attached.
          </Text>

          <Text style={styles.body}>
            Your progress is safe. Every ayah you finished was saved as you went,
            so a session interrupted here picks up from the last one you
            completed.
          </Text>

          {__DEV__ ? (
            <View style={styles.devBox}>
              <Text style={styles.devLabel}>DEV ONLY</Text>
              <Text style={styles.devText}>{String(error?.message ?? error)}</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.btn} onPress={this.handleReset} activeOpacity={0.88}>
            <Text style={styles.btnText}>Back to home</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: 80,
    paddingBottom: spacing.lg,
  },
  title: {
    fontFamily: fonts.semiBold,
    fontSize: 26,
    color: colors.text,
    letterSpacing: -0.3,
    marginBottom: spacing.md,
  },
  body: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textMid,
    marginBottom: spacing.md,
  },
  devBox: {
    backgroundColor: colors.errorLight,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  devLabel: {
    fontFamily: fonts.semiBold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.error,
    marginBottom: 6,
  },
  devText: { fontFamily: fonts.regular, fontSize: 13, color: colors.error, lineHeight: 19 },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: 48, paddingTop: spacing.sm },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
  },
  btnText: { fontFamily: fonts.semiBold, fontSize: 17, color: colors.white },
});
