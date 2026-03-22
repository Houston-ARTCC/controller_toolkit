"use client";

import { useSyncExternalStore } from "react";

function resolveTheme(mode) {
  if (mode !== "system") {
    return mode;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const THEME_MODE_CHANGE_EVENT = "theme-mode-change";

function readThemeMode() {
  if (typeof window === "undefined") {
    return "system";
  }
  return (
    document.documentElement.getAttribute("data-theme-mode") ||
    localStorage.getItem("theme-mode") ||
    "system"
  );
}

function subscribeToThemeMode(onStoreChange) {
  if (typeof window === "undefined") {
    return () => {};
  }
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => onStoreChange();
  window.addEventListener(THEME_MODE_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  mediaQuery.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(THEME_MODE_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    mediaQuery.removeEventListener("change", onChange);
  };
}

export default function ThemeSwitcher() {
  const mode = useSyncExternalStore(subscribeToThemeMode, readThemeMode, () => "system");

  const applyMode = (nextMode) => {
    localStorage.setItem("theme-mode", nextMode);
    document.documentElement.setAttribute("data-theme-mode", nextMode);
    document.documentElement.setAttribute("data-theme", resolveTheme(nextMode));
    window.dispatchEvent(new Event(THEME_MODE_CHANGE_EVENT));
  };

  const options = [
    { mode: "system", label: "Auto", shortLabel: "Auto" },
    { mode: "light", label: "Sun", shortLabel: "☀" },
    { mode: "dark", label: "Moon", shortLabel: "☾" },
  ];

  return (
    <div className="theme-switcher" role="group" aria-label="Theme Mode">
      {options.map((option) => (
        <button
          aria-pressed={mode === option.mode}
          className={`theme-mode-button ${mode === option.mode ? "theme-mode-button-active" : ""}`}
          key={option.mode}
          onClick={() => applyMode(option.mode)}
          title={option.label}
          type="button"
        >
          {option.shortLabel}
        </button>
      ))}
    </div>
  );
}
