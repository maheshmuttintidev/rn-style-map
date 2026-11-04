import { StyleSheet, Text, View } from 'react-native';
import { useInk } from '@/context/ThemeProvider';

function getStyles(isDark: boolean, ink: { surface: string; ink: string; accent: string; line: string }) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: ink.surface, paddingHorizontal: 16, paddingTop: 24 },
    title: { fontSize: 22, fontWeight: '700', color: ink.ink, marginBottom: 16 },
    row: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: ink.line },
    rowText: { fontSize: 16, color: isDark ? '#FFFFFF' : ink.ink },
    link: { fontSize: 14, color: ink.accent, marginTop: 24 },
  });
}

export default function Settings() {
  const { ink, isDark } = useInk();
  const styles = getStyles(isDark, ink);
  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Settings</Text>
      {['Account', 'Privacy', 'About'].map((label) => (
        <View key={label} style={styles.row}>
          <Text style={styles.rowText}>{label}</Text>
        </View>
      ))}
      <Text style={styles.link}>Sign out</Text>
    </View>
  );
}
