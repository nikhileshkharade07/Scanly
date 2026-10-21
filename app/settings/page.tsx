"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { loadSettings, saveSettings, subscribeSettings, type AppSettings } from "@/lib/settings";
import { scanlyApi } from "@/lib/api/scanly";
import type { FilterId } from "@/types/scanner";

const FILTER_OPTIONS: { id: FilterId; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "original", label: "Original" },
  { id: "grayscale", label: "Grayscale" },
  { id: "black-white", label: "Black & white" },
  { id: "contrast", label: "Contrast" },
  { id: "sharpen", label: "Sharpen" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const [languages, setLanguages] = useState<string[] | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeSettings(setSettings);
    return unsubscribe;
  }, []);

  useEffect(() => {
    void scanlyApi.ping().then((info) => setLanguages(info ? info.languages : null));
  }, []);

  const update = (patch: Partial<AppSettings>) => setSettings(saveSettings(patch));

  return (
    <div className="px-5 py-10 text-zinc-100 sm:px-8">
      <div className="mx-auto max-w-2xl">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Preferences</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-2 text-sm text-zinc-500">Stored in this browser only. No account required.</p>
        </header>

        <div className="mt-8 space-y-6">
          <Card title="Appearance" description="Interface color scheme.">
            <div className="flex gap-2">
              {(["dark", "light"] as const).map((theme) => (
                <button
                  key={theme}
                  onClick={() => update({ theme })}
                  aria-pressed={settings.theme === theme}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm capitalize transition ${
                    settings.theme === theme
                      ? "border-emerald-500 bg-emerald-950/40 font-semibold text-emerald-300"
                      : "border-zinc-800 text-zinc-300 hover:bg-zinc-900"
                  }`}
                >
                  {theme}
                </button>
              ))}
            </div>
          </Card>

          <Card title="Default filter" description="Applied to newly captured pages before you adjust them.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {FILTER_OPTIONS.map((filter) => (
                <button
                  key={filter.id}
                  onClick={() => update({ defaultFilter: filter.id })}
                  aria-pressed={settings.defaultFilter === filter.id}
                  className={`rounded-lg border px-3 py-2 text-sm transition ${
                    settings.defaultFilter === filter.id
                      ? "border-emerald-500 bg-emerald-950/40 font-semibold text-emerald-300"
                      : "border-zinc-800 text-zinc-300 hover:bg-zinc-900"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </Card>

          <Card title="OCR" description="Text recognition runs on your machine via the local engine.">
            <div className="space-y-4">
              <label className="flex items-center justify-between gap-4">
                <span className="text-sm">
                  Run OCR automatically
                  <span className="block text-xs text-zinc-500">Recognize text as soon as a page is saved.</span>
                </span>
                <input
                  type="checkbox"
                  checked={settings.autoOcr}
                  onChange={(e) => update({ autoOcr: e.target.checked })}
                  className="h-5 w-5 accent-emerald-500"
                />
              </label>
              <label className="block">
                <span className="text-sm">Recognition language</span>
                <select
                  value={settings.ocrLanguage}
                  onChange={(e) => update({ ocrLanguage: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-sm outline-none focus:border-zinc-500"
                >
                  {(languages ?? (settings.ocrLanguage ? [settings.ocrLanguage] : ["eng"])).map((lang) => (
                    <option key={lang} value={lang}>
                      {lang}
                    </option>
                  ))}
                </select>
                {languages === null && (
                  <span className="mt-1 block text-xs text-zinc-600">
                    Engine offline — showing the saved language. Start the backend for the full list.
                  </span>
                )}
              </label>
            </div>
          </Card>

          <Card title="Storage" description="Documents live in this browser's IndexedDB. Clearing site data removes them.">
            <p className="text-sm text-zinc-500">Documents are not synced between devices or backed up anywhere.</p>
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
