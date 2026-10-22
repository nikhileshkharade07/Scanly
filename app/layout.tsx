import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import type { Route } from "next";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Scanly — Private Document Scanner",
  description: "Local-first OCR document scanning without cloud uploads.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var raw=localStorage.getItem("scanly.settings.v1");var theme=raw?JSON.parse(raw).theme:"dark";var isDark=theme==="dark"||(theme==="system"&&window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)||!theme;if(isDark){document.documentElement.classList.add("dark");document.documentElement.dataset.theme=theme||"dark";document.documentElement.style.colorScheme="dark";}else{document.documentElement.classList.remove("dark");document.documentElement.dataset.theme="light";document.documentElement.style.colorScheme="light";}}catch(e){document.documentElement.classList.add("dark");}})();`,
          }}
        />
      </head>
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <nav className="border-b border-zinc-900/80 bg-zinc-950/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-5 sm:px-8">
            <Link
              href="/"
              className="flex items-center gap-2 font-semibold tracking-tight text-zinc-100 transition hover:text-white"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500 text-xs font-bold text-zinc-950">
                S
              </span>
              Scanly
            </Link>
            <div className="flex items-center gap-1 sm:gap-2">
              <NavLink href="/scan">Scan</NavLink>
              <NavLink href="/library">Library</NavLink>
              <NavLink href="/history">History</NavLink>
              <NavLink href="/settings">Settings</NavLink>
            </div>
          </div>
        </nav>
        <main id="main-content">{children}</main>
        <footer className="mt-16 border-t border-zinc-900/80 py-6 text-center text-xs text-zinc-600">
          Scanly runs entirely on your device — documents are stored in your browser and never uploaded.
        </footer>
      </body>
    </html>
  );
}

function NavLink({ href, children }: { href: Route; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-1.5 text-sm text-zinc-400 transition hover:bg-zinc-900 hover:text-zinc-100"
    >
      {children}
    </Link>
  );
}
