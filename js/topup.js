let profile = null;
let waTargets = [];

(async () => {
  profile = await initPage('topup', 'Top Up Budget');
  await loadSettings();
  await loadHistory();
  setupUploadArea();
})();

// ── Load WA targets dari app_settings ──
async function loadSettings() {
  const { data } = await db().from('app_settings').select('value').eq('key', 'topup_wa_targets').single();
  waTargets = data?.value || [];
}

// ── Tab switching ──
function switchTab(tab) {
  document.querySelectorAll('.topup-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.topup-panel').forEach(p => p.style.display = 'none');
  document.querySelector(`.topup-tab[data-tab="${tab}"]`).classList.add('active');
  document.getElementById('panel-' + tab).style.display = 'block';
  if (tab === 'riwayat') loadHistory();
}

// ── File upload drag & drop ──
function setupUploadArea() {
  const area = document.getElementById('ss-drop');
  const inp  = document.getElementById('ss-input');
  if (!area || !inp) return;

  area.addEventListener('click', () => inp.click());
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
  area.addEventListener('drop', e => {
    e.preventDefault(); area.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelected(file);
  });
  inp.addEventListener('change', () => {
    if (inp.files[0]) handleFileSelected(inp.files[0]);
  });
}

let selectedFile = null;

function handleFileSelected(file) {
  if (!file.type.startsWith('image/')) {
    showToast('File harus berupa gambar (PNG/JPG)', 'error'); return;
  }
  if (file.size > 4 * 1024 * 1024) {
    showToast('Screenshot terlalu besar, maksimal 4MB', 'error'); return;
  }
  selectedFile = file;
  const area = document.getElementById('ss-drop');
  const preview = document.getElementById('ss-preview');
  const reader = new FileReader();
  reader.onload = e => {
    preview.src = e.target.result;
    preview.style.display = 'block';
    area.querySelector('.ss-placeholder').style.display = 'none';
  };
  reader.readAsDataURL(file);
  document.getElementById('ss-filename').textContent = file.name;
}

// ── Submit request ──
async function submitTopup() {
  const nominal = parseInt(document.getElementById('tp-nominal').value.replace(/\D/g,'')) || 0;
  const errEl = document.getElementById('tp-err');
  errEl.style.display = 'none';

  if (!nominal || nominal < 1000) {
    errEl.textContent = 'Masukkan nominal top up yang valid.'; errEl.style.display = 'block'; return;
  }
  if (!selectedFile) {
    errEl.textContent = 'Upload screenshot TikTok Ads terlebih dahulu.'; errEl.style.display = 'block'; return;
  }

  const btn = document.getElementById('tp-submit');
  btn.disabled = true;
  btn.textContent = 'Menganalisis screenshot...';

  try {
    // 1. Convert image ke base64
    const base64 = await fileToBase64(selectedFile);
    const mimeType = selectedFile.type;

    // 2. Claude Vision extract
    const extractResp = await fetch('/api/topup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'extract', image_base64: base64, mime_type: mimeType })
    });
    const extractData = await extractResp.json();
    if (!extractData.ok) throw new Error(extractData.error || 'Gagal analisis screenshot');

    const ext = extractData.data;
    const user = await getUser();

    // 3. Simpan ke DB
    btn.textContent = 'Menyimpan request...';
    const approveToken = crypto.randomUUID();
    const { data: saved, error: dbErr } = await db().from('topup_requests').insert({
      user_id: user.id,
      user_name: profile?.nama || user.email,
      nominal,
      extracted_data: ext,
      status: 'pending',
      approve_token: approveToken
    }).select().single();

    if (dbErr) throw new Error(dbErr.message);

    // 4. Kirim notif WA
    if (waTargets.length) {
      btn.textContent = 'Mengirim notifikasi...';
      const approveLink = `${window.location.origin}/api/approve?id=${saved.id}&token=${approveToken}`;
      const pesan = buildWaMessage(profile?.nama || user.email, nominal, ext, approveLink);
      await fetch('/api/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'notify', wa_targets: waTargets, message: pesan })
      });
    }

    // 5. Tampilkan sukses
    showSuccess(nominal, ext);
    resetForm();

  } catch (e) {
    errEl.textContent = e.message; errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Request';
  }
}

function buildWaMessage(nama, nominal, ext, approveLink) {
  const fmtNum = n => n != null ? Number(n).toLocaleString('id-ID') : '-';
  const lines = [
    `🔔 *Top Up Request — GMV Tracker*`,
    ``,
    `👤 *${nama}* minta top up:`,
    `💰 *Nominal: Rp ${fmtNum(nominal)}*`,
    ``,
    `📊 Hasil dari Screenshot:`,
    ext.shop_name        ? `• Toko: ${ext.shop_name}` : null,
    ext.period           ? `• Periode: ${ext.period}` : null,
    ext.cost        != null ? `• Cost: Rp ${fmtNum(ext.cost)}` : null,
    ext.sku_orders  != null ? `• SKU Orders: ${fmtNum(ext.sku_orders)}` : null,
    ext.gross_revenue != null ? `• Gross Revenue: Rp ${fmtNum(ext.gross_revenue)}` : null,
    ext.roi         != null ? `• ROI: ${Number(ext.roi).toFixed(2)}x` : null,
    ``,
    `✅ *Approve request ini:*`,
    approveLink,
    ``,
    `_${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}_`
  ].filter(l => l !== null);
  return lines.join('\n');
}

function showSuccess(nominal, ext) {
  const box = document.getElementById('tp-success');
  const fmtNum = n => n != null ? Number(n).toLocaleString('id-ID') : '-';
  box.innerHTML = `
    <div style="background:#ecfdf5;border:1px solid #6ee7b7;border-radius:12px;padding:20px;margin-top:16px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <span style="font-size:20px">✅</span>
        <strong style="color:#065f46">Request berhasil dikirim!</strong>
      </div>
      <div style="font-size:13px;color:#047857;line-height:1.8">
        <div>Nominal: <strong>Rp ${fmtNum(nominal)}</strong></div>
        ${ext.shop_name ? `<div>Toko: <strong>${ext.shop_name}</strong></div>` : ''}
        ${ext.period ? `<div>Periode: <strong>${ext.period}</strong></div>` : ''}
        ${ext.cost != null ? `<div>Cost: <strong>Rp ${fmtNum(ext.cost)}</strong></div>` : ''}
        ${ext.gross_revenue != null ? `<div>Revenue: <strong>Rp ${fmtNum(ext.gross_revenue)}</strong></div>` : ''}
        ${ext.roi != null ? `<div>ROI: <strong>${Number(ext.roi).toFixed(2)}x</strong></div>` : ''}
      </div>
      <div style="font-size:12px;color:#6ee7b7;margin-top:8px">Notifikasi sudah dikirim. Tunggu konfirmasi dari admin.</div>
    </div>`;
}

function resetForm() {
  document.getElementById('tp-nominal').value = '';
  selectedFile = null;
  document.getElementById('ss-input').value = '';
  document.getElementById('ss-preview').style.display = 'none';
  document.getElementById('ss-preview').src = '';
  document.getElementById('ss-placeholder').style.display = 'flex';
  document.getElementById('ss-filename').textContent = '';
}

// ── Load History ──
async function loadHistory() {
  const el = document.getElementById('history-list');
  el.innerHTML = '<div class="loader"><div class="spinner"></div></div>';

  const user = await getUser();
  let q = db().from('topup_requests').select('*').order('created_at', { ascending: false });
  if (profile?.role !== 'admin') q = q.eq('user_id', user.id);

  const { data, error } = await q;
  if (error) { el.innerHTML = `<div class="empty-state"><p>${error.message}</p></div>`; return; }
  if (!data?.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">💳</div><h3>Belum ada request</h3><p>Request top up pertama kamu akan muncul di sini.</p></div>';
    return;
  }

  const isAdmin = profile?.role === 'admin';
  el.innerHTML = data.map(r => renderHistoryCard(r, isAdmin)).join('');
}

function renderHistoryCard(r, isAdmin) {
  const ext = r.extracted_data || {};
  const fmtNum = n => n != null ? Number(n).toLocaleString('id-ID') : '-';
  const statusBadge = {
    pending:  '<span class="badge badge-orange">Menunggu</span>',
    approved: '<span class="badge badge-scale">Disetujui</span>',
    rejected: '<span class="badge badge-kill">Ditolak</span>'
  }[r.status] || '';

  const tgl = new Date(r.created_at).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Jakarta' });

  return `<div class="card mb-12" id="req-${r.id}">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
      <div>
        ${isAdmin ? `<div style="font-size:12px;color:#64748b;margin-bottom:4px">👤 ${r.user_name || '-'}</div>` : ''}
        <div style="font-size:18px;font-weight:700;color:#1e293b">Rp ${fmtNum(r.nominal)}</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:2px">${tgl}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${statusBadge}
        ${isAdmin && r.status === 'pending' ? `
          <button class="btn btn-scale btn-sm" onclick="approveRequest('${r.id}')">✓ Approve</button>
          <button class="btn btn-kill btn-sm" onclick="rejectRequest('${r.id}')">✗ Tolak</button>
        ` : ''}
      </div>
    </div>
    ${Object.keys(ext).length ? `
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">
      ${ext.shop_name ? `<div class="info-chip">🏪 ${ext.shop_name}</div>` : ''}
      ${ext.period ? `<div class="info-chip">📅 ${ext.period}</div>` : ''}
      ${ext.cost != null ? `<div class="info-chip">💸 Cost: Rp ${fmtNum(ext.cost)}</div>` : ''}
      ${ext.sku_orders != null ? `<div class="info-chip">📦 Orders: ${fmtNum(ext.sku_orders)}</div>` : ''}
      ${ext.gross_revenue != null ? `<div class="info-chip">💰 Revenue: Rp ${fmtNum(ext.gross_revenue)}</div>` : ''}
      ${ext.roi != null ? `<div class="info-chip ${roasClass(ext.roi)}">ROI: ${Number(ext.roi).toFixed(2)}x</div>` : ''}
    </div>` : ''}
    ${r.catatan ? `<div style="margin-top:8px;font-size:12px;color:#64748b;background:#f8fafc;padding:8px 10px;border-radius:8px">📝 ${r.catatan}</div>` : ''}
  </div>`;
}

// ── Admin: Approve / Reject ──
async function approveRequest(id) {
  if (!confirm('Approve request top up ini?')) return;
  const catatan = prompt('Catatan (opsional):') || '';
  await db().from('topup_requests').update({ status: 'approved', catatan, updated_at: new Date().toISOString() }).eq('id', id);
  showToast('Request disetujui!', 'success');
  loadHistory();
}

async function rejectRequest(id) {
  if (!confirm('Tolak request top up ini?')) return;
  const catatan = prompt('Alasan penolakan:') || '';
  await db().from('topup_requests').update({ status: 'rejected', catatan, updated_at: new Date().toISOString() }).eq('id', id);
  showToast('Request ditolak.', 'error');
  loadHistory();
}

// ── Helpers ──
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const b64 = e.target.result.split(',')[1];
      resolve(b64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatNominalInput(el) {
  const raw = el.value.replace(/\D/g, '');
  el.value = raw ? Number(raw).toLocaleString('id-ID') : '';
}
