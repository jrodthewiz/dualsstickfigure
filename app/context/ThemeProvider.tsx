"use client";

import React, { createContext, useContext, PropsWithChildren } from 'react';
import { theme, Theme } from "../theme/tokens";

const ThemeContext = createContext<Theme>(theme);

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: PropsWithChildren<{}>) {
  return (
    <ThemeContext.Provider value={theme}>
      {children}
    </ThemeContext.Provider>
  );
}


