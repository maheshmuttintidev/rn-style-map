import { View, Text, TextInput, Pressable } from 'react-native';
import { scale, scaleFont } from '@shayrn/react-native-scaler';
import { Button } from '@/components/Button';

export default function Login() {
  return (
    <View className="flex-1 bg-white p-6 dark:bg-ink">
      <View className="mt-12 gap-4">
        <Text style={{ fontSize: scaleFont(28), lineHeight: scaleFont(34) }} className="font-display text-ink dark:text-white">
          Welcome back
        </Text>
        <Text className="font-body text-[15px] text-zinc-500">Sign in to continue</Text>
      </View>
      <TextInput placeholder="Email" placeholderTextColor="#A1A1AA" className="mt-6 h-12 rounded-xl border border-zinc-200 px-4 text-base" />
      <TextInput placeholder="Password" secureTextEntry className="mt-3 h-12 rounded-xl border border-zinc-200 px-4 text-base" />
      <View style={{ marginTop: scale(24) }}>
        <Button title="Sign in" />
      </View>
      <Pressable className="mt-4 p-2">
        <Text className="text-[13px] text-zinc-600 ios:text-zinc-500">Forgot password?</Text>
      </Pressable>
    </View>
  );
}
