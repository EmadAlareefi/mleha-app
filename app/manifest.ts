import type { MetadataRoute } from "next";

const BRAND_BACKGROUND = "#eee2d4";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "متجر مليحة للفساتين",
    short_name: "مليحة",
    description: "نظام إدارة طلبات متجر مليحة",
    lang: "ar",
    dir: "rtl",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    theme_color: "#11101a",
    // Matches the icons, so the launch splash screen is seamless.
    background_color: BRAND_BACKGROUND,
    categories: ["business", "productivity"],
    prefer_related_applications: false,
    icons: [
      { src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/pwa/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "تجهيز الطلبات",
        short_name: "التجهيز",
        description: "انتقل بسرعة إلى تجهيز الطلبات",
        url: "/order-prep?source=pwa-shortcut",
        icons: [{ src: "/pwa/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
