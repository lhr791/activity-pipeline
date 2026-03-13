import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crypto Events Aggregator",
  description: "币圈交易所活动整合 — 跨频道去重汇总",
};

export const revalidate = 60; // ISR: revalidate every 60 seconds

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark">
      <head>
        <link
          href="https://cdn.jsdelivr.net/npm/alibaba-puhuiti-webfont@1.0.3/china/css/AlibabaPuHuiTi-3-55-Regular.min.css"
          rel="stylesheet"
        />
        <link
          href="https://cdn.jsdelivr.net/npm/alibaba-puhuiti-webfont@1.0.3/china/css/AlibabaPuHuiTi-3-65-Medium.min.css"
          rel="stylesheet"
        />
        <link
          href="https://cdn.jsdelivr.net/npm/alibaba-puhuiti-webfont@1.0.3/china/css/AlibabaPuHuiTi-3-75-SemiBold.min.css"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased bg-black" suppressHydrationWarning>{children}</body>
    </html>
  );
}
