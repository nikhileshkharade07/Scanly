import type { FilterId } from "@/types/scanner";

export type ThemeMode = "dark" | "light";
export type ExportFormat = "searchable-pdf" | "pdf" | "txt";

export type AppSettings = {
  theme: ThemeMode;
  defaultFilter: FilterId;
  /** Tesseract language code; must exist in the backend's installed languages ("eng" by default). */
  ocrLanguage: string;
  /** Run OCR automatically when a page is accepted in the scanner. */
  autoOcr: boolean;
  defaultExport: ExportFormat;
};

const STORAGE_KEY = "scanly.settings.v1";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "dark",
  defaultFilter: "auto",
  ocrLanguage: "eng",
  autoOcr: true,
  defaultExport: "searchable-pdf",
};

const FILTERS: FilterId[] = ["original", "grayscale", "black-white", "auto", "contrast", "sharpen"];
const THEMES: ThemeMode[] = ["dark", "light"];
const EXPORTS: ExportFormat[] = ["searchable-pdf", "pdf", "txt"];

function sanitize(raw: unknown): AppSettings {
  if (typeof raw !== "object" || raw === null) return { ...DEFAULT_SETTINGS };
  const value = raw as Partial<AppSettings>;
  return {
    theme: THEMES.includes(value.theme as ThemeMode) ? (value.theme as ThemeMode) : DEFAULT_SETTINGS.theme,
    defaultFilter: FILTERS.includes(value.defaultFilter as FilterId)
      ? (value.defaultFilter as FilterId)
      : DEFAULT_SETTINGS.defaultFilter,
    ocrLanguage: typeof value.ocrLanguage === "string" && value.ocrLanguage.trim()
      ? value.ocrLanguage.trim()
      : DEFAULT_SETTINGS.ocrLanguage,
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
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Persist a patch and notify listeners. Returns the merged settings. */
export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = sanitize({ ...loadSettings(), ...patch });
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.error("Failed to persist settings:", error);
  }
  applyTheme(next.theme);
  window.dispatchEvent(new CustomEvent("scanly:settings", { detail: next }));
  return next;
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

/** Apply the theme to the document root; also called during hydration. */
export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}
