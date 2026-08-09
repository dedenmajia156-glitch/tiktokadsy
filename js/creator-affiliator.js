// ===== CREATOR: AFFILIATOR PAGE =====
// Data read-only dari KOL Management Supabase

let _affAll    = [];  // semua Affiliator
let _listingMap = {}; // { kol_id: listingRecord }
let _videosMap  = {}; // { kol_id: [ videoRecord ] }
let _viewsMap   = {}; // { kol_id: total views }

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

function fmtViews(n) {
  if (!n) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n.toString();
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderStats(data) {
  const total    = data.length;
  const deal     = data.filter(k => k.status === 'deal').length;
  const priority = data.filter(k => k.is_priority).length;
  const totalVid = data.reduce((sum, k) => sum + (_videosMap[k.id]?.length || 0), 0);

  document.getElementById('stat-total').textContent    = total;
  document.getElementById('stat-deal').textContent     = deal;
  document.getElementById('stat-priority').textContent = priority;
  document.getElementById('stat-videos').textContent   = totalVid || '—';
}

function applyFilters() {
  const eval_ = document.getElementById('fil-eval').value;
  const q     = document.getElementById('fil-search').value.toLowerCase().trim();

  return _affAll.filter(k => {
    const listing   = _listingMap[k.id];
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
  const tbody = document.getElementById('aff-tbody');
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8">
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
    const totalViews = _viewsMap[k.id] || 0;

    const tiktokLink = k.tiktok
      ? `<a href="https://www.tiktok.com/@${k.tiktok.replace('@','')}" target="_blank" style="color:var(--primary);text-decoration:none;font-size:12px;">@${k.tiktok.replace('@','')}</a>`
      : '<span style="color:#94a3b8;font-size:12px;">—</span>';

    const priorityStar = k.is_priority ? '<span class="priority-star" title="Talent Prioritas">★</span> ' : '';
    const priorityLabel = k.is_priority
      ? '<span class="eval-badge bagus">Prioritas</span>'
      : '<span style="color:#94a3b8;font-size:12px;">—</span>';

    return `<tr>
      <td>
        <div style="font-weight:600;font-size:13px;">${priorityStar}${escHtml(k.name || '-')}</div>
        ${k.wa ? `<div style="font-size:11px;color:#94a3b8;">${escHtml(k.wa)}</div>` : ''}
      </td>
      <td>${tiktokLink}</td>
      <td style="font-size:13px;">${fmtFollowers(k.followers)}</td>
      <td style="font-size:12px;max-width:160px;">
        ${k.niche ? `<div>${escHtml(k.niche)}</div>` : ''}
        ${k.product ? `<div style="color:#94a3b8;">${escHtml(k.product)}</div>` : ''}
        ${!k.niche && !k.product ? '—' : ''}
      </td>
      <td style="text-align:center;font-weight:600;">${videos.length || '—'}</td>
      <td style="text-align:center;">${fmtViews(totalViews)}</td>
      <td>${evalBadge(evalRes)}</td>
      <td>${priorityLabel}</td>
    </tr>`;
  }).join('');
}

function bindFilters() {
  ['fil-eval','fil-search'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      renderTable(applyFilters());
    });
  });
}

async function loadAffiliatorData() {
  try {
    // 1. Fetch semua Affiliator (kol_type = 'affiliator')
    const { data: affs, error: affErr } = await kolDb()
      .from('kols')
      .select('id, name, tiktok, wa, email, niche, product, followers, platform, status, is_priority, kol_type, created_at, updated_at')
      .eq('kol_type', 'affiliator')
      .order('created_at', { ascending: false });

    if (affErr) throw affErr;

    // 2. Fetch semua listing (eval data)
    const { data: listings } = await kolDb()
      .from('kol_listing')
      .select('id, kol_id, eval_views, eval_rating, eval_result, eval_notes');

    // 3. Fetch semua video
    const { data: videos } = await kolDb()
      .from('kol_videos')
      .select('id, kol_id, link_video, judul, upload_date');

    // 4. Fetch total views per kol dari kol_views_log
    const { data: viewsLog } = await kolDb()
      .from('kol_views_log')
      .select('kol_id, views');

    _affAll = affs || [];

    // Build maps
    _listingMap = {};
    (listings || []).forEach(l => { _listingMap[l.kol_id] = l; });

    _videosMap = {};
    (videos || []).forEach(v => {
      if (!_videosMap[v.kol_id]) _videosMap[v.kol_id] = [];
      _videosMap[v.kol_id].push(v);
    });

    // Total views per KOL (ambil views terbaru per video → sum)
    _viewsMap = {};
    const latestViewPerVideo = {};
    (viewsLog || []).forEach(row => {
      if (!latestViewPerVideo[row.kol_id]) latestViewPerVideo[row.kol_id] = 0;
      latestViewPerVideo[row.kol_id] = Math.max(latestViewPerVideo[row.kol_id], row.views || 0);
    });
    Object.entries(latestViewPerVideo).forEach(([kolId, views]) => {
      _viewsMap[kolId] = (_viewsMap[kolId] || 0) + views;
    });

    renderStats(_affAll);
    renderTable(_affAll);

  } catch (err) {
    console.error('Affiliator load error:', err);
    document.getElementById('aff-tbody').innerHTML = `<tr><td colspan="8">
      <div class="no-data-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p>Gagal memuat data Affiliator.</p>
        <p style="font-size:12px;margin-top:6px;">Kemungkinan karena RLS Supabase KOL Management.<br>Hubungi developer untuk konfigurasi akses.</p>
      </div>
    </td></tr>`;
    showToast('Gagal memuat data Affiliator', 'error');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await initPage('creator-affiliator', 'Affiliator');
  bindFilters();
  await loadAffiliatorData();
});
