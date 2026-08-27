import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#ff5c8a' },
    secondary: { main: '#7c5cff' },
    background: { default: '#12111a', paper: '#1c1a29' },
    success: { main: '#35d399' },
    error: { main: '#ff5c5c' },
    text: { primary: '#f4f2fb', secondary: '#a9a5c0' },
  },
  shape: { borderRadius: 20 },
  typography: {
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      'Helvetica',
      'Arial',
      'sans-serif',
    ].join(','),
    button: { textTransform: 'none', fontWeight: 700 },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 14, padding: '14px', fontSize: 16 },
        containedPrimary: {
          background: 'linear-gradient(135deg, #ff5c8a, #7c5cff)',
          '&:hover': { background: 'linear-gradient(135deg, #ff5c8a, #7c5cff)' },
        },
      },
    },
    MuiTextField: {
      defaultProps: { fullWidth: true },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        'html, body': {
          height: '100%',
          overscrollBehavior: 'none',
        },
        body: {
          background: 'radial-gradient(circle at top, #241f38, #100f18 65%)',
        },
      },
    },
  },
});

export default theme;
