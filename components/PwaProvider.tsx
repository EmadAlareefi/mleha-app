'use client';

import { useEffect } from "react";

const SERVICE_WORKER_URL = "/service-worker.js";

export default function PwaProvider() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    let registration: ServiceWorkerRegistration | undefined;

    const registerServiceWorker = async () => {
      try {
        registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL);

        if (process.env.NODE_ENV === "development") {
          console.info("Service worker registered", registration);
        }
      } catch (error) {
        console.error("Service worker registration failed", error);
      }
    };

    if (document.readyState === "complete") {
      registerServiceWorker();
    } else {
      window.addEventListener("load", registerServiceWorker);
    }

    return () => {
      window.removeEventListener("load", registerServiceWorker);
      registration?.unregister?.();
    };
  }, []);

  return null;
}
