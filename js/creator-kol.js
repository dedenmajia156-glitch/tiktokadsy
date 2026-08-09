// ===== CREATOR: KOL PAGE =====
// Data read-only dari KOL Management Supabase

let _kolAll    = [];  // semua KOL
let _listingMap = {}; // { kol_id: listingRecord }
let _videosMap  = {}; // { kol_id: [ videoRecord ] }
let _tokoList   = []; // [ { id, name } ] dari kol_master
let _currentPage   = 1;
const PAGE_SIZE    = 20;
let _activeCardFilter = null; // 'deal' | 'priority' | null
let _requestsMap  = {}; // { kol_id: count } jumlah catatan
let _activeKolId  = null;
let _activeKolName = null;
let _myProfile    = null;

const STATUS_LABEL = {
  new: 'Belum Hubungi', contacted: 'Dihubungi',
  replied: 'Reply', deal: 'Deal',
  followup: 'Follow Up', rejected: 'Rejected',
};

function statusBadge(s) {
  return `<span class="status-badge ${s || 'new'}">${STATUS_LABEL[s] || s || '-'}</span>`;
}

function tierBadge(t) {
  if (!t) return '-';
  return `<span class="tier-badge ${t.toLowerCase()}">${t.charAt(0).toUpperCase() + t.slice(1)}</span>`;
}

function evalBadge(result) {
  if (!result) return '<span style="color:#94a3b8;font-size:12px;">—</span>';
  const cls = result.toLowerCase();
  return `<span class="eval-badge ${cls}">${result}</span>`;
}

function fmtFollowers(n) {
  if (!n) return '-';
  const num = parseInt(n.toString().replace(/[^0-9]/g, '')) || 0;
  if (num >= 1e6) return (num / 1e6).toFixed(1) + 'M';
  if (num >= 1e3) return (num / 1e3).toFixed(1) + 'K';
  return num.toString();
}

function renderStats(data) {
  const listed   = data.filter(k => _listingMap[k.id]);
  const total    = listed.length;
  const deal     = listed.filter(k => k.status === 'deal').length;
  const priority = listed.filter(k => k.is_priority).length;
  const scores   = listed.map(k => k.score || 0).filter(s => s > 0);
  const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

  document.getElementById('stat-total').textContent    = total;
  document.getElementById('stat-deal').textContent     = deal;
  document.getElementById('stat-priority').textContent = priority;
  document.getElementById('stat-avgscore').textContent = avgScore || '—';
}

function setCardFilter(type) {
  // Toggle: klik card yang sama → reset
  _activeCardFilter = _activeCardFilter === type ? null : type;

  // Update visual aktif
  document.querySelectorAll('.creator-stat-card').forEach(el => el.classList.remove('card-active'));
  if (_activeCardFilter) {
    document.getElementById(`card-${_activeCardFilter}`)?.classList.add('card-active');
  }

  // Reset status dropdown kalau filter dari card
  if (_activeCardFilter !== 'deal') {
    document.getElementById('fil-status').value = '';
  } else {
    document.getElementById('fil-status').value = 'deal';
  }

  _currentPage = 1;
  renderTable(applyFilters());
}

function populateTokoDropdown() {
  const sel = document.getElementById('fil-toko');
  if (!sel) return;
  const saved = sel.value;
  sel.innerHTML = '<option value="">Semua Toko</option>' +
    _tokoList.map(t => `<option value="${escHtml(t.name)}">${escHtml(t.name)}</option>`).join('');
  if (saved) sel.value = saved;
}

function applyFilters() {
  const toko   = document.getElementById('fil-toko').value;
  const status = document.getElementById('fil-status').value;
  const tier   = document.getElementById('fil-tier').value;
  const eval_  = document.getElementById('fil-eval').value;
  const q      = document.getElementById('fil-search').value.toLowerCase().trim();

  return _kolAll.filter(k => {
    const listing = _listingMap[k.id];

    // Hanya tampilkan yang sudah listing
    if (!listing) return false;

    // Filter dari card
    if (_activeCardFilter === 'priority' && !k.is_priority) return false;

    // Filter toko: match via kol_listing.toko
    if (toko) {
      const listingToko = (listing?.toko || '').trim();
      if (listingToko !== toko) return false;
    }

    if (status && k.status !== status) return false;
    if (tier && (k.tier || '').toLowerCase() !== tier) return false;

    const evalResult = (listing?.eval_result || '').toLowerCase();
    if (eval_ === '__none' && evalResult) return false;
    if (eval_ && eval_ !== '__none' && evalResult !== eval_.toLowerCase()) return false;

    if (q) {
      const hay = [k.name, k.tiktok, k.niche, k.product].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderPagination(total) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const el = document.getElementById('kol-pagination');
  if (!el) return;

  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const from = (_currentPage - 1) * PAGE_SIZE + 1;
  const to   = Math.min(_currentPage * PAGE_SIZE, total);

  el.innerHTML = `
    <div class="pagination-wrap">
      <span class="pag-info">${from}–${to} dari ${total} KOL</span>
      <div class="pag-controls">
        <button class="pag-btn" onclick="goPage(${_currentPage - 1})" ${_currentPage === 1 ? 'disabled' : ''}>‹ Prev</button>
        ${Array.from({length: totalPages}, (_,i) => i+1).map(p =>
          `<button class="pag-btn ${p === _currentPage ? 'active' : ''}" onclick="goPage(${p})">${p}</button>`
        ).join('')}
        <button class="pag-btn" onclick="goPage(${_currentPage + 1})" ${_currentPage === totalPages ? 'disabled' : ''}>Next ›</button>
      </div>
    </div>`;
}

function goPage(p) {
  const total = applyFilters().length;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  if (p < 1 || p > totalPages) return;
  _currentPage = p;
  renderTable(applyFilters());
  document.querySelector('.table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderTable(rows) {
  const tbody = document.getElementById('kol-tbody');
  renderPagination(rows.length);
  const paged = rows.slice((_currentPage - 1) * PAGE_SIZE, _currentPage * PAGE_SIZE);
  if (!paged.length) {
    tbody.innerHTML = `<tr><td colspan="10">
      <div class="no-data-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <p>Tidak ada data yang sesuai filter</p>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = paged.map(k => {
    const listing  = _listingMap[k.id];
    const videos   = _videosMap[k.id] || [];
    const evalRes  = listing?.eval_result || null;
    const tokoName = listing?.toko || '';
    const score    = k.score || 0;
    const scoreColor = score >= 70 ? '#16a34a' : score >= 40 ? '#ca8a04' : '#dc2626';

    const tiktokLink = k.tiktok
      ? `<a href="https://www.tiktok.com/@${k.tiktok.replace('@','')}" target="_blank" style="color:var(--primary);text-decoration:none;font-size:12px;">@${k.tiktok.replace('@','')}</a>`
      : '<span style="color:#94a3b8;font-size:12px;">—</span>';

    const priorityStar = k.is_priority ? '<span class="priority-star" title="Talent Prioritas">★</span> ' : '';

    const tokoBadge = tokoName
      ? `<span style="background:#ede9fe;color:#7c3aed;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600;">${escHtml(tokoName)}</span>`
      : '<span style="color:#94a3b8;font-size:12px;">—</span>';

    return `<tr>
      <td>
        <div style="font-weight:600;font-size:13px;">${priorityStar}${escHtml(k.name || '-')}</div>
        ${k.wa ? `<div style="font-size:11px;color:#94a3b8;">${escHtml(k.wa)}</div>` : ''}
      </td>
      <td>${tiktokLink}</td>
      <td style="font-size:13px;">${fmtFollowers(k.followers)}</td>
      <td>${tierBadge(k.tier)}</td>
      <td>${tokoBadge}</td>
      <td style="font-size:12px;max-width:160px;">
        ${listing?.produk ? `<div style="font-weight:500;">${escHtml(listing.produk)}</div>` : ''}
        ${k.niche ? `<div style="color:#94a3b8;">${escHtml(k.niche)}</div>` : ''}
        ${!listing?.produk && !k.niche ? '—' : ''}
      </td>
      <td style="min-width:140px;">
        ${videos.length ? videos.map(v => {
          const judul = (v.judul || 'Video').slice(0, 22) + ((v.judul || '').length > 22 ? '...' : '');
          return v.link_video
            ? `<div style="margin-bottom:4px;"><a href="${escHtml(v.link_video)}" target="_blank" style="color:var(--primary);font-size:12px;text-decoration:none;">▶ ${escHtml(judul)}</a></div>`
            : `<div style="margin-bottom:4px;"><span style="font-size:12px;color:#94a3b8;">▶ ${escHtml(judul)}</span></div>`;
        }).join('')
        : '<span style="color:#94a3b8;font-size:12px;">—</span>'}
      </td>
      <td>
        ${videos.filter(v => v.kode_boost).length
          ? videos.filter(v => v.kode_boost).map(v =>
              `<div style="margin-bottom:4px;"><span onclick="copyKodeBoost('${escHtml(v.kode_boost)}')" style="background:#fef3c7;color:#92400e;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;cursor:pointer;" title="Klik untuk copy">${escHtml(v.kode_boost)}</span></div>`
            ).join('')
          : '<span style="color:#94a3b8;font-size:12px;">—</span>'}
      </td>
      <td>${evalBadge(evalRes)}</td>
      <td style="text-align:center;">
        <button onclick="openCatatanModal('${escHtml(k.id)}','${escHtml(k.name || '')}')"
          style="background:${_requestsMap[k.id] ? '#ede9fe' : '#f1f5f9'};color:${_requestsMap[k.id] ? '#7c3aed' : '#64748b'};border:none;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer;">
          💬 ${_requestsMap[k.id] ? _requestsMap[k.id] : 'Tulis'}
        </button>
      </td>
    </tr>`;
  }).join('');
}

function copyKodeBoost(kode) {
  navigator.clipboard.writeText(kode).then(() => showToast('Kode boost di-copy!', 'success'));
}

// ── CATATAN ──
async function loadRequestsCount() {
  try {
    const { data } = await kolDb().from('kol_requests').select('kol_id');
    _requestsMap = {};
    (data || []).forEach(r => {
      _requestsMap[r.kol_id] = (_requestsMap[r.kol_id] || 0) + 1;
    });
  } catch(_) {}
}

function openCatatanModal(kolId, kolName) {
  _activeKolId   = kolId;
  _activeKolName = kolName;
  document.getElementById('modal-kol-name').textContent = kolName;
  document.getElementById('catatan-input').value = '';
  document.getElementById('modal-catatan').style.display = 'flex';
  loadCatatanList(kolId);
}

function closeCatatanModal(e) {
  if (e && e.target !== document.getElementById('modal-catatan')) return;
  document.getElementById('modal-catatan').style.display = 'none';
}

async function loadCatatanList(kolId) {
  const listEl = document.getElementById('catatan-list');
  listEl.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px;">Memuat...</div>';
  try {
    const { data } = await kolDb()
      .from('kol_requests')
      .select('*')
      .eq('kol_id', kolId)
      .order('created_at', { ascending: false });

    if (!data?.length) {
      listEl.innerHTML = '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px;">Belum ada catatan</div>';
      return;
    }

    const fmtDate = ts => new Date(ts).toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });

    listEl.innerHTML = data.map(r => `
      <div style="background:#f8fafc;border-radius:10px;padding:10px 12px;">
        <div style="font-size:12px;font-weight:600;color:var(--primary);">${escHtml(r.advertiser_name || 'Advertiser')}</div>
        <div style="font-size:13px;color:var(--text);margin:4px 0;">${escHtml(r.catatan)}</div>
        <div style="font-size:11px;color:#94a3b8;">${fmtDate(r.created_at)}</div>
      </div>`).join('');
  } catch(e) {
    listEl.innerHTML = '<div style="text-align:center;color:#ef4444;font-size:13px;padding:20px;">Gagal memuat catatan</div>';
  }
}

async function saveCatatan() {
  const catatan = document.getElementById('catatan-input').value.trim();
  if (!catatan) { showToast('Catatan tidak boleh kosong', 'error'); return; }

  const btn = document.querySelector('#modal-catatan .btn-primary');
  btn.textContent = 'Menyimpan...';
  btn.disabled = true;

  try {
    const { error } = await kolDb().from('kol_requests').insert({
      kol_id:          _activeKolId,
      kol_name:        _activeKolName,
      catatan,
      advertiser_name: _myProfile?.nama || 'Advertiser',
      advertiser_id:   _myProfile?.id   || null,
    });
    if (error) throw error;

    // Update count badge
    _requestsMap[_activeKolId] = (_requestsMap[_activeKolId] || 0) + 1;
    document.getElementById(`req-badge-${_activeKolId}`)?.setAttribute('data-count', _requestsMap[_activeKolId]);
    renderTable(applyFilters());

    document.getElementById('catatan-input').value = '';
    showToast('Catatan berhasil dikirim!', 'success');
    loadCatatanList(_activeKolId);
  } catch(e) {
    showToast('Gagal menyimpan catatan', 'error');
  } finally {
    btn.textContent = 'Kirim Catatan';
    btn.disabled = false;
  }
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function bindFilters() {
  ['fil-toko','fil-status','fil-tier','fil-eval','fil-search'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      _currentPage = 1;
      renderTable(applyFilters());
    });
  });
}

async function loadKolData() {
  try {
    // Fetch paralel: KOL + listing + video + toko master
    const [
      { data: kols,     error: kolErr },
      { data: listings },
      { data: videos },
      { data: master },
    ] = await Promise.all([
      kolDb().from('kols')
        .select('id, name, tiktok, wa, email, niche, product, followers, platform, status, ratecard, tier, score, is_priority, kol_type, created_at, updated_at')
        .eq('kol_type', 'kol')
        .order('created_at', { ascending: false }),
      kolDb().from('kol_listing')
        .select('id, kol_id, toko, produk, kode_boost, eval_views, eval_rating, eval_result, eval_notes'),
      kolDb().from('kol_videos')
        .select('id, kol_id, link_video, judul, upload_date, kode_boost'),
      kolDb().from('kol_master')
        .select('id, name, type')
        .eq('type', 'toko')
        .order('name'),
    ]);

    if (kolErr) throw kolErr;

    _kolAll   = kols || [];
    _tokoList = master || [];

    // Build maps
    _listingMap = {};
    (listings || []).forEach(l => { _listingMap[l.kol_id] = l; });

    _videosMap = {};
    (videos || []).forEach(v => {
      if (!_videosMap[v.kol_id]) _videosMap[v.kol_id] = [];
      _videosMap[v.kol_id].push(v);
    });

    populateTokoDropdown();
    renderStats(_kolAll);
    renderTable(applyFilters());

  } catch (err) {
    console.error('KOL load error:', err);
    document.getElementById('kol-tbody').innerHTML = `<tr><td colspan="10">
      <div class="no-data-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p>Gagal memuat data KOL.</p>
        <p style="font-size:12px;margin-top:6px;">Kemungkinan karena RLS Supabase KOL Management.<br>Hubungi developer untuk konfigurasi akses.</p>
      </div>
    </td></tr>`;
    showToast('Gagal memuat data KOL', 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  _myProfile = await initPage('creator-kol', 'KOL');
  bindFilters();
  await Promise.all([loadKolData(), loadRequestsCount()]);
});
