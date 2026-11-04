import { Pressable, Text } from 'react-native';
import { cn } from '@/lib/cn';

type Props = { title: string; variant?: 'primary' | 'ghost'; onPress?: () => void };

export function Button({ title, variant = 'primary', onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      className={cn('h-12 items-center justify-center rounded-xl px-4', variant === 'primary' ? 'bg-brand' : 'border border-brand bg-transparent')}
    >
      <Text className={cn('font-display text-base', variant === 'primary' ? 'text-white' : 'text-brand')}>{title}</Text>
    </Pressable>
  );
}
