import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { colors, font, radius, space } from '@theme/tokens';

function Row({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <View style={[styles.row, styles.divider]}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  return (
    <View style={styles.container}>
      <Row label="Notifications">
        <Switch thumbColor={colors.white} trackColor={{ true: colors.primary, false: colors.border }} />
      </Row>
      <Row label="Language">
        <Text style={styles.value}>English</Text>
      </Row>
      <TouchableOpacity accessibilityRole="button" style={styles.signOut}>
        <Text style={[styles.label, { color: colors.white, textAlign: 'center' }]}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: space.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  label: { fontSize: 16, fontFamily: font.regular, color: colors.text },
  value: { fontSize: 15, color: colors.muted },
  signOut: { marginTop: space.lg, height: 48, borderRadius: radius.md, backgroundColor: colors.primary, justifyContent: 'center' },
});
