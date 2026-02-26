// Escape HTML special characters to prevent XSS in email templates
export function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Sanitize CSV fields to prevent formula injection
export function sanitizeCsvField(str: string): string {
  if (!str) return '';
  const s = String(str);
  // Prefix dangerous characters that could be interpreted as formulas
  if (/^[=+\-@\t\r]/.test(s)) {
    return "'" + s;
  }
  return s;
}
