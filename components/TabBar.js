import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fonts } from '../lib/theme';

const TABS = [
  { id: 'home', icon: '◎', label: 'Home', screen: 'Today' },
  { id: 'summary', icon: '✦', label: 'Summary', screen: 'SessionSummary' },
  { id: 'settings', icon: '⊙', label: 'Settings', screen: 'Settings' },
];

export default function TabBar({ active, navigation }) {
  return (
    <View style={styles.tabBar}>
      {TABS.map((t) => (
        <TouchableOpacity
          key={t.id}
          style={styles.tabItem}
          onPress={() => t.id !== active && navigation.navigate(t.screen)}
          activeOpacity={0.7}
        >
          <Text style={[styles.tabIcon, t.id === active && styles.tabIconActive]}>{t.icon}</Text>
          <Text style={[styles.tabLabel, t.id === active && styles.tabLabelActive]}>{t.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: 28,
    paddingTop: 12,
  },
  tabItem: { flex: 1, alignItems: 'center', gap: 4 },
  tabIcon: { fontSize: 20, color: colors.textMuted },
  tabIconActive: { color: colors.primary },
  tabLabel: { fontFamily: fonts.medium, fontSize: 11, color: colors.textMuted },
  tabLabelActive: { color: colors.primary },
});
