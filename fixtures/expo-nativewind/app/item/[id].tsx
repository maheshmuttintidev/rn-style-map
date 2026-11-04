import { View, Text, Image } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

export default function Item() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <View className="flex-1 bg-white dark:bg-ink">
      <Image source={{ uri: 'https://example.com/a.png' }} className="h-56 w-full" />
      <View className="p-5">
        <Text className="font-display text-2xl text-ink dark:text-white">Item {id}</Text>
        <Text className="mt-2 text-base leading-6 text-zinc-600 dark:text-zinc-300">A sample detail page with a hero image.</Text>
        <View className="mt-4 self-start rounded-full bg-brand/10 px-3 py-1">
          <Text className="text-xs font-semibold text-brand">NEW</Text>
        </View>
      </View>
    </View>
  );
}
