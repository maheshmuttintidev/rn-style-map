import { FlatList, Platform, StyleSheet, Text, View } from 'react-native';
import Card from '@components/Card';
import { IconButton } from '@components/IconButton';
import { colors, font, space } from '@theme/tokens';

const DATA = [
  { id: 'a', title: 'First', body: 'Hello from the first card' },
  { id: 'b', title: 'Second', body: 'And the second one' },
];

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.heading}>Home</Text>
        <IconButton glyph="+" />
      </View>
      <FlatList data={DATA} keyExtractor={(i) => i.id} renderItem={({ item }) => <Card title={item.title} body={item.body} />} contentContainerStyle={styles.list} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingTop: Platform.OS === 'ios' ? 56 : 24,
    paddingBottom: space.sm,
  },
  heading: { fontSize: 28, fontFamily: font.bold, color: colors.text },
  list: { padding: space.md },
});
