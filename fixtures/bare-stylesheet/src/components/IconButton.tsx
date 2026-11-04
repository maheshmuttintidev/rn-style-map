import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../theme/tokens';

export function IconButton({ glyph, onPress }: { glyph: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={styles.btn}>
      <Text style={styles.glyph}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  glyph: { fontSize: 18, color: colors.primary },
});
