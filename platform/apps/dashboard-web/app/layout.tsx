import type { Metadata } from 'next';
import './styles.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Trackify Fleet',
  description: 'Live fleet operations for dispatch teams',
};

export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
