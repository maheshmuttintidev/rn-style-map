import { View } from 'react-native';
import { useThemeColor } from '@/hooks/useThemeColor';
import { ThemedText } from '@/components/ThemedText';

export default function Profile() {
  const bg = useThemeColor({ light: '#FAFAFA', dark: '#0B0B0B' }, 'background');
  const border = useThemeColor({}, 'border');
  return (
    <View style={{ flex: 1, backgroundColor: bg, padding: 20 }}>
      <View style={{ borderWidth: 1, borderColor: border, borderRadius: 16, padding: 16 }}>
        <ThemedText type="title">Profile</ThemedText>
        <ThemedText>Signed in</ThemedText>
      </View>
    </View>
  );
}
