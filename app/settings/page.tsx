"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_SETTINGS,
  loadSettings,
  resetSettings,
  saveSettings,
  subscribeSettings,
  SUPPORTED_LANGUAGES,
  type AppSettings,
  type SupportedLanguage,
  type ThemeMode,
} from "@/lib/settings";
import type { FilterId } from "@/types/scanner";

const FILTER_OPTIONS: { id: FilterId; label: string; desc: string }[] = [
  { id: "auto", label: "Auto", desc: "Illumination leveling, contrast & sharp text" },
  { id: "original", label: "Original", desc: "Untouched color photo capture" },
  { id: "grayscale", label: "Grayscale", desc: "Clean monochromatic luminance" },
  { id: "black-white", label: "Black & white", desc: "High contrast Otsu binarization for text" },
  { id: "contrast", label: "Contrast", desc: "Percentile histogram expansion" },
  { id: "sharpen", label: "Sharpen", desc: "Edge accentuation with 3x3 Laplacian" },
];

const THEME_OPTIONS: { id: ThemeMode; label: string; desc: string }[] = [
  { id: "system", label: "System", desc: "Matches your device operating system theme" },
  { id: "dark", label: "Dark", desc: "Deep dark theme for low light reading" },
  { id: "light", label: "Light", desc: "High contrast clean daylight mode" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [langSearch, setLangSearch] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeSettings(setSettings);
    return unsubscribe;
  }, []);

  const update = (patch: Partial<AppSettings>) => {
    const updated = saveSettings(patch);
    setSettings(updated);
    showNotice("Settings saved");
  };

  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3000);
  };

  const onReset = () => {
    if (window.confirm("Reset all settings to default values?")) {
      const defs = resetSettings();
      setSettings(defs);
      showNotice("Settings reset to defaults");
    }
  };

  const toggleLanguage = (code: string) => {
    const current = settings.ocrLanguages || ["eng"];
    let next: string[];
    if (current.includes(code)) {
      if (current.length === 1) {
        showNotice("At least one language must remain selected");
        return;
      }
      next = current.filter((c) => c !== code);
    } else {
      next = [...current, code];
    }
    update({ ocrLanguages: next, ocrLanguage: next.join("+") });
  };

  // Filtered languages for search
  const filteredLanguages = useMemo(() => {
    const q = langSearch.trim().toLowerCase();
    if (!q) return SUPPORTED_LANGUAGES;
    return SUPPORTED_LANGUAGES.filter(
      (lang) =>
        lang.name.toLowerCase().includes(q) ||
        lang.code.toLowerCase().includes(q) ||
        (lang.nativeName && lang.nativeName.toLowerCase().includes(q)) ||
        (lang.category && lang.category.toLowerCase().includes(q)),
    );
  }, [langSearch]);

  const selectedLanguagesList = useMemo(() => {
    const selectedCodes = new Set(settings.ocrLanguages || ["eng"]);
    return SUPPORTED_LANGUAGES.filter((l) => selectedCodes.has(l.code));
  }, [settings.ocrLanguages]);

  return (
    <div className="px-5 py-10 text-zinc-100 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Preferences</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-2 text-sm text-zinc-500">Stored locally in your browser. No account or cloud sync required.</p>
          </div>
          <Link
            href="/scan"
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 shadow-md transition hover:bg-emerald-400"
          >
            Start Scan
          </Link>
        </header>

        {notice && (
          <div className="mt-4 rounded-xl border border-emerald-900/60 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-300 animate-fade-in" role="status">
            {notice}
          </div>
        )}

        <div className="mt-8 space-y-6">
          {/* Appearance Section */}
          <Card title="Appearance" description="Choose how Scanly looks across all screens and tools.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {THEME_OPTIONS.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  aria-label={theme.label}
                  onClick={() => update({ theme: theme.id })}
                  aria-pressed={settings.theme === theme.id}
                  className={`flex flex-col items-start rounded-xl border p-4 text-left transition ${
                    settings.theme === theme.id
                      ? "border-emerald-500 bg-emerald-950/30 text-emerald-300"
                      : "border-zinc-800 text-zinc-300 hover:bg-zinc-900"
                  }`}
                >
                  <span className="font-semibold text-sm capitalize">{theme.label}</span>
                  <span className="mt-1 text-xs text-zinc-500 leading-snug">{theme.desc}</span>
                </button>
              ))}
            </div>
          </Card>

          {/* Default Filter Section */}
          <Card
            title="Default filter"
            description="Automatically applied to newly captured or uploaded scans before manual adjustments."
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {FILTER_OPTIONS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  aria-label={filter.label}
                  onClick={() => update({ defaultFilter: filter.id })}
                  aria-pressed={settings.defaultFilter === filter.id}
                  className={`flex flex-col items-start rounded-xl border p-3 text-left transition ${
                    settings.defaultFilter === filter.id
                      ? "border-emerald-500 bg-emerald-950/30 text-emerald-300"
                      : "border-zinc-800 text-zinc-300 hover:bg-zinc-900"
                  }`}
                >
                  <span className="font-semibold text-sm">{filter.label}</span>
                  <span className="mt-0.5 text-xs text-zinc-500 line-clamp-1">{filter.desc}</span>
                </button>
              ))}
            </div>
          </Card>

          {/* Multilingual OCR Section */}
          <Card
            title="OCR Recognition Languages"
            description="Tesseract.js runs 100% on-device in a Web Worker. Select one or more languages present in your documents."
          >
            <div className="space-y-4">
              <label className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800/80 p-3 bg-zinc-900/30">
                <div>
                  <span className="text-sm font-medium text-zinc-200">Run OCR automatically</span>
                  <span className="block text-xs text-zinc-500">Extracts text immediately upon accepting each scan.</span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoOcr}
                  onChange={(e) => update({ autoOcr: e.target.checked })}
                  className="h-5 w-5 rounded accent-emerald-500"
                />
              </label>

              {/* Active Selected Languages Badges */}
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  Active Languages ({selectedLanguagesList.length})
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {selectedLanguagesList.map((lang) => (
                    <span
                      key={lang.code}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-emerald-950/40 px-3 py-1.5 text-xs font-medium text-emerald-300 shadow-sm"
                    >
                      <span>{lang.name}</span>
                      <span className="text-emerald-500/80 font-mono text-[10px]">({lang.code})</span>
                      <button
                        onClick={() => toggleLanguage(lang.code)}
                        className="ml-1 rounded-full p-0.5 text-emerald-400 hover:bg-emerald-800 hover:text-white"
                        aria-label={`Remove ${lang.name}`}
                        title={`Remove ${lang.name}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-zinc-500">
                  Tesseract parameter: <code className="font-mono text-zinc-300 bg-zinc-900 px-1.5 py-0.5 rounded">{settings.ocrLanguage}</code>
                </p>
              </div>

              {/* Searchable Language Picker */}
              <div className="pt-2">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                    Add Languages
                  </span>
                  <span className="text-xs text-zinc-500">
                    {filteredLanguages.length} language{filteredLanguages.length === 1 ? "" : "s"}
                  </span>
                </div>
                <input
                  type="search"
                  value={langSearch}
                  onChange={(e) => setLangSearch(e.target.value)}
                  placeholder="Search languages by name, code or native script (e.g. Hindi, mar, বাংলা, Spanish)..."
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2.5 text-sm outline-none placeholder:text-zinc-600 focus:border-zinc-500"
                />

                <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-zinc-800/80 divide-y divide-zinc-900 bg-zinc-900/20">
                  {filteredLanguages.map((lang) => {
                    const isSelected = (settings.ocrLanguages || ["eng"]).includes(lang.code);
                    return (
                      <button
                        key={lang.code}
                        onClick={() => toggleLanguage(lang.code)}
                        className={`w-full flex items-center justify-between px-3.5 py-2.5 text-left text-sm transition hover:bg-zinc-800/60 ${
                          isSelected ? "bg-emerald-950/20 text-emerald-300" : "text-zinc-300"
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`w-4 h-4 rounded-full border flex items-center justify-center text-[10px] ${
                              isSelected ? "border-emerald-500 bg-emerald-500 text-zinc-950 font-bold" : "border-zinc-700"
                            }`}
                          >
                            {isSelected ? "✓" : ""}
                          </span>
                          <span className="font-medium">{lang.name}</span>
                          {lang.nativeName && lang.nativeName !== lang.name && (
                            <span className="text-xs text-zinc-500">({lang.nativeName})</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {lang.category && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-zinc-800/70 text-zinc-400">
                              {lang.category}
                            </span>
                          )}
                          <span className="font-mono text-xs text-zinc-500">{lang.code}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </Card>

          {/* Reset and Storage Section */}
          <Card
            title="Storage & Reset"
            description="All documents, OCR text, and user settings remain exclusively on this device."
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-xs text-zinc-500 max-w-md leading-relaxed">
                Clearing your browser website cache or site data will remove saved documents. You can reset application preferences to factory defaults at any time.
              </p>
              <button
                onClick={onReset}
                className="rounded-xl border border-red-900/60 px-4 py-2 text-xs font-semibold text-red-400 transition hover:bg-red-950/50 hover:border-red-800"
              >
                Reset to Defaults
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Card({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-900 bg-zinc-950 p-5">
      <h2 className="text-sm font-semibold text-zinc-200">{title}</h2>
      <p className="mt-1 text-xs text-zinc-500">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}
