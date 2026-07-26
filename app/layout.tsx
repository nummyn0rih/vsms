import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { auth } from "@/auth";
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
  // Google Translate уважает этот meta наравне с translate="no" на <html>.
  other: { google: "notranslate" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Сессия читается на сервере и отдаётся в SessionProvider — клиентские гейты
  // (RoleGate, доски приёмки, планировщик) знают роль уже на первом кадре.
  // Побочный эффект: layout становится динамическим (auth() читает куки) — ожидаемо,
  // приложение целиком за логином.
  const session = await auth();

  return (
    // Интерфейс полностью русский: lang="ru" + translate="no"/notranslate — чтобы
    // браузер и расширения-переводчики не переписывали текстовые узлы DOM
    // (переписанный DOM расходится с серверным HTML и ломает гидратацию).
    <html
      lang="ru"
      translate="no"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased notranslate`}
    >
      <body className="min-h-full flex flex-col">
        <Providers session={session}>{children}</Providers>
      </body>
    </html>
  );
}
