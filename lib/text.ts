export function normalizeText(value: unknown): string {
  return String(value ?? '')
    // Convert accidentally escaped line breaks into real line breaks.
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n');
}

export function normalizeTrimmedText(value: unknown): string {
  return normalizeText(value).trim();
}
