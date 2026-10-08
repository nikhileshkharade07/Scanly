import { describe, expect, it } from "vitest";
import { includesSearchText, normalizeSearchText } from "@/lib/search/text-search";
describe("search normalization", () => {
  it("normalizes whitespace and case", () => expect(normalizeSearchText("  Hello   WORLD ")).toBe("hello world"));
  it("finds normalized text", () => expect(includesSearchText("March   Invoice", "march invoice")).toBe(true));
});
