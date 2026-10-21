import { describe, expect, it } from "vitest";
import { includesSearchText, normalizeSearchText } from "@/lib/search/text-search";

describe("search normalization", () => {
  it("normalizes whitespace and case", () => expect(normalizeSearchText("  Hello   WORLD ")).toBe("hello world"));
  it("collapses tabs and newlines", () => expect(normalizeSearchText("line1\tline2\nline3")).toBe("line1 line2 line3"));
  it("trims whitespace-only input to empty", () => expect(normalizeSearchText("   ")).toBe(""));
  it("finds normalized text", () => expect(includesSearchText("March   Invoice", "march invoice")).toBe(true));
  it("matches ignoring case", () => expect(includesSearchText("Quarterly REPORT 2024", "quarterly report")).toBe(true));
  it("does not match unrelated text", () => expect(includesSearchText("Grocery receipt", "invoice")).toBe(false));
  it("empty query matches everything (show-all behavior)", () => {
    expect(includesSearchText("anything", "")).toBe(true);
    expect(includesSearchText("", "")).toBe(true);
  });
  it("empty haystack with non-empty query does not match", () => expect(includesSearchText("", "something")).toBe(false));
});
