"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

interface AutoRefreshProps {
  interval?: number;
}

export function AutoRefresh({ interval = 15000 }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), interval);
    return () => clearInterval(id);
  }, [router, interval]);

  return null;
}
