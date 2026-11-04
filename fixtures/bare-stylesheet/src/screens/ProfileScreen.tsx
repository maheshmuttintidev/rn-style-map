import { Image, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '@theme/tokens';

const AVATAR = 72;

export default function ProfileScreen() {
  return (
    <View style={styles.container}>
      <Image source={require('../../assets/avatar.png')} style={styles.avatar} />
      <Text style={styles.name}>Ada Lovelace</Text>
      <Text style={styles.meta}>Joined 2024</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>PRO</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', paddingTop: space.lg * 2, backgroundColor: colors.bg },
  avatar: { width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 },
  name: { marginTop: space.md, fontSize: 22, fontWeight: 'bold', color: colors.text },
  meta: { marginTop: space.xs, fontSize: 13, color: colors.muted },
  badge: { marginTop: space.sm, paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: colors.primary + '1A' },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.primary },
});
