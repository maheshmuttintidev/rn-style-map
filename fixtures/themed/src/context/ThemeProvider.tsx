import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

const light = { surface: '#FFFFFF', ink: '#1B1B1F', accent: '#6750A4', line: '#CAC4D0' };
const dark = { surface: '#1C1B1F', ink: '#E6E1E5', accent: '#D0BCFF', line: '#49454F' };

type Ink = typeof light;
const ThemeContext = createContext<{ ink: Ink; isDark: boolean }>({ ink: light, isDark: false });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const isDark = useColorScheme() === 'dark';
  return <ThemeContext.Provider value={{ ink: isDark ? dark : light, isDark }}>{children}</ThemeContext.Provider>;
}

export function useInk() {
  return useContext(ThemeContext);
}
