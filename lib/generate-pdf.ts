// Minimal PDF generator — zero dependencies, raw PDF spec
// Generates a clean proposal PDF without any npm packages

interface ProposalData {
  estimate_no: string;
  client_name: string;
  client_email?: string;
  client_address?: string;
  client_city?: string;
  client_state?: string;
  client_zip?: string;
  footage?: number;
  height?: string;
  color?: string;
  material?: string;
  gate_count?: number;
  panels?: number;
  removal_type?: string;
  removal_footage?: number;
  total: number;
  deposit: number;
  installment_2: number;
  installment_3: number;
  spot_holding_fee?: number;
  description_override?: string;
  notes?: string;
  created_at?: string;
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function fmt(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function generateProposalPDF(p: ProposalData): Promise<Buffer> {
  const spot = p.spot_holding_fee || 150;
  const gateText = p.gate_count && p.gate_count > 0 ? `${p.gate_count} GATE${p.gate_count > 1 ? 'S' : ''}` : 'NO GATES';
  const dateStr = p.created_at 
    ? new Date(p.created_at).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    : new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const fullAddr = [p.client_address, p.client_city, p.client_state, p.client_zip].filter(Boolean).join(', ');

  // Build content stream for page 1
  let y = 750; // Start from top (PDF coords: 0,0 is bottom-left)
  const M = 50;
  const W = 562; // 612 - 50

  let stream = '';
  
  function text(x: number, yPos: number, content: string, size: number = 10, bold: boolean = false) {
    const font = bold ? '/F2' : '/F1';
    stream += `BT ${font} ${size} Tf ${x} ${yPos} Td (${esc(content)}) Tj ET\n`;
  }

  function grayText(x: number, yPos: number, content: string, size: number = 10, gray: number = 0.4) {
    stream += `BT ${gray} g /F1 ${size} Tf ${x} ${yPos} Td (${esc(content)}) Tj 0 g ET\n`;
  }

  function line(x1: number, y1: number, x2: number, y2: number, gray: number = 0.8) {
    stream += `${gray} G 0.5 w ${x1} ${y1} m ${x2} ${y2} l S\n`;
  }

  // === HEADER ===
  text(M, y, 'PNM FENCING NJ LLC', 18, true);
  y -= 18;
  grayText(M, y, 'PO Box ___ Oakhurst, NJ 07712  |  1-(908)-692-4847', 9, 0.4);
  y -= 24;

  // Proposal For
  text(M, y, 'Proposal For:', 13, true);
  // Right side
  text(400, y + 2, 'Estimate No:', 9, true);
  grayText(470, y + 2, p.estimate_no, 10);
  text(400, y - 14, 'Date:', 9, true);
  grayText(470, y - 14, dateStr, 10);

  y -= 20;
  text(M + 20, y, p.client_name || '', 11, true);
  y -= 14;
  if (p.client_email) { grayText(M + 20, y, p.client_email, 10, 0.25); y -= 14; }
  if (fullAddr) { grayText(M + 20, y, fullAddr, 10, 0.25); y -= 14; }

  y -= 8;
  line(M, y, W, y, 0.78);
  y -= 16;

  // === DESCRIPTION TABLE ===
  text(M, y, 'Description', 10, true);
  text(460, y, 'Amount', 10, true);
  y -= 8;
  line(M, y, W, y, 0.2);
  y -= 16;

  const descLines = p.description_override ? p.description_override.split('\n') : [
    `Supply and install up to approximately ${p.footage} linear feet of ${p.height || '6ft'} high`,
    `${(p.color || 'WHITE').toUpperCase()} ${p.material || 'vinyl'} solid privacy fencing ${gateText}`,
    `7" heavy duty rails`,
    'Standard post caps',
    'Disposal of packing materials included.',
    (p.removal_footage && p.removal_footage > 0)
      ? `Removal of ${p.removal_footage}ft of ${p.removal_type || 'existing fence'} included.`
      : 'No removal of existing fence.',
    'Delivery included.',
    'Concrete on all posts*',
    '',
    'Please note this quote does not include removing or installing',
    'any existing paver blocks. Drilling or cutting thru concrete.',
    '',
    'Utility mark-out included.',
    'PNM not responsible for unmarked sprinkler lines and misc. pipes.',
    'Fence to follow grade of ground.',
    'Footing soil dispersed around posts/sections.',
    'PNM not responsible for earth settling.',
  ];

  const amountY = y;
  descLines.forEach(l => {
    if (l === '') { y -= 8; return; }
    grayText(M, y, l, 10, 0.15);
    y -= 13;
  });

  // Amount
  text(460, amountY, fmt(p.total) + '*', 12, true);

  y -= 8;
  grayText(M, y, '*Indicates non-taxable item', 9, 0.4);
  y -= 14;
  line(M, y, W, y, 0.78);
  y -= 16;

  // === TOTALS ===
  grayText(390, y, 'Subtotal', 10, 0.35);
  text(460, y, fmt(p.total), 11, true);
  y -= 14;
  line(380, y, W, y, 0.78);
  y -= 6;
  text(390, y, 'Total', 12, true);
  text(460, y, fmt(p.total), 12, true);
  y -= 26;

  // === NOTES ===
  text(M, y, 'Notes', 12, true);
  y -= 18;

  const noteLines = [
    `Payment terms: deposit paid in advance: ${fmt(p.deposit)}`,
    `(${fmt(spot)} spot holding fee supplied and applied to grand total)`,
    '',
    'By supplying the initial deposit above, the customer understands and agrees',
    'to abide by all of the terms and conditions set forth in this agreement.',
    '',
    'Second installment due upon material delivery to above referenced job site',
    `address in the amount of: ${fmt(p.installment_2)}`,
    '',
    'Remaining balance due upon day of installation completion in the amount',
    `of: ${fmt(p.installment_3)}`,
    '',
    'All materials remain property of PNM Fencing NJ LLC until final payment has',
    'been satisfied. If final payment is not satisfied upon install completion,',
    'PNM Fencing NJ LLC reserves the right to remove provided materials at',
    "customer's expense.",
    '',
    'All past due balances will be assessed with a penalty interest rate of 28% APR.',
  ];

  noteLines.forEach(l => {
    if (l === '') { y -= 6; return; }
    grayText(M, y, l, 9.5, 0.15);
    y -= 12;
  });
  y -= 8;

  // === CANCELLATION ===
  text(M, y, 'YOU MAY CANCEL THIS CONTRACT AT ANY TIME BEFORE MIDNIGHT OF THE', 8, true);
  y -= 10;
  text(M, y, 'THIRD BUSINESS DAY AFTER RECEIVING A COPY OF THIS CONTRACT.', 8, true);
  y -= 14;

  const cancelLines = [
    'IF YOU WISH TO CANCEL THIS CONTRACT, YOU MUST EITHER:',
    '1. SEND A SIGNED AND DATED WRITTEN NOTICE OF CANCELLATION BY REGISTERED',
    '   OR CERTIFIED MAIL, RETURN RECEIPT REQUESTED; OR',
    '2. PERSONALLY DELIVER A SIGNED AND DATED WRITTEN NOTICE OF CANCELLATION TO:',
    '',
    'PNM Fencing NJ LLC, PO Box ___ Oakhurst, NJ 07712, 1-(908)-692-4847',
    '',
    'If you cancel within three days, you are entitled to a full refund within 30 days.',
  ];
  cancelLines.forEach(l => {
    if (l === '') { y -= 5; return; }
    grayText(M, y, l, 8, 0.15);
    y -= 10;
  });
  y -= 12;

  // === SIGNATURE ===
  grayText(M, y, '*Acknowledgment of terms above', 9, 0.35);
  y -= 18;
  ['Print Name:', 'Sign X:', 'Date:'].forEach(label => {
    text(M, y, label, 10, false);
    line(M + 80, y - 2, 350, y - 2, 0.0);
    y -= 22;
  });

  // Footer
  grayText(220, 30, `PNM - Proposal ${p.estimate_no} - ${dateStr}  1 / 1`, 9, 0.4);

  // === BUILD RAW PDF ===
  const objects: string[] = [];
  let objCount = 0;

  function addObj(content: string): number {
    objCount++;
    objects.push(`${objCount} 0 obj\n${content}\nendobj`);
    return objCount;
  }

  // 1: Catalog
  addObj('<< /Type /Catalog /Pages 2 0 R >>');
  // 2: Pages
  addObj('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  // 3: Page
  addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> >>`);
  // 4: Helvetica
  addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  // 5: Helvetica-Bold
  addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  // 6: Content stream
  const streamBytes = Buffer.from(stream, 'latin1');
  addObj(`<< /Length ${streamBytes.length} >>\nstream\n${stream}endstream`);

  // Build file
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach(obj => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += obj + '\n';
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objCount + 1}\n0000000000 65535 f \n`;
  offsets.forEach(off => {
    pdf += off.toString().padStart(10, '0') + ' 00000 n \n';
  });
  pdf += `trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Promise.resolve(Buffer.from(pdf, 'latin1'));
}
