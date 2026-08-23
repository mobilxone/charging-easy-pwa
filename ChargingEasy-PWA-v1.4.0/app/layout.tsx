import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://charging-easy-pwa.qd5pbx6jbr.chatgpt.site"),
  title: "充電易 PWA",
  description: "记录电动车充电、高速和停车费用，并查看月度与年度汇总。",
  applicationName: "充電易",
  manifest: "/pwa/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "充電易",
  },
  icons: {
    icon: "/pwa/icons/icon-192.png",
    shortcut: "/pwa/icons/icon-192.png",
    apple: "/pwa/icons/apple-touch-icon.png",
  },
  openGraph: {
    title: "充電易 PWA",
    description: "充电、高速与停车，每一笔都清清楚楚。",
    url: "/pwa/index.html",
    siteName: "充電易",
    locale: "zh_CN",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "充電易 PWA — 充电、高速与停车，每一笔都清清楚楚",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "充電易 PWA",
    description: "充电、高速与停车，每一笔都清清楚楚。",
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#F7F7F8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
