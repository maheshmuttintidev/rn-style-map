import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '@theme/tokens';

export default function Card({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.sm,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
  body: { fontSize: 15, lineHeight: 20, color: colors.muted, marginTop: space.xs },
});
