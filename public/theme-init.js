(() => {
  const storedMode = localStorage.getItem("theme-mode") || "system";
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = storedMode === "system" ? (prefersDark ? "dark" : "light") : storedMode;
  document.documentElement.setAttribute("data-theme-mode", storedMode);
  document.documentElement.setAttribute("data-theme", resolved);
})();
