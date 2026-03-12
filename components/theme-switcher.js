"use client";

import { useEffect, useState } from "react";

function resolveTheme(mode) {
  if (mode !== "system") {
    return mode;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export default function ThemeSwitcher() {
  const [mode, setMode] = useState(() => {
    if (typeof window === "undefined") {
      return "system";
    }
    return (
      document.documentElement.getAttribute("data-theme-mode") ||
      localStorage.getItem("theme-mode") ||
      "system"
    );
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const activeMode = document.documentElement.getAttribute("data-theme-mode") || "system";
      if (activeMode === "system") {
        document.documentElement.setAttribute("data-theme", resolveTheme("system"));
      }
    };

    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  const applyMode = (nextMode) => {
    setMode(nextMode);
    localStorage.setItem("theme-mode", nextMode);
    document.documentElement.setAttribute("data-theme-mode", nextMode);
    document.documentElement.setAttribute("data-theme", resolveTheme(nextMode));
  };

  return (
    <div className="theme-switcher">
      <label className="theme-label" htmlFor="theme-mode-select">
        Theme
      </label>
      <select
        className="theme-select"
        id="theme-mode-select"
        onChange={(event) => applyMode(event.target.value)}
        value={mode}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </div>
  );
}
