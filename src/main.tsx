import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";

// localStorage keys from before the app was named KlikReel. Moved before the
// stores are created (App's imports create them), so settings carry over.
const RENAMED_KEYS = { "aive-settings-v2": "klikreel-settings", "aive-locale": "klikreel-locale" };

function renameStorageKeys() {
  try {
    for (const [from, to] of Object.entries(RENAMED_KEYS)) {
      const value = localStorage.getItem(from);
      if (value === null) continue;
      if (localStorage.getItem(to) === null) localStorage.setItem(to, value);
      localStorage.removeItem(from);
    }
  } catch {
    // Storage unavailable: the stores start from their defaults.
  }
}

async function boot() {
  renameStorageKeys();
  if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) await import("./dev/browserMock");
  const { default: App } = await import("./App");
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

boot();
