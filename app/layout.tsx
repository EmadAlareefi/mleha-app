import type { Metadata } from "next";
import { Tajawal } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/SessionProvider";
import PwaProvider from "@/components/PwaProvider";

const tajawal = Tajawal({
  subsets: ["arabic"],
  weight: ["300", "400", "500", "700", "800", "900"],
  variable: "--font-tajawal",
  display: "swap",
});

export const metadata: Metadata = {
  title: "متجر مليحة للفساتين",
  description: "نظام إدارة طلبات متجر مليحة",
  applicationName: "متجر مليحة للفساتين",
  manifest: "/manifest.webmanifest",
  themeColor: "#11101a",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/logo.png" />
      </head>
      <body className={`${tajawal.variable} antialiased`} suppressHydrationWarning>
        <SessionProvider>
          {children}
        </SessionProvider>
        <PwaProvider />
      </body>
    </html>
  );
}
