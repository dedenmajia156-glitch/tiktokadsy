// ===== CREATOR: KOL PAGE =====
// Data read-only dari KOL Management Supabase

let _kolAll    = [];  // semua KOL
let _listingMap = {}; // { kol_id: listingRecord }
let _videosMap  = {}; // { kol_id: [ videoRecord ] }
let _tokoList   = []; // [ { id, name } ] dari kol_master

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
  // Hanya hitung dari yang sudah listing
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

    // Filter toko: match via kol_listing.toko
    if (toko) {
      const listingToko = (listing?.toko || '').trim();
      if (listingToko !== toko) return false;
    }

    if (status && k.status !== status) return false;
    if (tier && (k.tier || '').toLowerCase() !== tier) return false;

    const evalResult = listing?.eval_result || null;
    if (eval_ === '__none' && evalResult) return false;
    if (eval_ && eval_ !== '__none' && evalResult !== eval_) return false;

    if (q) {
      const hay = [k.name, k.tiktok, k.niche, k.product].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderTable(rows) {
  const tbody = document.getElementById('kol-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="10">
      <div class="no-data-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <p>Tidak ada data yang sesuai filter</p>
      </div>
    </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(k => {
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
      <td style="font-weight:700;font-size:13px;color:${scoreColor};">${score || '—'}</td>
      <td>${statusBadge(k.status)}</td>
      <td>${tokoBadge}</td>
      <td style="font-size:12px;max-width:160px;">
        ${listing?.produk ? `<div style="font-weight:500;">${escHtml(listing.produk)}</div>` : ''}
        ${k.niche ? `<div style="color:#94a3b8;">${escHtml(k.niche)}</div>` : ''}
        ${!listing?.produk && !k.niche ? '—' : ''}
      </td>
      <td style="text-align:center;font-weight:600;">${videos.length || '—'}</td>
      <td>${evalBadge(evalRes)}</td>
    </tr>`;
  }).join('');
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function bindFilters() {
  ['fil-toko','fil-status','fil-tier','fil-eval','fil-search'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
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
        .select('id, kol_id, toko, produk, eval_views, eval_rating, eval_result, eval_notes'),
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
    renderTable(_kolAll);

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
  await initPage('creator-kol', 'KOL');
  bindFilters();
  await loadKolData();
});
