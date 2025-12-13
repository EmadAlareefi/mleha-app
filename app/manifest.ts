import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "متجر مليحة للفساتين",
    short_name: "مليحة",
    description: "نظام إدارة طلبات متجر مليحة",
    start_url: "/",
    scope: "/",
    dir: "rtl",
    lang: "ar",
    display: "standalone",
    orientation: "portrait",
    theme_color: "#11101a",
    background_color: "#ffffff",
    categories: ["shopping", "productivity"],
    icons: [
      {
        src: "/logo.png",
        type: "image/png",
        sizes: "192x192",
        purpose: "maskable",
      },
      {
        src: "/logo.png",
        type: "image/png",
        sizes: "512x512",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "الطلبات الحالية",
        short_name: "الطلبات",
        description: "انتقل بسرعة إلى إدارة الطلبات",
        url: "/order-prep",
        icons: [{ src: "/logo.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
