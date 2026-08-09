// ===== REQUEST CREATOR PAGE =====

let _myProfile   = null;
let _allRequests = [];
let _tokoList    = [];
let _produkList  = [];

const STATUS_CONFIG = {
  pending:  { label: 'Pending',  bg: '#fef3c7', color: '#b45309' },
  done:     { label: 'Done',     bg: '#dcfce7', color: '#15803d' },
  rejected: { label: 'Rejected', bg: '#fef2f2', color: '#dc2626' },
};

function statusBadge(s) {
  const cfg = STATUS_CONFIG[s] || STATUS_CONFIG.pending;
  return `<span style="background:${cfg.bg};color:${cfg.color};padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600;">${cfg.label}</span>`;
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('id-ID', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

async function loadMasterData() {
  try {
    const { data } = await kolDb().from('kol_master').select('*').order('name');
    _tokoList   = (data || []).filter(r => r.type === 'toko');
    _produkList = (data || []).filter(r => r.type === 'produk');
    const sel = document.getElementById('inp-toko');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Pilih Toko —</option>' +
      _tokoList.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('');
  } catch(e) { console.error('loadMasterData:', e); }
}

function onTokoChange() {
  const tokoId = document.getElementById('inp-toko').value;
  const sel    = document.getElementById('inp-produk');
  if (!sel) return;
  const filtered = _produkList.filter(p => p.toko_id === tokoId);
  sel.innerHTML = '<option value="">— Pilih Produk (opsional) —</option>' +
    filtered.map(p => `<option value="${p.name}">${escHtml(p.name)}</option>`).join('');
}

function renderTable(rows) {
  const tbody = document.getElementById('req-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="7">
      <div class="no-data-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <p>Belum ada request</p>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td style="font-size:12px;white-space:nowrap;color:#64748b;">${fmtDate(r.created_at)}</td>
      <td>
        <a href="https://www.tiktok.com/@${escHtml(r.tiktok_username.replace('@',''))}" target="_blank"
          style="color:var(--primary);font-weight:600;text-decoration:none;font-size:13px;">
          @${escHtml(r.tiktok_username.replace('@',''))}
        </a>
      </td>
      <td style="font-size:12px;font-weight:600;">${escHtml(r.toko_name || '—')}</td>
      <td style="font-size:12px;color:#64748b;">${escHtml(r.produk_name || '—')}</td>
      <td style="font-size:13px;max-width:280px;color:var(--text);">${escHtml(r.catatan || '—')}</td>
      <td style="font-size:12px;font-weight:600;color:#64748b;">${escHtml(r.advertiser_name || '—')}</td>
      <td>${statusBadge(r.status || 'pending')}</td>
    </tr>
  `).join('');
}

function applyFilter() {
  const status = document.getElementById('fil-status').value;
  return _allRequests.filter(r => !status || (r.status || 'pending') === status);
}

async function loadRequests() {
  try {
    const { data, error } = await kolDb()
      .from('creator_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    _allRequests = data || [];
    renderTable(applyFilter());
  } catch(e) {
    console.error(e);
    document.getElementById('req-tbody').innerHTML =
      `<tr><td colspan="5" style="text-align:center;padding:30px;color:#ef4444;font-size:13px;">Gagal memuat histori</td></tr>`;
  }
}

async function submitRequest() {
  const tiktok   = document.getElementById('inp-tiktok').value.trim().replace('@','');
  const catatan  = document.getElementById('inp-catatan').value.trim();
  const tokoId   = document.getElementById('inp-toko').value;
  const tokoName = tokoId ? (_tokoList.find(t => t.id === tokoId)?.name || '') : '';
  const produk   = document.getElementById('inp-produk').value;

  if (!tiktok)  { showToast('Username TikTok wajib diisi', 'error'); return; }
  if (!tokoId)  { showToast('Pilih toko terlebih dahulu', 'error'); return; }

  const btn = document.getElementById('btn-submit');
  btn.textContent = 'Mengirim...';
  btn.disabled = true;

  try {
    const { error } = await kolDb().from('creator_requests').insert({
      tiktok_username: tiktok,
      catatan:         catatan  || null,
      toko_id:         tokoId   || null,
      toko_name:       tokoName || null,
      produk_name:     produk   || null,
      advertiser_name: _myProfile?.nama || 'Advertiser',
      advertiser_id:   _myProfile?.id   || null,
      status:          'pending',
    });
    if (error) throw error;

    document.getElementById('inp-tiktok').value  = '';
    document.getElementById('inp-catatan').value = '';
    document.getElementById('inp-toko').value    = '';
    document.getElementById('inp-produk').innerHTML = '<option value="">— Pilih Produk (opsional) —</option>';
    showToast('Request berhasil dikirim!', 'success');
    await loadRequests();
  } catch(e) {
    showToast('Gagal mengirim request', 'error');
  } finally {
    btn.textContent = 'Kirim Request';
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  _myProfile = await initPage('request-creator', 'Request Creator');

  document.getElementById('fil-status').addEventListener('change', () => {
    renderTable(applyFilter());
  });

  await loadMasterData();
  await loadRequests();
});
