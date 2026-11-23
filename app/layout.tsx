import type { Metadata, Viewport } from "next";
import { Tajawal } from "next/font/google";
import "./globals.css";
import SessionProvider from "@/components/SessionProvider";
import SessionWatcher from "@/components/SessionWatcher";
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
    icon: [
      { url: "/pwa/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: { url: "/pwa/apple-touch-icon.png", sizes: "180x180" },
  },
  appleWebApp: {
    capable: true,
    title: "مليحة",
    statusBarStyle: "default",
  },
};

// Chrome can fire `beforeinstallprompt` before React hydrates; keep the event
// so the install badge and buttons (usePwaInstallPrompt) can use it later.
const CAPTURE_INSTALL_PROMPT = `addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__installPrompt=e;document.dispatchEvent(new Event("installable"))});`;

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
        <script dangerouslySetInnerHTML={{ __html: CAPTURE_INSTALL_PROMPT }} />
      </head>
      <body className={`${tajawal.variable} antialiased`} suppressHydrationWarning>
        <DirectionProvider>
          <ToastProvider>
            <TooltipProvider>
              <SessionProvider>
                <SessionWatcher />
                {children}
                <PwaProvider />
              </SessionProvider>
            </TooltipProvider>
            <Toaster />
          </ToastProvider>
        </DirectionProvider>
      </body>
    </html>
  );
}
