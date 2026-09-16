"use client";

import { useEffect, useState } from "react";
import { Icon } from "./Icons";
import { IconButton } from "./Button";

const STORAGE_KEY = "sentry_theme";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  if (typeof document === "undefined") return "light";
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark" || explicit === "light") return explicit;
  // No explicit choice yet — the page is following the OS preference via the
  // @media query in globals.css, so match that instead of defaulting to light.
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  // Mirrors whatever the inline bootstrap script in the root layout already applied
  // to <html data-theme>, so there's no flash on mount.
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable (private mode, etc.) — theme just won't persist.
    }
  }

  return (
    <IconButton label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"} onClick={toggle}>
      {theme === "dark" ? Icon.sun({ size: 16 }) : Icon.moon({ size: 16 })}
    </IconButton>
  );
}

// Inline script string, inserted via <script dangerouslySetInnerHTML> in the root
// layout's <head> so the correct theme is set before first paint (no light-mode flash
// for a user who chose dark). Reads the same localStorage key ThemeToggle writes.
export const THEME_BOOTSTRAP_SCRIPT = `
(function() {
  try {
    var stored = window.localStorage.getItem("${STORAGE_KEY}");
    if (stored === "dark" || stored === "light") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (e) {}
})();
`;
