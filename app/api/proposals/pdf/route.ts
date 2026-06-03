import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { normalizeText } from '@/lib/text';

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

  // Track when customer opens the proposal (only update if status is 'sent')
  if (p.status === 'sent') {
    await sql`UPDATE proposals SET status = 'opened', updated_at = NOW() WHERE id = ${p.id} AND status = 'sent'`;
    p.status = 'opened';
  }

  // Generate PDF HTML for viewing in browser
  const spot = Number(p.spot_holding_fee ?? 150);
  const gateText = p.gate_count > 0 ? `${p.gate_count} GATE${p.gate_count > 1 ? 'S' : ''}` : 'NO GATES';
  const removalIncluded = Number(p.removal_footage || 0) > 0 || /removal of existing|removal included|remove existing/i.test(p.description_override || '');
  const standardTerms = `Disposal of packing materials included.
${removalIncluded ? 'Removal of old fencing included.' : 'No removal of old fencing.'}
Delivery included.
Concrete on all posts*

Please note this quote does not include removing or installing any existing paver blocks. Drilling or cutting thru concrete.
Utility mark-out Included.

PNM not responsible for unmarked sprinkler lines and miscellaneous pipes.

Fence to follow grade of ground. Footing soil dispersed around posts/sections. PNM not responsible for earth settling.`;
  
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
<div class="company-sub">PO Box 437 Oakhurst, NJ 07712 | 1-(908)-692-4847</div>

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

${p.redacted ? `
<div style="background:#f8f0f0;border:2px solid #c00;border-radius:8px;padding:30px;text-align:center;margin:40px 0;">
  <p style="font-size:14pt;font-weight:bold;color:#c00;margin:0 0 10px 0;">This proposal has been withdrawn.</p>
  <p style="font-size:10pt;color:#666;margin:0;">This estimate is no longer valid. Please message PNM Fencing for a current quote.</p>
  <p style="font-size:10pt;color:#666;margin:10px 0 0 0;">1-(908)-692-4847</p>
</div>
` : `
<div class="item-header"><span>Description</span><span>Amount</span></div>

<div class="description">${normalizeText(p.description_override || `Supply and install up to approximately ${p.footage} linear feet of ${p.height} high ${(p.color || 'WHITE').toUpperCase()} ${p.material || 'vinyl'} solid privacy fencing ${gateText}
7" heavy duty rails
Standard post caps
${p.removal_footage > 0 ? `Removal of ${p.removal_footage}ft of ${p.removal_type || 'existing fence'} included.` : ''}`)}</div>

<div class="description" style="margin-top:12px">${normalizeText(standardTerms)}</div>

<div class="amount">$${Number(p.total).toLocaleString('en-US', {minimumFractionDigits: 2})}*</div>

<div class="footnote">*Indicates non-taxable item</div>

<div class="divider"></div>

<div class="totals">
  <div class="row"><span>Subtotal</span><span>$${Number(p.total).toLocaleString('en-US', {minimumFractionDigits: 2})}</span></div>
  <div class="row total-row"><span>Total</span><span>$${Number(p.total).toLocaleString('en-US', {minimumFractionDigits: 2})}</span></div>
</div>

<div class="notes">
  <h3>Notes</h3>
  <p>Payment terms: deposit paid in advance: $${Number(p.deposit || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}${spot > 0 ? ` ($${Number(spot).toFixed(2)} spot holding fee supplied and applied to grand total)` : ''}</p>
  <p>By supplying the initial deposit above, the customer understands and agrees to abide by all of the terms and conditions set forth in this agreement.</p>
  <p>Second installment due upon material delivery to above referenced job site address in the amount of: $${Number(p.installment_2 || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</p>
  <p>Remaining balance due upon day of installation completion in the amount of: $${Number(p.installment_3 || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</p>
  <p>All materials remain property of PNM Fencing NJ LLC until final payment has been satisfied. If final payment is not satisfied upon install completion, PNM Fencing NJ LLC reserves the right to remove provided materials at customer's expense.</p>
  <p>All past due balances will be assessed with a penalty interest rate of 28% APR.</p>
  <p style="margin-top:10px">Please note this quote does not include removing or installing any existing paver blocks. Drilling or cutting thru concrete. Utility mark-out Included.</p>
  <p>PNM not responsible for unmarked sprinkler lines and miscellaneous pipes.</p>
  <p>Fence to follow grade of ground. Footing soil dispersed around posts/sections. PNM not responsible for earth settling.</p>
</div>
`}

${p.redacted ? '' : '<div class="cancel"><strong>YOU MAY CANCEL THIS CONTRACT AT ANY TIME BEFORE MIDNIGHT OF THE THIRD BUSINESS DAY AFTER RECEIVING A COPY OF THIS CONTRACT.</strong> IF YOU WISH TO CANCEL THIS CONTRACT, YOU MUST EITHER: <br>1. SEND A SIGNED AND DATED WRITTEN NOTICE OF CANCELLATION BY REGISTERED OR CERTIFIED MAIL, RETURN RECEIPT REQUESTED; OR <br>2. PERSONALLY DELIVER A SIGNED AND DATED WRITTEN NOTICE OF CANCELLATION TO: <br><br>PNM<br>PO Box 437<br>Oakhurst NJ 07712<br>1-(908)-692-4847 <br><br>If you cancel this contract within the three day period, you are entitled to a full refund of your money. Refunds must be made within 30 days.</div>'}

${p.redacted ? '' : (() => {
  if (p.signature_data) {
    return '<div class="sig-block"><p style="font-style:italic;font-size:9pt;color:#666">*Acknowledgment of terms above</p><div style="margin:20px 0;padding:15px;border:1px solid #ddd;border-radius:6px;background:#f9fff9;"><p style="font-weight:bold;color:#28a745;margin-bottom:8px;">✓ DIGITALLY SIGNED</p><div style="font-family:Dancing Script,Brush Script MT,Segoe Script,cursive;font-size:24px;color:#1a1a5e;border-bottom:1px solid #333;display:inline-block;padding-bottom:2px;margin-bottom:8px;">' + (p.signature_name || 'Customer') + '</div><p style="font-size:10px;color:#666;"><strong>Signed by:</strong> ' + (p.signature_name || 'Customer') + '</p><p style="font-size:10px;color:#666;"><strong>Date:</strong> ' + (p.signed_at ? new Date(p.signed_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '') + '</p></div></div>';
  } else {
    return '<div class="sig-block"><p style="font-style:italic;font-size:9pt;color:#666">*Acknowledgment of terms above</p><link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap" rel="stylesheet"><div id="signature-section" style="margin-top:15px;"><div style="margin-bottom:12px;"><label style="font-weight:bold;font-size:11px;">Type Your Full Name to Sign:</label><br><input type="text" id="signer-name" oninput="updatePreview()" style="padding:8px;font-size:16px;width:280px;margin:5px 0;border:1px solid #ccc;border-radius:4px;" placeholder="Enter your full name"></div><div id="signature-preview" style="display:none;margin:10px 0;padding:10px;background:#fafafa;border:1px dashed #ccc;border-radius:4px;"><p style="font-size:9px;color:#999;margin-bottom:4px;">SIGNATURE PREVIEW:</p><div id="sig-display" style="font-family:Dancing Script,Brush Script MT,Segoe Script,cursive;font-size:28px;color:#1a1a5e;border-bottom:1px solid #333;display:inline-block;padding-bottom:2px;"></div><p id="sig-date" style="font-size:10px;color:#666;margin-top:6px;"></p></div><div style="margin:10px 0;"><button type="button" onclick="submitSignature()" style="padding:10px 20px;background:#28a745;color:white;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:600;">✓ Sign & Submit</button></div><p style="font-size:8pt;color:#999;margin-top:8px;">By signing, you agree to the terms and conditions outlined in this proposal.</p></div><script>function updatePreview(){var name=document.getElementById("signer-name").value.trim();var preview=document.getElementById("signature-preview");if(name){preview.style.display="block";document.getElementById("sig-display").textContent=name;document.getElementById("sig-date").textContent="Date: "+new Date().toLocaleDateString();}else{preview.style.display="none";}}function submitSignature(){var name=document.getElementById("signer-name").value.trim();if(!name){alert("Please type your full name to sign");return;}if(!confirm("By clicking OK, you are digitally signing this proposal as \\""+name+"\\". Continue?")){return;}var xhr=new XMLHttpRequest();xhr.open("POST","https://homecrafter.ai/api/proposals/sign");xhr.setRequestHeader("Content-Type","application/json");xhr.onload=function(){if(xhr.status===200){alert("Proposal signed successfully! Thank you.");window.location.reload();}else{alert("Error saving signature. Please try again.");}};xhr.onerror=function(){alert("Error saving signature. Please try again.");};xhr.send(JSON.stringify({estimate_no:"' + estNo + '",signature_data:"typed:"+name,signature_name:name}));}</script></div>';
  }
})()}

</body></html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html' },
  });
}
