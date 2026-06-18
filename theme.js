// ============================================================
// FLOW — theme.js
// Defines color themes and applies them via CSS custom properties.
// Shared across all pages.
// ============================================================

const FLOW_THEMES = {
  violet: {
    label: "Violet",
    primary: "#7C3AED",
    primaryRgb: "124 58 237",
    primaryDark: "#5B21B6",
    secondary: "#06B6D4",
    secondaryRgb: "6 182 212",
  },
  ocean: {
    label: "Ocean",
    primary: "#0EA5E9",
    primaryRgb: "14 165 233",
    primaryDark: "#0369A1",
    secondary: "#14B8A6",
    secondaryRgb: "20 184 166",
  },
  sunset: {
    label: "Sunset",
    primary: "#F97316",
    primaryRgb: "249 115 22",
    primaryDark: "#C2410C",
    secondary: "#EC4899",
    secondaryRgb: "236 72 153",
  },
  forest: {
    label: "Forest",
    primary: "#10B981",
    primaryRgb: "16 185 129",
    primaryDark: "#047857",
    secondary: "#84CC16",
    secondaryRgb: "132 204 22",
  },
  midnight: {
    label: "Midnight",
    primary: "#6366F1",
    primaryRgb: "99 102 241",
    primaryDark: "#4338CA",
    secondary: "#8B5CF6",
    secondaryRgb: "139 92 246",
  },
  crimson: {
    label: "Crimson",
    primary: "#EF4444",
    primaryRgb: "239 68 68",
    primaryDark: "#B91C1C",
    secondary: "#F59E0B",
    secondaryRgb: "245 158 11",
  },
};

const THEME_KEY = "flow_theme";

function applyTheme(themeKey) {
  const theme = FLOW_THEMES[themeKey] || FLOW_THEMES.violet;
  const root = document.documentElement;
  root.style.setProperty("--primary", theme.primary);
  root.style.setProperty("--primary-rgb", theme.primaryRgb);
  root.style.setProperty("--primary-dark", theme.primaryDark);
  root.style.setProperty("--secondary", theme.secondary);
  root.style.setProperty("--secondary-rgb", theme.secondaryRgb);
  // Store in localStorage as fallback for fast initial paint
  localStorage.setItem(THEME_KEY, themeKey);
}

// Apply theme from localStorage immediately (before DB fetch) to avoid flash
function applyStoredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored && FLOW_THEMES[stored]) applyTheme(stored);
}

// Fetch theme from DB by user ID and apply it; also syncs localStorage
async function loadUserTheme(userId) {
  if (!userId) return;
  try {
    const res = await fetch(`/api/theme?userId=${userId}`);
    if (!res.ok) return;
    const { theme } = await res.json();
    if (theme && FLOW_THEMES[theme]) applyTheme(theme);
  } catch (e) {
    // Silently fall back to stored/default theme
  }
}

// Persist theme to DB
async function saveUserTheme(userId, themeKey) {
  if (!userId) return;
  applyTheme(themeKey); // Apply immediately, then persist
  try {
    await fetch("/api/theme", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, theme: themeKey }),
    });
  } catch (e) {
    // Theme still applied locally; DB save failed silently
  }
}
