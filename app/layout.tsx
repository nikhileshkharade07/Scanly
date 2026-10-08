import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Scanly — Private Document Scanner",
  description: "Local-first OCR document scanning without cloud uploads."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
