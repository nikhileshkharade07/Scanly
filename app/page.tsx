"use client";

import { useRef, useState } from "react";

export default function HomePage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <main className="min-h-screen bg-zinc-950 px-5 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl flex-col">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">Privacy-first scanner</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Scanly</h1>
          </div>
          <a href="/settings" className="rounded-lg border border-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900">Settings</a>
        </header>

        <section className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="mb-8 max-w-2xl">
            <p className="mb-3 text-sm text-zinc-500">Camera → correction → OCR → local library → searchable PDF</p>
            <h2 className="text-4xl font-semibold tracking-tight sm:text-6xl">Scan documents.<br />Keep them yours.</h2>
            <p className="mx-auto mt-5 max-w-xl text-zinc-400">Scanly is designed to process documents locally, with no mandatory account, backend, or cloud upload.</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <a href="/scan" className="rounded-xl bg-white px-7 py-4 font-semibold text-zinc-950 shadow-lg shadow-white/5 transition hover:bg-zinc-200">Scan document</a>
            <button onClick={() => inputRef.current?.click()} className="rounded-xl border border-zinc-800 px-7 py-4 font-semibold text-zinc-100 transition hover:bg-zinc-900">Upload image</button>
          </div>
          <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)} />
          {fileName && <p className="mt-5 text-sm text-zinc-500">Selected: {fileName} — scanner pipeline will process this in the next stage.</p>}

          <div className="mt-16 grid w-full max-w-3xl grid-cols-1 gap-3 text-left sm:grid-cols-3">
            {[["Local-first", "Images and OCR stay on-device."], ["Real OCR", "Built for word-level text and confidence data."], ["Searchable PDFs", "Export documents with a selectable OCR layer."]].map(([title, text]) => (
              <div key={title} className="rounded-xl border border-zinc-900 bg-zinc-950 p-5">
                <h3 className="font-medium">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-zinc-500">{text}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
