import PDFDocument from 'pdfkit';

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
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 45, bottom: 50, left: 45, right: 45 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const spot = p.spot_holding_fee || 150;
    const gateText = p.gate_count && p.gate_count > 0 ? `${p.gate_count} GATE${p.gate_count > 1 ? 'S' : ''}` : 'NO GATES';
    const dateStr = p.created_at ? new Date(p.created_at).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
    const fullAddr = [p.client_address, p.client_city, p.client_state, p.client_zip].filter(Boolean).join(', ');
    const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // === HEADER ===
    doc.font('Helvetica-Bold').fontSize(18).text('PNM FENCING NJ LLC', 45, 45);
    doc.font('Helvetica').fontSize(9).fillColor('#666666')
      .text('PO Box ___ Oakhurst, NJ 07712  |  1-(908)-692-4847', 45, 68);

    doc.moveDown(0.8);

    // Proposal For + Estimate info
    const yFor = doc.y;
    doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text('Proposal For:', 45, yFor);

    // Right side
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#666666');
    doc.text('Estimate No:', 400, yFor, { width: 80, align: 'right' });
    doc.font('Helvetica').text(p.estimate_no, 485, yFor);
    doc.font('Helvetica-Bold').text('Date:', 400, yFor + 16, { width: 80, align: 'right' });
    doc.font('Helvetica').text(dateStr, 485, yFor + 16);

    // Client info
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text(p.client_name || '', 65, yFor + 20);
    let clientY = yFor + 36;
    if (p.client_email) {
      doc.font('Helvetica').fontSize(10).fillColor('#3c3c3c').text(p.client_email, 65, clientY);
      clientY += 14;
    }
    if (fullAddr) {
      doc.font('Helvetica').fontSize(10).fillColor('#3c3c3c').text(fullAddr, 65, clientY);
      clientY += 14;
    }

    // Divider
    const divY = Math.max(clientY, yFor + 40) + 8;
    doc.moveTo(45, divY).lineTo(567, divY).strokeColor('#cccccc').stroke();

    // === DESCRIPTION TABLE ===
    let y = divY + 12;
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000');
    doc.text('Description', 45, y);
    doc.text('Amount', 450, y, { width: 117, align: 'right' });
    y += 16;
    doc.moveTo(45, y).lineTo(567, y).strokeColor('#333333').stroke();
    y += 8;

    const description = p.description_override || [
      `Supply and install up to approximately ${p.footage} linear feet of ${p.height || '6ft'} high ${(p.color || 'WHITE').toUpperCase()} ${p.material || 'vinyl'} solid privacy fencing ${gateText}`,
      `7" heavy duty rails`,
      `Standard post caps`,
      `Disposal of packing materials included.`,
      p.removal_footage && p.removal_footage > 0
        ? `Removal of ${p.removal_footage}ft of ${p.removal_type || 'existing fence'} included.`
        : 'No removal of existing fence.',
      'Delivery included.',
      'Concrete on all posts*',
      '',
      'Please note this quote does not include removing or installing any existing paver blocks. Drilling or cutting thru concrete.',
      '',
      'Utility mark-out included.',
      'PNM not responsible for unmarked sprinkler lines and miscellaneous pipes.',
      'Fence to follow grade of ground.',
      'Footing soil dispersed around posts/sections.',
      'PNM not responsible for earth settling.',
    ].filter(l => l !== undefined).join('\n');

    doc.font('Helvetica').fontSize(10).fillColor('#2a2a2a');
    doc.text(description, 45, y, { width: 380, lineGap: 3 });

    // Amount on right
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000');
    doc.text(fmt(p.total) + '*', 450, y + 4, { width: 117, align: 'right' });

    y = doc.y + 10;

    // Footnote
    doc.font('Helvetica').fontSize(9).fillColor('#666666');
    doc.text('*Indicates non-taxable item', 45, y, { oblique: true });
    y += 16;

    doc.moveTo(45, y).lineTo(567, y).strokeColor('#cccccc').stroke();
    y += 10;

    // === TOTALS ===
    doc.font('Helvetica').fontSize(10).fillColor('#555555');
    doc.text('Subtotal', 400, y, { width: 80, align: 'right' });
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000');
    doc.text(fmt(p.total), 485, y, { width: 82, align: 'right' });
    y += 18;
    doc.moveTo(400, y).lineTo(567, y).strokeColor('#cccccc').stroke();
    y += 4;
    doc.font('Helvetica-Bold').fontSize(12);
    doc.text('Total', 400, y, { width: 80, align: 'right' });
    doc.text(fmt(p.total), 485, y, { width: 82, align: 'right' });
    y += 24;

    // === NOTES / PAYMENT TERMS ===
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000000').text('Notes', 45, y);
    y += 18;

    doc.font('Helvetica').fontSize(9.5).fillColor('#2a2a2a');
    const paymentText = [
      `Payment terms: deposit paid in advance: ${fmt(p.deposit)} (${fmt(spot)} spot holding fee supplied and applied to grand total)`,
      '',
      'By supplying the initial deposit above, the customer understands and agrees to abide by all of the terms and conditions set forth in this agreement.',
      '',
      `Second installment due upon material delivery to above referenced job site address in the amount of: ${fmt(p.installment_2)}`,
      '',
      `Remaining balance due upon day of installation completion in the amount of: ${fmt(p.installment_3)}`,
      '',
      'All materials remain property of PNM Fencing NJ LLC until final payment has been satisfied. If final payment is not satisfied upon install completion, PNM Fencing NJ LLC reserves the right to remove provided materials at customer\'s expense.',
      '',
      'All past due balances will be assessed with a penalty interest rate of 28% APR.',
    ].join('\n');

    doc.text(paymentText, 45, y, { width: 520, lineGap: 2 });
    y = doc.y + 12;

    // === CANCELLATION ===
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
    doc.text('YOU MAY CANCEL THIS CONTRACT AT ANY TIME BEFORE MIDNIGHT OF THE THIRD BUSINESS DAY AFTER RECEIVING A COPY OF THIS CONTRACT.', 45, y, { width: 520 });
    y = doc.y + 6;

    doc.font('Helvetica').fontSize(9).fillColor('#2a2a2a');
    doc.text([
      'IF YOU WISH TO CANCEL THIS CONTRACT, YOU MUST EITHER:',
      '1. SEND A SIGNED AND DATED WRITTEN NOTICE OF CANCELLATION BY REGISTERED OR CERTIFIED MAIL, RETURN RECEIPT REQUESTED; OR',
      '2. PERSONALLY DELIVER A SIGNED AND DATED WRITTEN NOTICE OF CANCELLATION TO:',
      '',
      'PNM Fencing NJ LLC',
      'PO Box ___ Oakhurst, NJ 07712',
      '1-(908)-692-4847',
      '',
      'If you cancel this contract within the three day period, you are entitled to a full refund of your money. Refunds must be made within 30 days.',
    ].join('\n'), 45, y, { width: 520, lineGap: 2 });
    y = doc.y + 16;

    // === SIGNATURE BLOCK ===
    doc.font('Helvetica').fontSize(9).fillColor('#555555');
    doc.text('*Acknowledgment of terms above', 45, y, { oblique: true });
    y += 18;

    doc.font('Helvetica').fontSize(10).fillColor('#000000');
    const sigLines = ['Print Name:', 'Sign X:', 'Date:'];
    sigLines.forEach(label => {
      doc.text(label, 45, y);
      doc.moveTo(130, y + 12).lineTo(380, y + 12).strokeColor('#000000').stroke();
      y += 24;
    });

    // Footer
    doc.font('Helvetica').fontSize(9).fillColor('#666666');
    const pageCount = (doc as any).bufferedPageRange?.()?.count || 1;
    doc.text(`PNM - Proposal ${p.estimate_no} - ${dateStr}`, 45, 740, { align: 'center', width: 522 });

    doc.end();
  });
}
