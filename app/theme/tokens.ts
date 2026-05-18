export type Theme = {
  palette: {
    neutralBlack: string;
    neutral900: string;
    neutral850: string;
    neutral800: string;
    neutral700: string;
    neutral600: string;
    neutral500: string;
    neutral400: string;
    neutral300: string;
    neutral200: string;
    neutral150: string;
    neutral120: string;
    neutral100: string;
    neutral050: string;
    neutralWhite: string;
    accentPrimary: string;
    accentPrimarySoft: string;
    success: string;
    warning: string;
    error: string;
  };
  text: {
    primary: string;
    muted: string;
    inverse: string;
  };
  surface: {
    base: string;
    raised: string;
    sunken: string;
    paper: string;
    paperNoiseOpacity: number;
  };
  border: {
    strong: string;
    soft: string;
    bevelLight: string;
    bevelDark: string;
  };
  shadow: {
    window: string;
    glowAccent: string;
    glowWhite: string;
  };
  radius: {
    none: number;
    small: number;
    medium: number;
  };
  space: number[];
  gradient: {
    surface: string;
    titlebar: string;
  };
  hud: {
    panelTop: string;
    panelBottom: string;
    bubbleTop: string;
    bubbleBottom: string;
    borderStrong: string;
    borderSoft: string;
    glow: string;
    accent: string;
    accentSoft: string;
    accentMuted: string;
    foreground: string;
    foregroundMuted: string;
    chipFill: string;
    chipStroke: string;
    caption: string;
    captionMuted: string;
    warning: string;
    warningGlow: string;
  };
};

export const theme: Theme = {
  palette: {
    neutralBlack: '#000000',
    neutral900: '#0a0a0a',
    neutral850: '#121212',
    neutral800: '#161616',
    neutral700: '#222222',
    neutral600: '#2d2d2d',
    neutral500: '#444444',
    neutral400: '#666666',
    neutral300: '#8a8a8a',
    neutral200: '#b0b0b0',
    neutral150: '#c8c8c8',
    neutral120: '#dcdcdc',
    neutral100: '#ebebeb',
    neutral050: '#f2f2f2',
    neutralWhite: '#ffffff',
    accentPrimary: '#66ccff',
    accentPrimarySoft: '#9bdcff',
    success: '#98f5c2',
    warning: '#ffcc66',
    error: '#ff4d4d',
  },
  text: {
    primary: 'var(--neutral-050)',
    muted: 'var(--neutral-150)',
    inverse: 'var(--neutral-800)',
  },
  surface: {
    base: 'var(--neutral-850)',
    raised: 'var(--neutral-800)',
    sunken: 'var(--neutral-900)',
    paper: 'var(--neutral-White, #ffffff)',
    paperNoiseOpacity: 0.04,
  },
  border: {
    strong: 'rgba(255,255,255,0.40)',
    soft: 'rgba(255,255,255,0.18)',
    bevelLight: 'rgba(255,255,255,0.35)',
    bevelDark: 'rgba(0,0,0,0.55)',
  },
  shadow: {
    window: '0 2px 8px rgba(0,0,0,0.5)',
    glowAccent: 'rgba(102,204,255,0.35)',
    glowWhite: 'rgba(255,255,255,0.35)',
  },
  radius: {
    none: 0,
    small: 3,
    medium: 6,
  },
  space: [0, 2, 4, 6, 8, 12, 16, 20, 24],
  gradient: {
    surface: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(0,0,0,0.06) 100%)',
    titlebar: 'linear-gradient(180deg, rgba(255,255,255,0.12), rgba(0,0,0,0.12))',
  },
  hud: {
    panelTop: 'rgba(18,18,18,0.94)',
    panelBottom: 'rgba(6,6,6,0.96)',
    bubbleTop: 'rgba(20,20,20,0.94)',
    bubbleBottom: 'rgba(10,10,10,0.96)',
    borderStrong: 'rgba(255,255,255,0.4)',
    borderSoft: 'rgba(255,255,255,0.18)',
    glow: 'rgba(255,255,255,0.35)',
    accent: '#f7f7f7',
    accentSoft: '#dcdcdc',
    accentMuted: '#b0b0b0',
    foreground: '#f2f2f2',
    foregroundMuted: '#c8c8c8',
    chipFill: 'rgba(255,255,255,0.08)',
    chipStroke: 'rgba(255,255,255,0.3)',
    caption: '#ebebeb',
    captionMuted: '#b8b8b8',
    warning: '#ff4d4d',
    warningGlow: 'rgba(255,77,77,0.75)',
  },
};

export type ThemeKey = keyof typeof theme;


