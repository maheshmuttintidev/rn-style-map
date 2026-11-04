import { Stack } from 'expo-router';
import { ThemeProvider } from '@/context/ThemeProvider';

export default function Layout() {
  return (
    <ThemeProvider>
      <Stack />
    </ThemeProvider>
  );
}
