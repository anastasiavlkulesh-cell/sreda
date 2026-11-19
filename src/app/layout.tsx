import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "СРЕДА — управление качеством бизнеса", template: "%s · СРЕДА" },
  description: "Интеллектуальная система управления качеством бизнеса: диагностика SERVICE 5D, анализ первопричин, план улучшений и контроль результата.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0F172A", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
