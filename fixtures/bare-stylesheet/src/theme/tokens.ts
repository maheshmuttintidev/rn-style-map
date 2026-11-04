import { Platform } from 'react-native';

export const colors = {
  bg: '#F8FAFC',
  text: '#0F172A',
  muted: '#64748B',
  primary: '#2563EB',
  border: '#E2E8F0',
  white: '#FFFFFF',
};

export const space = { xs: 4, sm: 8, md: 16, lg: 24 };

export const radius = { md: 12, pill: 999 };

export const font = {
  regular: Platform.select({ ios: 'System', android: 'Roboto', default: 'System' }),
  bold: Platform.select({ ios: 'System', android: 'Roboto-Bold', default: 'System' }),
};
