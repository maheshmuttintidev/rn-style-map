import { ScrollView, Text, View } from 'react-native';
import Card from '@/components/Card';
import { Button } from '@/components/Button';

const ITEMS = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Beta' },
  { id: '3', name: 'Gamma' },
];

export default function Home() {
  return (
    <ScrollView className="flex-1 bg-white dark:bg-ink" contentContainerClassName="p-4 pb-12">
      <Text className="mb-4 font-display text-2xl text-ink dark:text-white">Home</Text>
      {ITEMS.map((item) => (
        <Card key={item.id} title={item.name}>
          <Text className="mt-1 text-sm text-zinc-500">Item {item.id}</Text>
        </Card>
      ))}
      <View className="mt-6 flex-row gap-3">
        <Button title="New" />
        <Button title="Filter" variant="ghost" />
      </View>
    </ScrollView>
  );
}
