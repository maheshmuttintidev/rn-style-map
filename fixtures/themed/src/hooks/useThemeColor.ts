import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/theme';

// Legacy template helper
export function useThemeColor(props: { light?: string; dark?: string }, colorName: keyof typeof Colors.light & keyof typeof Colors.dark) {
  const theme = useColorScheme() ?? 'light';
  const fromProps = props[theme];
  if (fromProps) return fromProps;
  return Colors[theme][colorName];
}
