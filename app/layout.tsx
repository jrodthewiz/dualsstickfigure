import { AblyContextProvider } from './context/AblyContext';
import { GameProvider } from './context/GameContext';
import { ThemeProvider } from './context/ThemeProvider';
import './theme/css-vars.css';

export const metadata = {
  viewport: {
    width: 'device-width',
    initialScale: 1,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" style={{ margin: 0, padding: 0, overflow: 'hidden', width: '100%', height: '100%' }}>
      <body style={{ margin: 0, padding: 0, overflow: 'hidden', width: '100%', height: '100%' }}>
        <ThemeProvider>
          <AblyContextProvider>
            <GameProvider>
              {children}
            </GameProvider>
          </AblyContextProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
