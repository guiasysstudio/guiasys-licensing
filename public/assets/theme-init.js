(() => {
  "use strict";

  const STORAGE_KEY = "gsl.theme.v1";
  const VALID_THEMES = new Set(["light", "dark"]);
  const THEME_COLORS = Object.freeze({ light: "#FFFAEF", dark: "#0C171F" });
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

  function readStoredTheme() {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return VALID_THEMES.has(value) ? value : null;
    } catch {
      return null;
    }
  }

  function preferredTheme() {
    return mediaQuery.matches ? "dark" : "light";
  }

  function syncToggle(theme) {
    const toggle = document.querySelector("#theme-toggle");
    if (!toggle) return;
    const nextTheme = theme === "dark" ? "light" : "dark";
    const label = nextTheme === "light" ? "Ativar modo claro" : "Ativar modo escuro";
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
    toggle.setAttribute("aria-pressed", String(theme === "light"));
  }

  function applyTheme(theme, { persist = false } = {}) {
    const resolved = VALID_THEMES.has(theme) ? theme : preferredTheme();
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[resolved]);
    syncToggle(resolved);
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, resolved);
      } catch {
        // A preferência continua aplicada nesta sessão quando o storage está indisponível.
      }
    }
    return resolved;
  }

  function initializeToggle() {
    const toggle = document.querySelector("#theme-toggle");
    if (!toggle || toggle.dataset.themeBound === "true") return;
    toggle.dataset.themeBound = "true";
    syncToggle(document.documentElement.dataset.theme || preferredTheme());
    toggle.addEventListener("click", () => {
      const current = document.documentElement.dataset.theme || preferredTheme();
      applyTheme(current === "dark" ? "light" : "dark", { persist: true });
    });
  }

  function followSystemTheme() {
    if (!readStoredTheme()) applyTheme(preferredTheme());
  }

  if (typeof mediaQuery.addEventListener === "function") mediaQuery.addEventListener("change", followSystemTheme);
  else if (typeof mediaQuery.addListener === "function") mediaQuery.addListener(followSystemTheme);

  applyTheme(readStoredTheme() || preferredTheme());
  window.GSLTheme = Object.freeze({ initializeToggle });
  document.addEventListener("DOMContentLoaded", initializeToggle, { once: true });
})();
