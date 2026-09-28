import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Banana Bank · A little brighter, every day',
  description: 'A simulated banking environment for the Banana challenge.',
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
