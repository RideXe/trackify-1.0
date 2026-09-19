'use client';

import { createTheme } from '@mui/material/styles';

export const trackifyTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#155EEF', dark: '#004EEB', contrastText: '#FFFFFF' },
    secondary: { main: '#0E9384' },
    background: { default: '#F5F7FA', paper: '#FFFFFF' },
    text: { primary: '#101828', secondary: '#667085' },
    divider: '#E4E7EC',
    success: { main: '#079455' },
    warning: { main: '#DC6803' },
    error: { main: '#D92D20' },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    h1: { fontWeight: 750, letterSpacing: '-0.04em' },
    h2: { fontWeight: 700, letterSpacing: '-0.025em' },
    h3: { fontWeight: 700, letterSpacing: '-0.02em' },
    h4: { fontWeight: 700, letterSpacing: '-0.02em' },
    button: { fontWeight: 650, textTransform: 'none' },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { minHeight: 42, borderRadius: 10 } },
    },
    MuiCard: { styleOverrides: { root: { border: '1px solid #E4E7EC', boxShadow: 'none' } } },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 18 } } },
    MuiTextField: { defaultProps: { size: 'small' } },
  },
});
