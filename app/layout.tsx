import type { Metadata, Viewport } from "next";
import { Tajawal } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/SessionProvider";
import DirectionProvider from "@/components/DirectionProvider";
import PwaProvider from "@/components/PwaProvider";
import { ToastProvider } from "@/components/ui/use-toast";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

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
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#11101a",
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
        <DirectionProvider>
          <ToastProvider>
            <TooltipProvider>
              <SessionProvider>
                {children}
              </SessionProvider>
            </TooltipProvider>
            <Toaster />
          </ToastProvider>
        </DirectionProvider>
        <PwaProvider />
      </body>
    </html>
  );
}
