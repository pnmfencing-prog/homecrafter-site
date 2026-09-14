import { normalizeText } from '@/lib/text';

/**
 * Proposal `notes` must contain installment / payment-term extras and PDF
 * control flags only. Job scope belongs in description_override.
 */

const PAYMENT_LINE_RE =
  /installment|deposit|payment\s*terms?|spot\s*holding|spot\s*fee|holding\s*fee|venmo|zelle|cod\b|paid\s*(upfront|in\s*full|by)|invoice|grand\s*total|%\s*(deposit|due)|due\s*(upon|in\s*advance|during)|applied\s*to\s*(the\s+)?grand\s*total|no\s*spot\s*holding\s*fee|first\s*\+?\s*second\s*installment|fourth\s*&\s*final|remaining\s*(balance|amount)|upfront\s*by\s*gc|labor\s*amount\s*has\s*been\s*paid/i;

const JOB_SCOPE_TOKEN_RE =
  /\b(supply\s+and\s+install|linear\s*feet|\blf\b|gate(s)?\b|panels?\b|posts?\b|vinyl|pvc|chain[\s-]?link|lattice|pool\s*code|flat\s*caps?|gothic\s*caps?|fencing|fence\b|take\s*down|t\s*&\s*d|diamond|picket|aluminum|cedar|tongue\s*and\s*groove|air\s*conditioning\s*partition|footage|scope\s*:|key\s*locks?|standard\s*diamond|1x\d+ft|\d+x\d+ft)/i;

const CONTROL_FLAG_RE = /^HIDE_PO_BOX$/i;

function stripControlAndOverrideBlocks(text: string): {
  flags: string[];
  paymentOverride: string | null;
  standardOverride: string | null;
  remainder: string;
} {
  let remainder = text;
  const flags: string[] = [];

  const paymentMatch = remainder.match(
    /PAYMENT_TERMS_OVERRIDE:\s*([\s\S]*?)(?=\nSTANDARD_TERMS_OVERRIDE:|$)/i
  );
  let paymentOverride: string | null = null;
  if (paymentMatch) {
    paymentOverride = paymentMatch[1].trim();
    remainder = remainder.replace(paymentMatch[0], '').trim();
  }

  const standardMatch = remainder.match(/STANDARD_TERMS_OVERRIDE:\s*([\s\S]*)$/i);
  let standardOverride: string | null = null;
  if (standardMatch) {
    standardOverride = standardMatch[1].trim();
    remainder = remainder.replace(standardMatch[0], '').trim();
  }

  remainder = remainder
    .split(/\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (CONTROL_FLAG_RE.test(t)) {
        flags.push('HIDE_PO_BOX');
        return false;
      }
      return true;
    })
    .join('\n')
    .trim();

  return { flags, paymentOverride, standardOverride, remainder };
}

function extractPaymentSentences(line: string): string | null {
  const t = line.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t) || /\/invoices\//i.test(t)) return t;

  // Split on sentence boundaries so job blurbs + trailing fee notes can be separated.
  const sentences = t
    .split(/(?<=[.!?])\s+|(?<=\.)(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);

  const kept = sentences.filter((s) => {
    if (!PAYMENT_LINE_RE.test(s)) return false;
    // Drop sentences that are primarily job scope even if they mention a fee word loosely.
    const jobHits = (s.match(JOB_SCOPE_TOKEN_RE) || []).length;
    const isFeeOnly =
      /^(no\s+)?spot\s+holding\s+fee\b/i.test(s) ||
      /spot\s+holding\s+fee\s+(supplied|received|applies|applied|provided)/i.test(s) ||
      /no\s+spot\s+holding\s+fee\.?$/i.test(s);
    if (jobHits >= 2 && !isFeeOnly) return false;
    if (jobHits >= 1 && !/spot\s*holding|spot\s*fee|installment|deposit|payment|invoice|venmo|zelle|paid|due\b/i.test(s)) {
      return false;
    }
    return true;
  });

  if (!kept.length) return null;
  return kept.join(' ').trim();
}

function isPaymentExtraLine(line: string): boolean {
  return extractPaymentSentences(line) !== null;
}

function paymentExtraFromLine(line: string): string | null {
  return extractPaymentSentences(line);
}

/**
 * Keep payment/installment extras + control flags; drop job-description blurbs.
 * Returns null when nothing payment-related remains.
 */
export function sanitizeProposalNotes(raw: unknown): string | null {
  const text = normalizeText(raw).trim();
  if (!text) return null;

  const { flags, paymentOverride, standardOverride, remainder } =
    stripControlAndOverrideBlocks(text);

  const paymentExtras = remainder
    .split(/\n+/)
    .map((l) => paymentExtraFromLine(l.trim()))
    .filter((v): v is string => Boolean(v));

  const parts: string[] = [];
  if (flags.includes('HIDE_PO_BOX')) parts.push('HIDE_PO_BOX');
  if (paymentOverride !== null) parts.push(`PAYMENT_TERMS_OVERRIDE:\n${paymentOverride}`);
  if (standardOverride !== null) parts.push(`STANDARD_TERMS_OVERRIDE:\n${standardOverride}`);
  if (paymentExtras.length) parts.push(paymentExtras.join('\n'));

  if (!parts.length && (/^PAYMENT_TERMS_OVERRIDE:/i.test(text) || /^STANDARD_TERMS_OVERRIDE:/i.test(text))) {
    return text;
  }

  const out = parts.join('\n').trim();
  return out || null;
}

/**
 * Text safe to dump into the PDF Notes HTML block after installment boilerplate.
 * Strips control flags and override markers; keeps payment extras only.
 */
export function notesForPdfDisplay(raw: unknown): string {
  const text = normalizeText(raw).trim();
  if (!text) return '';
  if (/^PAYMENT_TERMS_OVERRIDE:/i.test(text)) return '';

  const cleaned = text
    .replace(/\bHIDE_PO_BOX\b/gi, '')
    .replace(/STANDARD_TERMS_OVERRIDE:\s*[\s\S]*$/i, '')
    .replace(/PAYMENT_TERMS_OVERRIDE:\s*[\s\S]*?(?=\nSTANDARD_TERMS_OVERRIDE:|$)/i, '')
    .trim();

  return cleaned
    .split(/\n+/)
    .map((l) => paymentExtraFromLine(l.trim()))
    .filter((v): v is string => Boolean(v))
    .join('\n')
    .trim();
}
