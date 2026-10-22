import { describe, expect, it, beforeEach } from "vitest";
import {
  DEFAULT_SETTINGS,
  SUPPORTED_LANGUAGES,
  VALID_LANGUAGE_CODES,
  sanitizeSettings,
  loadSettings,
  saveSettings,
  resetSettings,
  resolveTheme,
} from "@/lib/settings";

const storageMap = new Map<string, string>();
const mockLocalStorage = {
  getItem: (k: string) => storageMap.get(k) ?? null,
  setItem: (k: string, v: string) => {
    storageMap.set(k, String(v));
  },
  removeItem: (k: string) => {
    storageMap.delete(k);
  },
  clear: () => {
    storageMap.clear();
  },
};

const mockWindow = {
  localStorage: mockLocalStorage,
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, "window", {
  value: mockWindow,
  writable: true,
  configurable: true,
});

describe("Settings Store & Persistence", () => {
  beforeEach(() => {
    storageMap.clear();
  });

  describe("Theme resolution", () => {
    it("resolves explicit 'dark' and 'light' modes directly", () => {
      expect(resolveTheme("dark", false)).toBe("dark");
      expect(resolveTheme("dark", true)).toBe("dark");
      expect(resolveTheme("light", false)).toBe("light");
      expect(resolveTheme("light", true)).toBe("light");
    });

    it("resolves 'system' mode according to OS prefers-color-scheme", () => {
      expect(resolveTheme("system", true)).toBe("dark");
      expect(resolveTheme("system", false)).toBe("light");
    });
  });

  describe("Sanitization & Default Values", () => {
    it("returns pristine defaults for null or undefined input", () => {
      const sanitized = sanitizeSettings(null);
      expect(sanitized.theme).toBe("system");
      expect(sanitized.defaultFilter).toBe("auto");
      expect(sanitized.ocrLanguages).toEqual(["eng"]);
      expect(sanitized.ocrLanguage).toBe("eng");
      expect(sanitized.autoOcr).toBe(true);
      expect(sanitized.defaultExport).toBe("searchable-pdf");
    });

    it("recovers gracefully from corrupted JSON or malformed structures", () => {
      mockLocalStorage.setItem("scanly.settings.v1", "INVALID_JSON{{{{{");
      const loaded = loadSettings();
      expect(loaded).toEqual(DEFAULT_SETTINGS);
    });

    it("clamps invalid filter names back to default", () => {
      const sanitized = sanitizeSettings({ defaultFilter: "super_ultra_filter" as any });
      expect(sanitized.defaultFilter).toBe("auto");
    });

    it("clamps invalid theme values back to 'system'", () => {
      const sanitized = sanitizeSettings({ theme: "neon_cyberpunk" as any });
      expect(sanitized.theme).toBe("system");
    });
  });

  describe("Multilingual OCR & Schema Migration", () => {
    it("supports all major Indian and international languages in catalog", () => {
      expect(VALID_LANGUAGE_CODES.has("eng")).toBe(true);
      expect(VALID_LANGUAGE_CODES.has("hin")).toBe(true);
      expect(VALID_LANGUAGE_CODES.has("mar")).toBe(true);
      expect(VALID_LANGUAGE_CODES.has("ben")).toBe(true);
      expect(VALID_LANGUAGE_CODES.has("guj")).toBe(true);
      expect(VALID_LANGUAGE_CODES.has("tam")).toBe(true);
      expect(VALID_LANGUAGE_CODES.has("tel")).toBe(true);
      expect(VALID_LANGUAGE_CODES.has("kan")).toBe(true);
      expect(VALID_LANGUAGE_CODES.has("mal")).toBe(true);
      expect(VALID_LANGUAGE_CODES.has("fra")).toBe(true);
      expect(VALID_LANGUAGE_CODES.has("deu")).toBe(true);
      expect(VALID_LANGUAGE_CODES.has("spa")).toBe(true);
      expect(VALID_LANGUAGE_CODES.has("jpn")).toBe(true);
      expect(VALID_LANGUAGE_CODES.has("ara")).toBe(true);
      expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(20);
    });

    it("migrates legacy single ocrLanguage string to ocrLanguages array", () => {
      const legacy = { ocrLanguage: "hin" };
      const sanitized = sanitizeSettings(legacy);
      expect(sanitized.ocrLanguages).toEqual(["hin"]);
      expect(sanitized.ocrLanguage).toBe("hin");
    });

    it("migrates plus-separated ocrLanguage string ('eng+hin+mar')", () => {
      const legacy = { ocrLanguage: "eng+hin+mar" };
      const sanitized = sanitizeSettings(legacy);
      expect(sanitized.ocrLanguages).toEqual(["eng", "hin", "mar"]);
      expect(sanitized.ocrLanguage).toBe("eng+hin+mar");
    });

    it("filters out unknown/invalid language codes and prevents empty selections", () => {
      const invalid = { ocrLanguages: ["fake_lang", "klingon"] };
      const sanitized = sanitizeSettings(invalid);
      expect(sanitized.ocrLanguages).toEqual(["eng"]);
      expect(sanitized.ocrLanguage).toBe("eng");
    });

    it("deduplicates languages while preserving order", () => {
      const duplicate = { ocrLanguages: ["eng", "hin", "eng", "mar", "hin"] };
      const sanitized = sanitizeSettings(duplicate);
      expect(sanitized.ocrLanguages).toEqual(["eng", "hin", "mar"]);
      expect(sanitized.ocrLanguage).toBe("eng+hin+mar");
    });
  });

  describe("Save, Load & Reset", () => {
    it("persists and restores updated settings across reloads", () => {
      saveSettings({
        theme: "light",
        defaultFilter: "black-white",
        ocrLanguages: ["eng", "hin"],
        autoOcr: false,
      });

      const restored = loadSettings();
      expect(restored.theme).toBe("light");
      expect(restored.defaultFilter).toBe("black-white");
      expect(restored.ocrLanguages).toEqual(["eng", "hin"]);
      expect(restored.ocrLanguage).toBe("eng+hin");
      expect(restored.autoOcr).toBe(false);
    });

    it("resets all settings back to pristine defaults on resetSettings()", () => {
      saveSettings({
        theme: "light",
        defaultFilter: "contrast",
        ocrLanguages: ["fra", "deu"],
        autoOcr: false,
      });

      const reset = resetSettings();
      expect(reset).toEqual(DEFAULT_SETTINGS);
      expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    });
  });
});
