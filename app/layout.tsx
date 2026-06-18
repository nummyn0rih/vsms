import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";

// Self-hosted Geist (variable woff2, включает кириллицу) — без внешнего
// рантайм-fetch. Variable-файл покрывает все нужные веса (400/500/600).
const geistSans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-geist",
  display: "swap",
  weight: "400 600",
  fallback: ["Inter", "system-ui", "-apple-system", "sans-serif"],
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  variable: "--font-geist-mono",
  display: "swap",
  weight: "400 500",
});

export const metadata: Metadata = {
  title: "VSMS",
  description: "Система управления поставками овощного сырья",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
