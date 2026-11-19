import type { Metadata, Viewport } from 'next';
import { RoomProvider } from './context/RoomContext';
import { GameProvider } from './context/GameContext';
import { ThemeProvider } from './context/ThemeProvider';
import './theme/css-vars.css';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'Stickfigure Mayhem',
  description: 'Fight bots or invite a friend to a fast-paced platform brawler.',
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
          <RoomProvider>
            <GameProvider>
              {children}
            </GameProvider>
          </RoomProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
