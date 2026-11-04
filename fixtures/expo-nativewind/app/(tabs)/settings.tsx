import { View, Text, Switch } from 'react-native';

export default function Settings() {
  return (
    <View className="flex-1 bg-white px-4 pt-8 dark:bg-ink">
      <Text className="mb-6 font-display text-xl text-ink dark:text-white">Settings</Text>
      <View className="flex-row items-center justify-between border-b border-zinc-200 py-3">
        <Text className="text-base text-ink dark:text-zinc-100">Dark mode</Text>
        <Switch trackColor={{ true: '#7C3AED', false: '#E4E4E7' }} />
      </View>
      <Text className="mt-8 text-xs text-zinc-400" allowFontScaling={false}>
        v1.0.0
      </Text>
    </View>
  );
}
