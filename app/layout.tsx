import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SRT Generator",
  description: "動画からSRT字幕ファイルを生成する最小構成のWebアプリ"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
