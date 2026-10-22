import type { FilterId } from "@/types/scanner";

export type ThemeMode = "system" | "dark" | "light";
export type ExportFormat = "searchable-pdf" | "pdf" | "txt";

export type SupportedLanguage = {
  code: string;
  name: string;
  nativeName?: string;
  category?: "Indian" | "European" | "East Asian" | "Middle Eastern";
};

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "eng", name: "English", nativeName: "English", category: "European" },
  { code: "hin", name: "Hindi", nativeName: "हिन्दी", category: "Indian" },
  { code: "mar", name: "Marathi", nativeName: "मराठी", category: "Indian" },
  { code: "ben", name: "Bengali", nativeName: "বাংলা", category: "Indian" },
  { code: "guj", name: "Gujarati", nativeName: "ગુજરાતી", category: "Indian" },
  { code: "tam", name: "Tamil", nativeName: "தமிழ்", category: "Indian" },
  { code: "tel", name: "Telugu", nativeName: "తెలుగు", category: "Indian" },
  { code: "kan", name: "Kannada", nativeName: "ಕನ್ನಡ", category: "Indian" },
  { code: "mal", name: "Malayalam", nativeName: "മലയാളം", category: "Indian" },
  { code: "pan", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ", category: "Indian" },
  { code: "urd", name: "Urdu", nativeName: "اردو", category: "Indian" },
  { code: "fra", name: "French", nativeName: "Français", category: "European" },
  { code: "deu", name: "German", nativeName: "Deutsch", category: "European" },
  { code: "spa", name: "Spanish", nativeName: "Español", category: "European" },
  { code: "por", name: "Portuguese", nativeName: "Português", category: "European" },
  { code: "ita", name: "Italian", nativeName: "Italiano", category: "European" },
  { code: "nld", name: "Dutch", nativeName: "Nederlands", category: "European" },
  { code: "rus", name: "Russian", nativeName: "Русский", category: "European" },
  { code: "ara", name: "Arabic", nativeName: "العربية", category: "Middle Eastern" },
  { code: "jpn", name: "Japanese", nativeName: "日本語", category: "East Asian" },
  { code: "kor", name: "Korean", nativeName: "한국어", category: "East Asian" },
  { code: "chi_sim", name: "Chinese (Simplified)", nativeName: "简体中文", category: "East Asian" },
  { code: "chi_tra", name: "Chinese (Traditional)", nativeName: "繁體中文", category: "East Asian" },
];

export const VALID_LANGUAGE_CODES = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));

export type AppSettings = {
  theme: ThemeMode;
  defaultFilter: FilterId;
  /** Primary / combined Tesseract language code (e.g. "eng" or "eng+hin") */
  ocrLanguage: string;
  /** List of selected language codes (e.g. ["eng", "hin"]) */
  ocrLanguages: string[];
  /** Run OCR automatically when a page is accepted */
  autoOcr: boolean;
  defaultExport: ExportFormat;
};

export const STORAGE_KEY = "scanly.settings.v1";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  defaultFilter: "auto",
  ocrLanguage: "eng",
  ocrLanguages: ["eng"],
  autoOcr: true,
  defaultExport: "searchable-pdf",
};

const FILTERS: FilterId[] = ["original", "grayscale", "black-white", "auto", "contrast", "sharpen"];
const THEMES: ThemeMode[] = ["system", "dark", "light"];
const EXPORTS: ExportFormat[] = ["searchable-pdf", "pdf", "txt"];

/**
 * Robust sanitizer and schema migration helper.
 * Never throws on malformed, corrupted, or outdated payloads.
 */
export function sanitizeSettings(raw: unknown): AppSettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
  const value = raw as Partial<AppSettings> & { ocrLanguages?: unknown; ocrLanguage?: unknown };

  // Parse and normalize language array
  let languages: string[] = [];
  if (Array.isArray(value.ocrLanguages)) {
    languages = Array.from(
      new Set(
        value.ocrLanguages
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((code) => VALID_LANGUAGE_CODES.has(code)),
      ),
    );
  } else if (typeof value.ocrLanguage === "string") {
    // Migration: parse existing string format like "eng+hin" or "eng"
    languages = Array.from(
      new Set(
        value.ocrLanguage
          .split("+")
          .map((s) => s.trim())
          .filter((code) => VALID_LANGUAGE_CODES.has(code)),
      ),
    );
  }

  if (languages.length === 0) {
    languages = [...DEFAULT_SETTINGS.ocrLanguages];
  }

  const combinedLangString = languages.join("+");

  return {
    theme: THEMES.includes(value.theme as ThemeMode) ? (value.theme as ThemeMode) : DEFAULT_SETTINGS.theme,
    defaultFilter: FILTERS.includes(value.defaultFilter as FilterId)
      ? (value.defaultFilter as FilterId)
      : DEFAULT_SETTINGS.defaultFilter,
    ocrLanguage: combinedLangString,
    ocrLanguages: languages,
    autoOcr: typeof value.autoOcr === "boolean" ? value.autoOcr : DEFAULT_SETTINGS.autoOcr,
    defaultExport: EXPORTS.includes(value.defaultExport as ExportFormat)
      ? (value.defaultExport as ExportFormat)
      : DEFAULT_SETTINGS.defaultExport,
  };
}

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitizeSettings(JSON.parse(raw));
  } catch (error) {
    console.warn("Could not read settings from localStorage, using defaults:", error);
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist a patch and notify listeners. Returns the merged settings. */
export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  // If ocrLanguages was updated but ocrLanguage was not, keep ocrLanguage in sync
  let nextOcrLanguage = patch.ocrLanguage;
  if (patch.ocrLanguages && !patch.ocrLanguage) {
    nextOcrLanguage = patch.ocrLanguages.join("+");
  } else if (patch.ocrLanguage && !patch.ocrLanguages) {
    patch.ocrLanguages = patch.ocrLanguage.split("+");
  }

  const next = sanitizeSettings({
    ...current,
    ...patch,
    ...(nextOcrLanguage ? { ocrLanguage: nextOcrLanguage } : {}),
  });

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
      console.error("Failed to persist settings:", error);
    }

    applyTheme(next.theme);
    window.dispatchEvent(new CustomEvent("scanly:settings", { detail: next }));
  }
  return next;
}

/** Reset all settings to defaults. */
export function resetSettings(): AppSettings {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  const defaults = { ...DEFAULT_SETTINGS };
  if (typeof window !== "undefined") {
    applyTheme(defaults.theme);
    window.dispatchEvent(new CustomEvent("scanly:settings", { detail: defaults }));
  }
  return defaults;
}

export function subscribeSettings(listener: (settings: AppSettings) => void): () => void {
  const onLocal = (event: Event) => listener((event as CustomEvent<AppSettings>).detail);
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener(loadSettings());
  };
  window.addEventListener("scanly:settings", onLocal);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("scanly:settings", onLocal);
    window.removeEventListener("storage", onStorage);
  };
}

let mediaQueryListener: (() => void) | null = null;

/** Resolves "system" to actual "dark" or "light" based on OS preferences. */
export function resolveTheme(theme: ThemeMode, systemPrefersDark?: boolean): "dark" | "light" {
  if (theme === "system") {
    if (typeof systemPrefersDark === "boolean") {
      return systemPrefersDark ? "dark" : "light";
    }
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  }
  return theme;
}

/** Apply the theme to the document root; also handles system preference changes. */
export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;

  const effectiveTheme = resolveTheme(theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", effectiveTheme === "dark");
  document.documentElement.style.colorScheme = effectiveTheme;

  // Manage OS preference listener when set to "system"
  if (typeof window !== "undefined" && window.matchMedia) {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    if (mediaQueryListener) {
      mq.removeEventListener("change", mediaQueryListener);
      mediaQueryListener = null;
    }

    if (theme === "system") {
      mediaQueryListener = () => {
        const updated = mq.matches ? "dark" : "light";
        document.documentElement.classList.toggle("dark", updated === "dark");
        document.documentElement.style.colorScheme = updated;
      };
      mq.addEventListener("change", mediaQueryListener);
    }
  }
}
