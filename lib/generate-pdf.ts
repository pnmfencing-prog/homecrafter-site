import { jsPDF } from 'jspdf';

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

export function generateProposalPDF(p: ProposalData): Promise<Buffer> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const W = 612;
  const M = 45; // margin
  const RW = W - 2 * M; // usable width

  const spot = p.spot_holding_fee || 150;
  const gateText = p.gate_count && p.gate_count > 0 ? `${p.gate_count} GATE${p.gate_count > 1 ? 'S' : ''}` : 'NO GATES';
  const dateStr = p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  const fullAddr = [p.client_address, p.client_city, p.client_state, p.client_zip].filter(Boolean).join(', ');
  const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let y = M;

  // === HEADER ===
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('PNM FENCING NJ LLC', M, y + 14);
  y += 28;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(102, 102, 102);
  doc.text('PO Box ___ Oakhurst, NJ 07712  |  1-(908)-692-4847', M, y);
  y += 20;

  // Proposal For + Estimate info
  const yFor = y;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(0, 0, 0);
  doc.text('Proposal For:', M, yFor + 12);

  // Right side
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(102, 102, 102);
  doc.text('Estimate No:', 420, yFor + 4, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(p.estimate_no, 425, yFor + 4);
  doc.setFont('helvetica', 'bold');
  doc.text('Date:', 420, yFor + 18, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.text(dateStr, 425, yFor + 18);

  // Client info
  let cy = yFor + 26;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text(p.client_name || '', M + 20, cy);
  cy += 15;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(60, 60, 60);
  if (p.client_email) { doc.text(p.client_email, M + 20, cy); cy += 14; }
  if (fullAddr) { doc.text(fullAddr, M + 20, cy); cy += 14; }

  // Divider
  y = Math.max(cy, yFor + 40) + 8;
  doc.setDrawColor(200, 200, 200);
  doc.line(M, y, W - M, y);
  y += 14;

  // === DESCRIPTION TABLE ===
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('Description', M, y);
  doc.text('Amount', W - M, y, { align: 'right' });
  y += 6;
  doc.setDrawColor(51, 51, 51);
  doc.line(M, y, W - M, y);
  y += 12;

  // Description text
  const descLines = p.description_override ? p.description_override.split('\n') : [
    `Supply and install up to approximately ${p.footage} linear feet of ${p.height || '6ft'} high`,
    `${(p.color || 'WHITE').toUpperCase()} ${p.material || 'vinyl'} solid privacy fencing ${gateText}`,
    `7" heavy duty rails`,
    `Standard post caps`,
    `Disposal of packing materials included.`,
    p.removal_footage && p.removal_footage > 0
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

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(42, 42, 42);

  const amountY = y + 4;
  descLines.forEach(line => {
    if (line === '') { y += 6; return; }
    doc.text(line, M, y);
    y += 13;
  });

  // Amount on right
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(fmt(p.total) + '*', W - M, amountY, { align: 'right' });

  y += 6;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(102, 102, 102);
  doc.text('*Indicates non-taxable item', M, y);
  y += 12;

  doc.setDrawColor(200, 200, 200);
  doc.line(M, y, W - M, y);
  y += 12;

  // === TOTALS ===
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(85, 85, 85);
  doc.text('Subtotal', 440, y, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text(fmt(p.total), W - M, y, { align: 'right' });
  y += 16;

  doc.setDrawColor(200, 200, 200);
  doc.line(400, y, W - M, y);
  y += 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Total', 440, y + 10, { align: 'right' });
  doc.text(fmt(p.total), W - M, y + 10, { align: 'right' });
  y += 28;

  // === NOTES ===
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text('Notes', M, y);
  y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(42, 42, 42);

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

  noteLines.forEach(line => {
    if (line === '') { y += 5; return; }
    doc.text(line, M, y);
    y += 12;
  });
  y += 8;

  // Check if we need a new page for cancellation + signature
  if (y > 580) {
    doc.addPage();
    y = M;
  }

  // === CANCELLATION ===
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  const cancelTitle = doc.splitTextToSize('YOU MAY CANCEL THIS CONTRACT AT ANY TIME BEFORE MIDNIGHT OF THE THIRD BUSINESS DAY AFTER RECEIVING A COPY OF THIS CONTRACT.', RW);
  doc.text(cancelTitle, M, y);
  y += cancelTitle.length * 11 + 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(42, 42, 42);
  const cancelLines = [
    'IF YOU WISH TO CANCEL THIS CONTRACT, YOU MUST EITHER:',
    '1. SEND A SIGNED AND DATED WRITTEN NOTICE OF CANCELLATION BY',
    '   REGISTERED OR CERTIFIED MAIL, RETURN RECEIPT REQUESTED; OR',
    '2. PERSONALLY DELIVER A SIGNED AND DATED WRITTEN NOTICE OF',
    '   CANCELLATION TO:',
    '',
    'PNM Fencing NJ LLC',
    'PO Box ___ Oakhurst, NJ 07712',
    '1-(908)-692-4847',
    '',
    'If you cancel this contract within the three day period, you are entitled to',
    'a full refund of your money. Refunds must be made within 30 days.',
  ];
  cancelLines.forEach(line => {
    if (line === '') { y += 5; return; }
    doc.text(line, M, y);
    y += 11;
  });
  y += 12;

  // === SIGNATURE ===
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(85, 85, 85);
  doc.text('*Acknowledgment of terms above', M, y);
  y += 18;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  ['Print Name:', 'Sign X:', 'Date:'].forEach(label => {
    doc.text(label, M, y);
    doc.line(M + 80, y + 2, 380, y + 2);
    y += 22;
  });

  // Footer
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(102, 102, 102);
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.text(`PNM - Proposal ${p.estimate_no} - ${dateStr}  ${i} / ${totalPages}`, W / 2, 760, { align: 'center' });
  }

  const arrayBuf = doc.output('arraybuffer');
  return Promise.resolve(Buffer.from(arrayBuf));
}
