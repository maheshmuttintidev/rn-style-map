import { View, Text } from 'react-native';
import type { ReactNode } from 'react';

export default function Card({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View className="mb-3 rounded-2xl bg-surface p-4 dark:bg-zinc-900">
      <Text className="font-display text-lg text-ink dark:text-white">{title}</Text>
      {children}
    </View>
  );
}
