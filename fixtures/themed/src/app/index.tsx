import { StyleSheet, View, Pressable, Text } from 'react-native';
import { scale, scaleHeight } from '@shayrn/react-native-scaler';
import { useTheme } from '@/hooks/use-theme';
import { ThemedText } from '@/components/ThemedText';

export default function Home() {
  const theme = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ThemedText type="title">Welcome</ThemedText>
      <ThemedText style={{ color: theme.icon }}>Edit src/app/index.tsx to start.</ThemedText>
      <Pressable accessibilityRole="button" accessibilityLabel="Get started" style={[styles.cta, { backgroundColor: theme.tint }]}>
        <Text style={[styles.ctaText, { color: theme.background }]}>Get started</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: scale(24), gap: scaleHeight(12) },
  cta: { height: scale(48), borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  ctaText: { fontSize: 16, fontWeight: '600' },
});
