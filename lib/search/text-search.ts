export function normalizeSearchText(value: string): string { return value.replace(/\s+/g, " ").trim().toLocaleLowerCase(); }
export function includesSearchText(text: string, query: string): boolean { return normalizeSearchText(text).includes(normalizeSearchText(query)); }
