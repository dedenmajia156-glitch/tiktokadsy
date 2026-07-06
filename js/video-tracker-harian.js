let profile = null;
let userProducts = [];
let prodThresholds = {};
let allData = [];
let filteredVideos = [];
let parsedRows = [];
let currentPage = 0;
const PAGE_SIZE = 15;
let _loadToken = 0; // cancel stale background loads

const VTH_CACHE_TTL = 5 * 60 * 1000; // 5 menit
function vthGetCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > VTH_CACHE_TTL) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch(_) { return null; }
}
function vthSetCache(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch(_) {}
}
function clearVthCache() {
  Object.keys(sessionStorage).filter(k => k.startsWith('gmv_vth')).forEach(k => sessionStorage.removeItem(k));
}


(async () => {
  clearVthCache(); // bersihkan cache lama saat init
  profile = await initPage('tracker-harian', 'Video Tracker Harian');
  await loadProducts();
  setupFilters();
  setDefaultDates();
  await loadData();
})();

window.addEventListener('advertiserSwitch', async () => {
  clearVthCache();
  document.getElementById('fil-produk').innerHTML = '<option value="">Semua Produk</option>';
  userProducts = [];
  prodThresholds = {};
  await loadProducts();
  await loadData();
});

async function getTargetUid() {
  const uid = (await getUser()).id;
  return window.__activeAdvertiser || uid;
}

async function loadProducts() {
  const uid = await getTargetUid();
  let q = db().from('products').select('*').order('nama_produk');
  if (profile?.role !== 'admin' || window.__activeAdvertiser) q = q.eq('user_id', uid);
  const { data: prods } = await q;
  userProducts = prods || [];
  userProducts.forEach(p => {
    prodThresholds[p.id] = { high: p.roas_high ?? 3, mid: p.roas_mid ?? 1.5 };
  });
  const sel = document.getElementById('fil-produk');
  userProducts.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.nama_produk;
    sel.appendChild(opt);
  });
}

function toDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function setDefaultDates() {
  const today = new Date();
  const d7 = new Date();
  d7.setDate(today.getDate() - 6);
  document.getElementById('fil-date-to').value = toDateStr(today);
  document.getElementById('fil-date-from').value = toDateStr(d7);
}

function setupFilters() {
  document.getElementById('btn-load').addEventListener('click', () => { currentPage = 0; loadData(); });
  ['fil-produk', 'fil-roas-status'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => { currentPage = 0; processAndRender(); });
  });
  document.getElementById('fil-search').addEventListener('input', () => { currentPage = 0; processAndRender(); });
}

async function loadData() {
  const myToken = ++_loadToken;
  const uid = await getTargetUid();
  const produkId = document.getElementById('fil-produk').value;
  const dateFrom = document.getElementById('fil-date-from').value;
  const dateTo = document.getElementById('fil-date-to').value;
  if (!dateFrom || !dateTo) { showToast('Pilih rentang tanggal dulu', 'error'); return; }

  // Load 1 hari sebelum dateFrom untuk kalkulasi delta "vs kemarin"
  const prev = new Date(dateFrom + 'T00:00:00');
  prev.setDate(prev.getDate() - 1);
  const extraDate = toDateStr(prev);

  const ckey = `gmv_vth6_${uid}_${extraDate}_${dateTo}_${produkId || 'all'}`;
  const cached = vthGetCache(ckey);
  if (cached) {
    allData = cached;
    currentPage = 0;
    processAndRender();
    return;
  }

  document.getElementById('video-list').innerHTML = '<div class="loader"><div class="spinner"></div></div>';
  document.getElementById('harian-pagination').style.display = 'none';

  const BATCH = 1000;
  const videoMap = {};

  function buildQuery(rangeFrom) {
    let q = db().from('ads_data_harian')
      .select('video_id, video_title, tiktok_account, product_id, tanggal, cost, gross_revenue, orders')
      .gte('tanggal', extraDate)
      .lte('tanggal', dateTo)
      .order('tanggal', { ascending: true });
    if (profile?.role !== 'admin' || window.__activeAdvertiser) q = q.eq('user_id', uid);
    if (produkId) q = q.eq('product_id', produkId);
    return q.range(rangeFrom, rangeFrom + BATCH - 1);
  }

  function mergeRows(rows) {
    rows.forEach(row => {
      const vid = row.video_id || 'unknown';
      if (!videoMap[vid]) {
        videoMap[vid] = {
          video_id:       vid,
          video_title:    row.video_title || '',
          tiktok_account: row.tiktok_account || '',
          product_id:     row.product_id,
          product_name:   userProducts.find(p => p.id === row.product_id)?.nama_produk || '',
          day_data:       {}
        };
      }
      const d = row.tanggal;
      if (!videoMap[vid].day_data[d]) videoMap[vid].day_data[d] = { cost: 0, gross_revenue: 0, orders: 0 };
      videoMap[vid].day_data[d].cost          += Number(row.cost) || 0;
      videoMap[vid].day_data[d].gross_revenue += Number(row.gross_revenue) || 0;
      videoMap[vid].day_data[d].orders        += Number(row.orders) || 0;
    });
  }

  try {
    // === Stats query + batch pertama: keduanya jalan, tapi ditangani terpisah ===
    let aggQ = db().from('ads_data_harian')
      .select('cost, gross_revenue, video_id')
      .gte('tanggal', dateFrom).lte('tanggal', dateTo);
    if (profile?.role !== 'admin' || window.__activeAdvertiser) aggQ = aggQ.eq('user_id', uid);
    if (produkId) aggQ = aggQ.eq('product_id', produkId);

    // Fire keduanya sekaligus, tapi jangan tunggu aggQ
    const aggPromise = fetchAllRows(aggQ);
    const firstRes = await buildQuery(0);
    if (_loadToken !== myToken) return;
    if (firstRes.error) throw firstRes.error;

    // Tabel langsung render dari batch pertama (tidak tunggu aggQ)
    const firstRows = firstRes.data || [];
    mergeRows(firstRows);
    allData = Object.values(videoMap);
    currentPage = 0;
    renderTableOnly(dateFrom, dateTo);

    // Stats: tunggu aggQ (mungkin sudah selesai duluan karena kolom lebih sedikit)
    const aggRows = await aggPromise;
    if (_loadToken !== myToken) return;
    let totalCost = 0, totalRev = 0, videoSet = new Set();
    aggRows.forEach(r => {
      totalCost += Number(r.cost) || 0;
      totalRev  += Number(r.gross_revenue) || 0;
      if (r.video_id && (Number(r.cost) || 0) > 0) videoSet.add(r.video_id);
    });
    const avgRoas = totalCost > 0 ? totalRev / totalCost : 0;
    renderStatCards(totalCost, totalRev, avgRoas, videoSet.size);

    // === Sisa data: load di background (tabel saja, stats sudah fix) ===
    if (firstRows.length >= BATCH) {
      setLoadingMoreBanner(true);
      let offset = BATCH;

      while (true) {
        const { data: moreRows, error: moreErr } = await buildQuery(offset);
        if (_loadToken !== myToken) return;
        if (moreErr || !moreRows?.length) break;

        mergeRows(moreRows);
        allData = Object.values(videoMap);

        if (moreRows.length < BATCH) break;
        offset += BATCH;
      }

      setLoadingMoreBanner(false);
      renderTableOnly(dateFrom, dateTo);
    }

    vthSetCache(ckey, allData);
  } catch(e) {
    if (_loadToken !== myToken) return;
    showToast('Gagal load data: ' + e.message, 'error');
    document.getElementById('video-list').innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><h3>Gagal memuat data</h3><p>' + e.message + '</p></div>';
  }
}

function setLoadingMoreBanner(show) {
  let el = document.getElementById('vth-loading-more');
  if (show) {
    if (!el) {
      el = document.createElement('div');
      el.id = 'vth-loading-more';
      el.style.cssText = 'font-size:12px;color:#64748b;text-align:center;padding:6px 12px;background:#f8fafc;border-radius:8px;margin-top:8px;display:flex;align-items:center;justify-content:center;gap:8px';
      el.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px"></div> Memuat sisa data...';
      const pg = document.getElementById('harian-pagination');
      pg.parentNode.insertBefore(el, pg);
    }
    el.style.display = 'flex';
  } else if (el) {
    el.remove();
  }
}

function renderStatCards(totalCost, totalRev, avgRoas, videoAktif) {
  const el = document.getElementById('harian-stats');
  el.innerHTML = `
    <div class="stat-card pink">
      <div class="stat-icon pink">💳</div>
      <div class="stat-info"><div class="value">${fmtRp(totalCost)}</div><div class="label">Total Ads Spend</div></div>
    </div>
    <div class="stat-card green">
      <div class="stat-icon green">$</div>
      <div class="stat-info"><div class="value">${fmtRp(totalRev)}</div><div class="label">Total Revenue</div></div>
    </div>
    <div class="stat-card orange">
      <div class="stat-icon orange">📈</div>
      <div class="stat-info"><div class="value">${avgRoas > 0 ? avgRoas.toFixed(2) + 'x' : '-'}</div><div class="label">ROAS Rata-rata</div></div>
    </div>
    <div class="stat-card purple">
      <div class="stat-icon purple">🎬</div>
      <div class="stat-info"><div class="value">${videoAktif}</div><div class="label">Video Aktif</div></div>
    </div>`;
}

function renderTableOnly(dateFrom, dateTo) {
  const search = document.getElementById('fil-search').value.trim().toLowerCase();
  const roasFilter = document.getElementById('fil-roas-status').value;

  let videos = allData.filter(v => Object.keys(v.day_data || {}).some(d => d >= dateFrom && d <= dateTo));
  if (search) {
    videos = videos.filter(v =>
      (v.video_id || '').toLowerCase().includes(search) ||
      (v.video_title || '').toLowerCase().includes(search) ||
      (v.tiktok_account || '').toLowerCase().includes(search)
    );
  }
  if (roasFilter) {
    videos = videos.filter(v => {
      const days = v.day_data || {};
      const inRange = Object.keys(days).filter(d => d >= dateFrom && d <= dateTo).sort();
      if (!inRange.length) return false;
      const latest = days[inRange[inRange.length - 1]];
      const roas = (Number(latest.cost) || 0) > 0 ? (Number(latest.gross_revenue) || 0) / (Number(latest.cost) || 0) : 0;
      const thr = prodThresholds[v.product_id] || { high: 3, mid: 1.5 };
      if (roasFilter === 'bagus')   return roas >= thr.high;
      if (roasFilter === 'monitor') return roas >= thr.mid && roas < thr.high;
      if (roasFilter === 'boncos')  return (Number(latest.cost) || 0) > 0 && roas < thr.mid;
      return true;
    });
  }
  videos.sort((a, b) => {
    const avg = v => {
      const days = v.day_data || {};
      const inRange = Object.keys(days).filter(d => d >= dateFrom && d <= dateTo);
      const tc = inRange.reduce((s, d) => s + (Number(days[d].cost) || 0), 0);
      const tr = inRange.reduce((s, d) => s + (Number(days[d].gross_revenue) || 0), 0);
      return tc > 0 ? tr / tc : 0;
    };
    return avg(b) - avg(a);
  });
  filteredVideos = videos;
  renderVideoCards(videos.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE), dateFrom, dateTo);
  renderHarianPagination(videos.length);
}

function processAndRender() {
  const dateFrom = document.getElementById('fil-date-from').value;
  const dateTo = document.getElementById('fil-date-to').value;
  const search = document.getElementById('fil-search').value.trim().toLowerCase();
  const roasFilter = document.getElementById('fil-roas-status').value;

  // allData sudah berupa array per-video dari RPC (day_data = map tanggal → {cost, gross_revenue, orders})
  let videos = allData.filter(v => {
    // Hanya tampilkan video yang punya data di rentang dateFrom-dateTo
    return Object.keys(v.day_data || {}).some(d => d >= dateFrom && d <= dateTo);
  });

  // Filter search
  if (search) {
    videos = videos.filter(v =>
      (v.video_id || '').toLowerCase().includes(search) ||
      (v.video_title || '').toLowerCase().includes(search) ||
      (v.tiktok_account || '').toLowerCase().includes(search)
    );
  }

  // Filter ROAS status (berdasarkan hari terakhir di rentang)
  if (roasFilter) {
    videos = videos.filter(v => {
      const days = v.day_data || {};
      const inRange = Object.keys(days).filter(d => d >= dateFrom && d <= dateTo).sort();
      if (!inRange.length) return false;
      const latest = days[inRange[inRange.length - 1]];
      const latestCost = Number(latest.cost) || 0;
      const latestRev  = Number(latest.gross_revenue) || 0;
      const roas = latestCost > 0 ? latestRev / latestCost : 0;
      const thr = prodThresholds[v.product_id] || { high: 3, mid: 1.5 };
      if (roasFilter === 'bagus')   return roas >= thr.high;
      if (roasFilter === 'monitor') return roas >= thr.mid && roas < thr.high;
      if (roasFilter === 'boncos')  return latestCost > 0 && roas < thr.mid;
      return true;
    });
  }

  // Sort by avg ROAS tertinggi
  videos.sort((a, b) => {
    const avg = v => {
      const days = v.day_data || {};
      const inRange = Object.keys(days).filter(d => d >= dateFrom && d <= dateTo);
      const tc = inRange.reduce((s, d) => s + (Number(days[d].cost) || 0), 0);
      const tr = inRange.reduce((s, d) => s + (Number(days[d].gross_revenue) || 0), 0);
      return tc > 0 ? tr / tc : 0;
    };
    return avg(b) - avg(a);
  });

  filteredVideos = videos;
  renderSummaryStats(videos, dateFrom, dateTo);
  const pageVids = videos.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  renderVideoCards(pageVids, dateFrom, dateTo);
  renderHarianPagination(videos.length);
}

function renderSummaryStats(videos, dateFrom, dateTo) {
  let totalCost = 0, totalRev = 0, videoAktif = 0;
  videos.forEach(v => {
    const days = v.day_data || {};
    const inRange = Object.keys(days).filter(d => d >= dateFrom && d <= dateTo);
    const cost = inRange.reduce((s, d) => s + (Number(days[d].cost) || 0), 0);
    const rev  = inRange.reduce((s, d) => s + (Number(days[d].gross_revenue) || 0), 0);
    if (cost > 0) videoAktif++;
    totalCost += cost;
    totalRev  += rev;
  });
  const avgRoas = totalCost > 0 ? totalRev / totalCost : 0;
  const el = document.getElementById('harian-stats');
  el.innerHTML = `
    <div class="stat-card pink">
      <div class="stat-icon pink">💳</div>
      <div class="stat-info">
        <div class="value">${fmtRp(totalCost)}</div>
        <div class="label">Total Ads Spend</div>
      </div>
    </div>
    <div class="stat-card green">
      <div class="stat-icon green">$</div>
      <div class="stat-info">
        <div class="value">${fmtRp(totalRev)}</div>
        <div class="label">Total Revenue</div>
      </div>
    </div>
    <div class="stat-card orange">
      <div class="stat-icon orange">📈</div>
      <div class="stat-info">
        <div class="value">${avgRoas > 0 ? avgRoas.toFixed(2) + 'x' : '-'}</div>
        <div class="label">ROAS Rata-rata</div>
      </div>
    </div>
    <div class="stat-card purple">
      <div class="stat-icon purple">🎬</div>
      <div class="stat-info">
        <div class="value">${videoAktif}</div>
        <div class="label">Video Aktif</div>
      </div>
    </div>`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderVideoCards(videos, dateFrom, dateTo) {
  const el = document.getElementById('video-list');
  if (!videos.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="icon">📭</div>
      <h3>Tidak ada data harian</h3>
      <p>Upload data harian atau ubah filter tanggal</p>
    </div>`;
    return;
  }

  // Kumpulkan semua tanggal dalam rentang
  const dates = [];
  let cur = new Date(dateFrom + 'T00:00:00');
  const endDate = new Date(dateTo + 'T00:00:00');
  while (cur <= endDate) {
    dates.push(toDateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }

  // Sticky column layout (sama dengan video tracker bulanan)
  const S = [
    { l: 0,   w: 220 },  // 0: Video
    { l: 220, w: 150 },  // 1: Produk
    { l: 370, w: 105 },  // 2: Total Cost
    { l: 475, w: 115 },  // 3: Total Revenue
    { l: 590, w: 85  },  // 4: ROAS
    { l: 675, w: 75  },  // 5: Orders  ← last pinned
  ];
  const DIVIDER = 'box-shadow:2px 0 8px rgba(0,0,0,0.08);border-right:1px solid #e2e8f0;';
  const sH = i => `position:sticky;left:${S[i].l}px;width:${S[i].w}px;min-width:${S[i].w}px;background:#f8f9fe;z-index:4;${i===5?DIVIDER:''}`;
  const sD = (i, bg='#fff') => `position:sticky;left:${S[i].l}px;width:${S[i].w}px;min-width:${S[i].w}px;background:${bg};z-index:2;${i===5?DIVIDER:''}`;

  const fmtDateCol = d => {
    const dt = new Date(d + 'T00:00:00');
    return `${dt.getDate()}<br><span style="font-weight:400;font-size:10px;color:#94a3b8">${dt.toLocaleDateString('id-ID',{month:'short'})}</span>`;
  };

  el.innerHTML = `
    <div class="card" style="padding:0">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="${sH(0)}">Video</th>
              <th style="${sH(1)}">Produk</th>
              <th style="${sH(2)}">Total Cost</th>
              <th style="${sH(3)}">Total Revenue</th>
              <th style="${sH(4)}">ROAS</th>
              <th style="${sH(5)}">Orders</th>
              ${dates.map(d => `<th style="min-width:82px;text-align:center;font-weight:600">${fmtDateCol(d)}<div style="font-size:9px;font-weight:400;color:#94a3b8;margin-top:2px">Cost · Rev · ROAS</div></th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${videos.map(v => {
              const dayData = v.day_data || {};
              const thr = prodThresholds[v.product_id] || { high: 3, mid: 1.5 };
              const prodName = v.product_name || '—';

              const inRangeDates = Object.keys(dayData).filter(d => d >= dateFrom && d <= dateTo);
              const totalCost   = inRangeDates.reduce((s, d) => s + (Number(dayData[d].cost) || 0), 0);
              const totalRev    = inRangeDates.reduce((s, d) => s + (Number(dayData[d].gross_revenue) || 0), 0);
              const totalOrders = inRangeDates.reduce((s, d) => s + (Number(dayData[d].orders) || 0), 0);
              const avgRoas     = totalCost > 0 ? totalRev / totalCost : 0;

              const dateCols = dates.map(d => {
                const row = dayData[d];
                const rowCost = Number(row?.cost) || 0;
                const rowRev  = Number(row?.gross_revenue) || 0;
                if (!row || rowCost <= 0) return `<td style="text-align:center;color:#cbd5e1;font-size:12px">-</td>`;

                const roas = rowRev / rowCost;

                // Delta ROAS vs hari sebelumnya
                const prevD = new Date(d + 'T00:00:00');
                prevD.setDate(prevD.getDate() - 1);
                const prevRow = dayData[toDateStr(prevD)];
                const prevCost = Number(prevRow?.cost) || 0;
                const prevRev  = Number(prevRow?.gross_revenue) || 0;
                let deltaHTML = '';
                if (prevRow && prevCost > 0) {
                  const delta = roas - (prevRev / prevCost);
                  const col = delta >= 0 ? '#10b981' : '#ef4444';
                  deltaHTML = `<div style="font-size:10px;color:${col};margin-top:2px">${delta >= 0 ? '↑' : '↓'}${Math.abs(delta).toFixed(1)}</div>`;
                }

                return `<td style="text-align:center;padding:5px 6px;vertical-align:middle">
                  <div class="${roasClass(roas, thr.high, thr.mid)} num" style="font-size:12px;font-weight:700">${roas.toFixed(1)}x</div>
                  <div style="font-size:10px;color:#64748b;margin-top:1px">${fmtRp(rowCost)}</div>
                  <div style="font-size:10px;color:#10b981">${fmtRp(rowRev)}</div>
                  ${deltaHTML}
                </td>`;
              }).join('');

              return `<tr style="border-top:1px solid #f1f5f9">
                <td class="td-video" style="${sD(0)}">
                  <div class="vtitle">${v.video_title && v.video_title !== v.video_id ? v.video_title.slice(0,40) : 'ID: '+v.video_id.slice(-10)}</div>
                  ${v.tiktok_account ? `<div class="vaccount">${v.tiktok_account}</div>` : ''}
                  <div style="display:flex;align-items:center;gap:4px;margin-top:3px">
                    <span style="font-size:10px;color:#64748b;font-family:monospace">${v.video_id}</span>
                    <button onclick="copyText('${v.video_id}', this)" title="Copy Video ID" style="background:none;border:none;cursor:pointer;padding:0;color:#94a3b8;line-height:1;flex-shrink:0">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </div>
                </td>
                <td style="${sD(1)}"><span class="badge badge-purple" style="font-size:10px">${prodName}</span></td>
                <td class="num" style="${sD(2)}">${fmtRp(totalCost)}</td>
                <td class="num" style="${sD(3)}">${fmtRp(totalRev)}</td>
                <td style="${sD(4)}"><span class="${roasClass(avgRoas, thr.high, thr.mid)} num fw-700">${avgRoas > 0 ? avgRoas.toFixed(2)+'x' : '-'}</span></td>
                <td style="${sD(5)}">${fmtNum(totalOrders)}</td>
                ${dateCols}
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function renderHarianPagination(total) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const pg = document.getElementById('harian-pagination');
  if (totalPages <= 1) { pg.style.display = 'none'; return; }
  pg.style.display = 'flex';

  const start = currentPage * PAGE_SIZE + 1;
  const end = Math.min((currentPage + 1) * PAGE_SIZE, total);
  document.getElementById('hp-info').textContent = `${start}–${end} dari ${total} video`;
  document.getElementById('hp-prev').disabled = currentPage === 0;
  document.getElementById('hp-next').disabled = currentPage >= totalPages - 1;

  const nums = document.getElementById('hp-nums');
  nums.innerHTML = '';
  let s = Math.max(0, currentPage - 2);
  let e = Math.min(totalPages - 1, s + 4);
  s = Math.max(0, e - 4);
  for (let i = s; i <= e; i++) {
    const btn = document.createElement('button');
    btn.textContent = i + 1;
    btn.className = 'btn btn-sm ' + (i === currentPage ? 'btn-primary-sm' : 'btn-outline');
    btn.style.minWidth = '34px';
    btn.onclick = () => {
      currentPage = i;
      const from = document.getElementById('fil-date-from').value;
      const to = document.getElementById('fil-date-to').value;
      renderVideoCards(filteredVideos.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE), from, to);
      renderHarianPagination(filteredVideos.length);
    };
    nums.appendChild(btn);
  }
}

function vtHarianChangePage(dir) {
  const totalPages = Math.ceil(filteredVideos.length / PAGE_SIZE);
  currentPage = Math.max(0, Math.min(currentPage + dir, totalPages - 1));
  const from = document.getElementById('fil-date-from').value;
  const to = document.getElementById('fil-date-to').value;
  renderVideoCards(filteredVideos.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE), from, to);
  renderHarianPagination(filteredVideos.length);
}

// ============ UPLOAD ============
function openUploadModal() {
  parsedRows = [];
  document.getElementById('modal-upload-h').classList.add('open');
  document.getElementById('upload-err-h').style.display = 'none';
  document.getElementById('preview-info-h').style.display = 'none';
  document.getElementById('btn-upload-h').disabled = true;
  document.getElementById('file-input-h').value = '';
  document.getElementById('upload-tanggal').value = toDateStr(new Date());
}

function closeUploadModal() {
  document.getElementById('modal-upload-h').classList.remove('open');
}

document.addEventListener('DOMContentLoaded', () => {
  const area = document.getElementById('upload-area-h');
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFileHarian(e.dataTransfer.files[0]);
  });
});

// Parse tanggal dari nama file: "Creative Data For Product Campaigns 20260701 - 20260701"
function tanggalDariNamaFile(filename) {
  const match = filename.match(/(\d{8})\s*-\s*(\d{8})/);
  if (match) {
    const s = match[1]; // e.g. "20260701"
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  return '';
}

function handleFileHarian(file) {
  if (!file) return;
  const errEl = document.getElementById('upload-err-h');
  errEl.style.display = 'none';
  document.getElementById('preview-info-h').style.display = 'none';
  document.getElementById('btn-upload-h').disabled = true;

  // Auto-detect tanggal dari nama file
  const detected = tanggalDariNamaFile(file.name);
  if (detected) {
    document.getElementById('upload-tanggal').value = detected;
  }

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      let ws = null;
      for (const sname of wb.SheetNames) {
        const sheet = wb.Sheets[sname];
        const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
        if (json.length > 1) {
          const headers = (json[0] || []).map(h => String(h).toLowerCase());
          if (headers.some(h => h.includes('campaign') || h.includes('video id') || h.includes('cost'))) {
            ws = json; break;
          }
        }
      }
      if (!ws) { showErrH(errEl, 'Tidak menemukan data yang valid. Pastikan file dari TikTok Seller Center.'); return; }

      parsedRows = parseHarianRows(ws);
      if (!parsedRows.length) { showErrH(errEl, 'Tidak ada baris data yang bisa diproses.'); return; }

      const prodIdSet = [...new Set(parsedRows.map(r => r.product_id_raw).filter(Boolean))];
      const matched = prodIdSet.filter(pid => userProducts.some(p => p.product_id_tiktok === pid));
      const unmatched = prodIdSet.filter(pid => !userProducts.some(p => p.product_id_tiktok === pid));

      const tanggalVal = document.getElementById('upload-tanggal').value;
      let html = `✅ <strong>${parsedRows.length} baris</strong> siap diupload<br>
        <span style="font-size:12px;color:#64748b">
          📅 Tanggal: <strong>${tanggalVal || '—'}</strong><br>
          📦 ${prodIdSet.length} Product ID terdeteksi (${matched.length} cocok dengan produk terdaftar)
        </span>`;
      if (unmatched.length) {
        html += `<br><span style="color:#f59e0b;font-size:12px">⚠️ ${unmatched.length} Product ID belum terdaftar — data tetap masuk tanpa info produk.</span>`;
      }

      document.getElementById('preview-text-h').innerHTML = html;
      document.getElementById('preview-info-h').style.display = 'block';
      document.getElementById('btn-upload-h').disabled = false;
    } catch(err) {
      showErrH(errEl, 'Gagal baca file: ' + err.message);
    }
  };
  reader.readAsBinaryString(file);
}

function parseHarianRows(json) {
  const rawHeaders = json[0] || [];
  const headers = rawHeaders.map(h => String(h).toLowerCase().trim());

  const map = {
    campaign_name:  ['campaign name', 'nama kampanye'],
    campaign_id:    ['campaign id', 'id campaign'],
    product_id_raw: ['product id', 'id produk'],
    creative_type:  ['creative type', 'jenis materi iklan'],
    video_title:    ['video title', 'judul video'],
    video_id:       ['video id', 'id video'],
    tiktok_account: ['tiktok account', 'titkok account', 'akun tiktok'],
    status:         ['status'],
    cost:           ['cost', 'biaya'],
    orders:         ['sku orders', 'orders (sku)', 'orders', 'pesanan sku'],
    gross_revenue:  ['gross revenue', 'pendapatan kotor'],
  };

  function findIdx(keys) {
    for (const k of keys) {
      const i = headers.findIndex(h => h.includes(k));
      if (i >= 0) return i;
    }
    return -1;
  }

  const idx = {};
  for (const [field, keys] of Object.entries(map)) idx[field] = findIdx(keys);

  const rows = [];
  for (let i = 1; i < json.length; i++) {
    const row = json[i];
    if (!row || row.every(c => c === '' || c === null)) continue;
    const cost = parseFloat(String(row[idx.cost] || '0').replace(/[^0-9.]/g, '')) || 0;
    const revenue = parseFloat(String(row[idx.gross_revenue] || '0').replace(/[^0-9.]/g, '')) || 0;
    rows.push({
      campaign_name:  idx.campaign_name >= 0  ? String(row[idx.campaign_name] || '').trim() : '',
      campaign_id:    idx.campaign_id >= 0    ? String(row[idx.campaign_id] || '').trim() : '',
      product_id_raw: idx.product_id_raw >= 0 ? String(row[idx.product_id_raw] || '').trim() : '',
      creative_type:  idx.creative_type >= 0  ? String(row[idx.creative_type] || '').trim() : '',
      video_title:    idx.video_title >= 0    ? String(row[idx.video_title] || '').trim() : '',
      video_id:       idx.video_id >= 0       ? String(row[idx.video_id] || '').trim() : '',
      tiktok_account: idx.tiktok_account >= 0 ? String(row[idx.tiktok_account] || '').trim() : '',
      status:         idx.status >= 0         ? String(row[idx.status] || '').trim() : '',
      cost,
      orders: parseInt(String(row[idx.orders] || '0')) || 0,
      gross_revenue: revenue,
    });
  }
  return rows;
}

async function doUploadHarian() {
  const errEl = document.getElementById('upload-err-h');
  const btn = document.getElementById('btn-upload-h');
  errEl.style.display = 'none';

  const tanggal = document.getElementById('upload-tanggal').value;
  if (!tanggal) { showErrH(errEl, 'Pilih tanggal dulu.'); return; }
  if (!parsedRows.length) { showErrH(errEl, 'Belum ada file yang diparsing.'); return; }

  btn.disabled = true;
  btn.textContent = 'Mengupload...';

  const uid = (await getUser()).id;
  const produkMap = {};
  userProducts.forEach(p => { produkMap[p.product_id_tiktok] = p.id; });

  // Hitung bulan dari tanggal
  const d = new Date(tanggal + 'T00:00:00');
  const bulanNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const bulan = `${bulanNames[d.getMonth()]} ${d.getFullYear()}`;

  // Hapus data lama untuk tanggal ini
  const { error: delErr } = await db().from('ads_data_harian')
    .delete().eq('tanggal', tanggal).eq('user_id', uid);
  if (delErr) {
    showErrH(errEl, 'Gagal hapus data lama: ' + delErr.message);
    btn.disabled = false; btn.textContent = 'Upload Data';
    return;
  }

  const now = new Date().toISOString();
  const batch = parsedRows.map(r => ({
    user_id:        uid,
    product_id:     produkMap[r.product_id_raw] || null,
    tanggal,
    bulan,
    campaign_name:  r.campaign_name,
    campaign_id:    r.campaign_id,
    product_id_raw: r.product_id_raw,
    creative_type:  r.creative_type,
    video_title:    r.video_title,
    video_id:       r.video_id,
    tiktok_account: r.tiktok_account,
    status:         r.status,
    cost:           r.cost,
    orders:         r.orders,
    gross_revenue:  r.gross_revenue,
    uploaded_at:    now,
  }));

  const CHUNK = 500;
  let errMsg = null;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const { error } = await db().from('ads_data_harian').insert(batch.slice(i, i + CHUNK));
    if (error) { errMsg = error.message; break; }
  }

  btn.disabled = false;
  btn.textContent = 'Upload Data';

  if (errMsg) { showErrH(errEl, 'Gagal upload: ' + errMsg); return; }

  showToast(`${parsedRows.length} data harian (${tanggal}) berhasil diupload!`, 'success');
  clearVthCache(); // data baru, invalidate cache harian
  Object.keys(sessionStorage).filter(k => k.startsWith('gmv_dash_') || k.startsWith('gmv_chart_')).forEach(k => sessionStorage.removeItem(k));
  closeUploadModal();
  await loadData();
}

function showErrH(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}

function copyText(text, el) {
  navigator.clipboard.writeText(text).then(() => {
    const orig = el.textContent;
    el.textContent = 'Copied!';
    setTimeout(() => { el.textContent = orig; }, 1200);
  });
}
