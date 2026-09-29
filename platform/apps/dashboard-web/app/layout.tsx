import type { Metadata } from 'next';
import './styles.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Trackify Fleet',
  description: 'Live fleet operations for dispatch teams',
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // Browser extensions (dark-mode ones like Night Eye) add attributes to <html> before React loads.
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
