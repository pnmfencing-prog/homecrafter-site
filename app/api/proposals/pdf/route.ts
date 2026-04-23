import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';

function isAdmin(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === (process.env.ADMIN_TOKEN || 'hc-admin-2026');
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  
  // Accept token via query param for direct links
  const tokenParam = searchParams.get('token');
  const adminToken = process.env.ADMIN_TOKEN || 'hc-admin-2026';
  if (!isAdmin(request) && tokenParam !== adminToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const estNo = searchParams.get('estimate_no');
  if (!estNo) return NextResponse.json({ error: 'estimate_no required' }, { status: 400 });

  const proposals = await sql`SELECT * FROM proposals WHERE estimate_no = ${estNo}`;
  if (!proposals.length) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const p = proposals[0];

  // Generate PDF HTML for viewing in browser
  const spot = p.spot_holding_fee || 150;
  const gateText = p.gate_count > 0 ? `${p.gate_count} GATE${p.gate_count > 1 ? 'S' : ''}` : 'NO GATES';
  
  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PNM Estimate ${p.estimate_no}</title>
<style>
  body { font-family: Helvetica, Arial, sans-serif; max-width: 750px; margin: 0 auto; padding: 40px 30px; color: #000; font-size: 11pt; line-height: 1.5; }
  .header { display: flex; justify-content: space-between; margin-bottom: 10px; }
  .company { font-size: 18pt; font-weight: bold; }
  .company-sub { font-size: 9pt; color: #666; margin-bottom: 15px; }
  .for-label { font-size: 13pt; font-weight: bold; margin-bottom: 5px; }
  .client-info { font-size: 10pt; color: #333; }
  .est-info { text-align: right; font-size: 10pt; }
  .est-info .label { font-weight: bold; }
  .divider { border-bottom: 1px solid #ddd; margin: 15px 0; }
  .item-header { display: flex; justify-content: space-between; border-bottom: 1px solid #333; padding-bottom: 5px; font-weight: bold; font-size: 10pt; margin-bottom: 10px; }
  .description { font-size: 10pt; color: #333; line-height: 1.7; white-space: pre-line; }
  .amount { font-size: 13pt; font-weight: bold; text-align: right; margin-top: 10px; }
  .footnote { font-size: 9pt; color: #666; font-style: italic; margin-top: 8px; }
  .totals { margin-left: auto; width: 250px; margin-top: 15px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 10pt; }
  .totals .total-row { font-weight: bold; font-size: 12pt; border-top: 2px solid #333; padding-top: 6px; }
  .notes { margin-top: 25px; font-size: 9.5pt; color: #333; line-height: 1.6; }
  .notes h3 { font-size: 12pt; margin-bottom: 8px; }
  .cancel { font-size: 9pt; margin-top: 15px; }
  .cancel strong { display: block; margin-bottom: 5px; }
  .sig-block { margin-top: 30px; }
  .sig-block .sig-line { margin-bottom: 15px; font-size: 10pt; }
  .sig-block .sig-line span { display: inline-block; width: 100px; }
  .sig-block .sig-line .line { display: inline-block; border-bottom: 1px solid #000; width: 300px; }
  .print-btn { position: fixed; top: 10px; right: 10px; background: #1e1845; color: #c4aa6a; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 12px; }
  @media print { .print-btn { display: none; } }
</style></head><body>
<button class="print-btn" onclick="window.print()">🖨 Print / Save PDF</button>

<div class="company">PNM FENCING NJ LLC</div>
<div class="company-sub">PO Box ___ Oakhurst, NJ 07712 | 1-(908)-692-4847</div>

<div class="header">
  <div>
    <div class="for-label">Proposal For:</div>
    <div class="client-info">
      <strong>${p.client_name || ''}</strong><br>
      ${p.client_email || ''}<br>
      ${[p.client_address, p.client_city, p.client_state, p.client_zip].filter(Boolean).join(', ')}
    </div>
  </div>
  <div class="est-info">
    <div><span class="label">Estimate No:</span> ${p.estimate_no}</div>
    <div><span class="label">Date:</span> ${new Date(p.created_at).toLocaleDateString('en-US', {month:'2-digit',day:'2-digit',year:'numeric'})}</div>
  </div>
</div>

<div class="divider"></div>

<div class="item-header"><span>Description</span><span>Amount</span></div>

<div class="description">${p.description_override || `Supply and install up to approximately ${p.footage} linear feet of ${p.height} high ${(p.color || 'WHITE').toUpperCase()} ${p.material || 'vinyl'} solid privacy fencing ${gateText}
7" heavy duty rails
Standard post caps
Disposal of packing materials included.
${p.removal_footage > 0 ? `Removal of ${p.removal_footage}ft of ${p.removal_type || 'existing fence'} included.` : 'No removal of existing fence.'}
Delivery included.
Concrete on all posts*

Please note this quote does not include removing or installing any existing paver blocks. Drilling or cutting thru concrete.

Utility mark-out included.
PNM not responsible for unmarked sprinkler lines and miscellaneous pipes.
Fence to follow grade of ground.
Footing soil dispersed around posts/sections.
PNM not responsible for earth settling.`}</div>

<div class="amount">$${Number(p.total).toLocaleString('en-US', {minimumFractionDigits: 2})}*</div>

<div class="footnote">*Indicates non-taxable item</div>

<div class="divider"></div>

<div class="totals">
  <div class="row"><span>Subtotal</span><span>$${Number(p.total).toLocaleString('en-US', {minimumFractionDigits: 2})}</span></div>
  <div class="row total-row"><span>Total</span><span>$${Number(p.total).toLocaleString('en-US', {minimumFractionDigits: 2})}</span></div>
</div>

<div class="notes">
  <h3>Notes</h3>
  <p>Payment terms: deposit paid in advance: $${Number(p.deposit || 0).toLocaleString('en-US', {minimumFractionDigits: 2})} ($${Number(spot).toFixed(2)} spot holding fee supplied and applied to grand total)</p>
  <p>By supplying the initial deposit above, the customer understands and agrees to abide by all of the terms and conditions set forth in this agreement.</p>
  <p>Second installment due upon material delivery to above referenced job site address in the amount of: $${Number(p.installment_2 || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</p>
  <p>Remaining balance due upon day of installation completion in the amount of: $${Number(p.installment_3 || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</p>
  <p>All materials remain property of PNM Fencing NJ LLC until final payment has been satisfied. If final payment is not satisfied upon install completion, PNM Fencing NJ LLC reserves the right to remove provided materials at customer's expense.</p>
  <p>All past due balances will be assessed with a penalty interest rate of 28% APR.</p>
</div>

<div class="cancel">
  <strong>YOU MAY CANCEL THIS CONTRACT AT ANY TIME BEFORE MIDNIGHT OF THE THIRD BUSINESS DAY AFTER RECEIVING A COPY OF THIS CONTRACT.</strong>
  IF YOU WISH TO CANCEL THIS CONTRACT, YOU MUST EITHER:
  <br>1. SEND A SIGNED AND DATED WRITTEN NOTICE OF CANCELLATION BY REGISTERED OR CERTIFIED MAIL, RETURN RECEIPT REQUESTED; OR
  <br>2. PERSONALLY DELIVER A SIGNED AND DATED WRITTEN NOTICE OF CANCELLATION TO:
  <br><br>PNM Fencing NJ LLC<br>PO Box ___ Oakhurst, NJ 07712<br>1-(908)-692-4847
  <br><br>If you cancel this contract within the three day period, you are entitled to a full refund of your money. Refunds must be made within 30 days.
</div>

<div class="sig-block">
  <p style="font-style:italic;font-size:9pt;color:#666">*Acknowledgment of terms above</p>
  
  ${p.signature_data ? `
    <div style="margin: 20px 0;">
      <p style="font-weight:bold;color:#28a745;">✓ DIGITALLY SIGNED</p>
      <p><strong>Signed by:</strong> ${p.signature_name || 'Customer'}</p>
      <p><strong>Date:</strong> ${p.signed_at ? new Date(p.signed_at).toLocaleDateString() : ''}</p>
      <div style="border: 1px solid #ddd; padding: 10px; margin: 10px 0;">
        <img src="${p.signature_data}" style="max-width: 300px; max-height: 100px;" />
      </div>
    </div>
  ` : `
    <div id="signature-section">
      <div style="margin: 15px 0;">
        <label for="signer-name" style="font-weight:bold; font-size: 12px;">Print Your Name:</label><br>
        <input type="text" id="signer-name" style="padding: 6px; font-size: 12px; width: 250px; margin: 5px 0; border: 1px solid #ccc;" placeholder="Enter your full name">
      </div>
      
      <div style="margin: 15px 0;">
        <p style="font-weight:bold;">Sign Below:</p>
        <canvas id="signature-canvas" 
                style="border: 1px solid #333; background: white; touch-action: none; cursor: crosshair;"
                width="250" height="80"></canvas>
        <div style="margin: 8px 0;">
          <button id="clear-signature" style="padding: 6px 12px; margin-right: 8px; background: #dc3545; color: white; border: none; cursor: pointer; font-size: 12px;">Clear</button>
          <button id="save-signature" style="padding: 6px 12px; background: #28a745; color: white; border: none; cursor: pointer; font-size: 12px;">Sign & Save</button>
        </div>
        <p style="font-size: 9pt; color: #666; margin-top: 10px;">Sign with your finger on mobile or mouse on desktop</p>
      </div>
    </div>
    
    <script>
      const canvas = document.getElementById('signature-canvas');
      const ctx = canvas.getContext('2d');
      const nameInput = document.getElementById('signer-name');
      let isDrawing = false;
      let hasSignature = false;
      
      // Set up canvas for high DPI
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      
      function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const clientX = e.clientX || (e.touches && e.touches[0].clientX);
        const clientY = e.clientY || (e.touches && e.touches[0].clientY);
        return {
          x: (clientX - rect.left) * (canvas.width / rect.width) / dpr,
          y: (clientY - rect.top) * (canvas.height / rect.height) / dpr
        };
      }
      
      function startDrawing(e) {
        isDrawing = true;
        hasSignature = true;
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        e.preventDefault();
      }
      
      function draw(e) {
        if (!isDrawing) return;
        const pos = getPos(e);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#000';
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        e.preventDefault();
      }
      
      function stopDrawing() {
        isDrawing = false;
      }
      
      // Mouse events
      canvas.addEventListener('mousedown', startDrawing);
      canvas.addEventListener('mousemove', draw);
      canvas.addEventListener('mouseup', stopDrawing);
      
      // Touch events
      canvas.addEventListener('touchstart', startDrawing);
      canvas.addEventListener('touchmove', draw);
      canvas.addEventListener('touchend', stopDrawing);
      
      // Clear signature
      document.getElementById('clear-signature').addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        hasSignature = false;
      });
      
      // Save signature
      document.getElementById('save-signature').addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) {
          alert('Please enter your name');
          return;
        }
        if (!hasSignature) {
          alert('Please provide your signature');
          return;
        }
        
        const signatureData = canvas.toDataURL();
        
        try {
          const response = await fetch('/api/proposals/sign', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              estimate_no: '${estNo}',
              signature_data: signatureData,
              signature_name: name
            })
          });
          
          if (response.ok) {
            alert('Proposal signed successfully!');
            window.location.reload();
          } else {
            alert('Error saving signature');
          }
        } catch (error) {
          alert('Error saving signature');
        }
      });
    </script>
  `}
</div>

</body></html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
