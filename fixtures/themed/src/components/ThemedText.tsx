import { Text, type TextProps } from 'react-native';
import { useThemeColor } from '@/hooks/useThemeColor';
import { Fonts } from '@/constants/theme';

export function ThemedText({ style, type = 'default', ...rest }: TextProps & { type?: 'default' | 'title' }) {
  const color = useThemeColor({}, 'text');
  return <Text style={[{ color, fontFamily: Fonts.sans }, type === 'title' ? { fontSize: 32, fontWeight: 'bold', lineHeight: 32 } : { fontSize: 16, lineHeight: 24 }, style]} {...rest} />;
}
