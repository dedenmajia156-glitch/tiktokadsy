let profile = null;
let userProducts = [];
let prodThresholds = {};
let allData = [];
let filteredVideos = [];
let parsedRows = [];
let currentPage = 0;
const PAGE_SIZE = 15;

(async () => {
  profile = await initPage('tracker-harian', 'Video Tracker Harian');
  await loadProducts();
  setupFilters();
  setDefaultDates();
  await loadData();
})();

async function loadProducts() {
  const uid = (await getUser()).id;
  let q = db().from('products').select('*').order('nama_produk');
  if (profile?.role !== 'admin') q = q.eq('user_id', uid);
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
  const uid = (await getUser()).id;
  const produkId = document.getElementById('fil-produk').value;
  const dateFrom = document.getElementById('fil-date-from').value;
  const dateTo = document.getElementById('fil-date-to').value;
  if (!dateFrom || !dateTo) { showToast('Pilih rentang tanggal dulu', 'error'); return; }

  // Load 1 hari sebelum dateFrom untuk kalkulasi delta "vs kemarin"
  const prev = new Date(dateFrom + 'T00:00:00');
  prev.setDate(prev.getDate() - 1);
  const extraDate = toDateStr(prev);

  document.getElementById('video-list').innerHTML = '<div class="loader"><div class="spinner"></div></div>';
  document.getElementById('harian-pagination').style.display = 'none';

  try {
    let q = db().from('ads_data_harian')
      .select('*')
      .gte('tanggal', extraDate)
      .lte('tanggal', dateTo)
      .order('tanggal', { ascending: true });

    if (profile?.role !== 'admin') q = q.eq('user_id', uid);
    if (produkId) q = q.eq('product_id', produkId);

    allData = await fetchAllRows(q);
    currentPage = 0;
    processAndRender();
  } catch(e) {
    showToast('Gagal load data: ' + e.message, 'error');
    document.getElementById('video-list').innerHTML = '<div class="empty-state"><div class="icon">⚠️</div><h3>Gagal memuat data</h3><p>' + e.message + '</p></div>';
  }
}

function processAndRender() {
  const dateFrom = document.getElementById('fil-date-from').value;
  const dateTo = document.getElementById('fil-date-to').value;
  const search = document.getElementById('fil-search').value.trim().toLowerCase();
  const roasFilter = document.getElementById('fil-roas-status').value;

  // Build map per video_id (semua data termasuk extra day)
  const videoMap = {};
  allData.forEach(row => {
    const key = row.video_id || 'unknown';
    if (!videoMap[key]) {
      videoMap[key] = {
        video_id: key,
        video_title: row.video_title || key,
        tiktok_account: row.tiktok_account || '',
        product_id: row.product_id,
        product_id_raw: row.product_id_raw || '',
        rows: []
      };
    }
    // Update meta dari row terbaru
    if (row.video_title) videoMap[key].video_title = row.video_title;
    if (row.tiktok_account) videoMap[key].tiktok_account = row.tiktok_account;
    if (row.product_id) videoMap[key].product_id = row.product_id;
    videoMap[key].rows.push(row);
  });

  let videos = Object.values(videoMap);

  // Hanya tampilkan video yang punya data di rentang dateFrom-dateTo
  videos = videos.filter(v => v.rows.some(r => r.tanggal >= dateFrom && r.tanggal <= dateTo));

  // Filter search
  if (search) {
    videos = videos.filter(v =>
      v.video_id.toLowerCase().includes(search) ||
      v.video_title.toLowerCase().includes(search) ||
      v.tiktok_account.toLowerCase().includes(search)
    );
  }

  // Filter ROAS status (berdasarkan hari terakhir di rentang)
  if (roasFilter) {
    videos = videos.filter(v => {
      const inRange = v.rows.filter(r => r.tanggal >= dateFrom && r.tanggal <= dateTo);
      if (!inRange.length) return false;
      const latest = inRange[inRange.length - 1];
      const roas = latest.cost > 0 ? latest.gross_revenue / latest.cost : 0;
      const thr = prodThresholds[v.product_id] || { high: 3, mid: 1.5 };
      if (roasFilter === 'bagus') return roas >= thr.high;
      if (roasFilter === 'monitor') return roas >= thr.mid && roas < thr.high;
      if (roasFilter === 'boncos') return latest.cost > 0 && roas < thr.mid;
      return true;
    });
  }

  // Sort by avg ROAS tertinggi
  videos.sort((a, b) => {
    const avg = v => {
      const rows = v.rows.filter(r => r.tanggal >= dateFrom && r.tanggal <= dateTo);
      const tc = rows.reduce((s, r) => s + (r.cost || 0), 0);
      const tr = rows.reduce((s, r) => s + (r.gross_revenue || 0), 0);
      return tc > 0 ? tr / tc : 0;
    };
    return avg(b) - avg(a);
  });

  filteredVideos = videos;
  const pageVids = videos.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  renderVideoCards(pageVids, dateFrom, dateTo);
  renderHarianPagination(videos.length);
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

  el.innerHTML = videos.map(v => {
    const inRange = v.rows.filter(r => r.tanggal >= dateFrom && r.tanggal <= dateTo);
    const rowsDesc = [...inRange].sort((a, b) => b.tanggal.localeCompare(a.tanggal));
    const thr = prodThresholds[v.product_id] || { high: 3, mid: 1.5 };
    const prod = userProducts.find(p => p.id === v.product_id);
    const prodName = prod ? prod.nama_produk : (v.product_id_raw || '—');

    const totalCost = inRange.reduce((s, r) => s + (r.cost || 0), 0);
    const totalRev = inRange.reduce((s, r) => s + (r.gross_revenue || 0), 0);
    const totalOrders = inRange.reduce((s, r) => s + (r.orders || 0), 0);
    const avgRoas = totalCost > 0 ? totalRev / totalCost : 0;

    const tableRows = rowsDesc.map(row => {
      const roas = row.cost > 0 ? row.gross_revenue / row.cost : 0;

      // Cari data hari sebelumnya untuk delta
      const pd = new Date(row.tanggal + 'T00:00:00');
      pd.setDate(pd.getDate() - 1);
      const prevDateStr = toDateStr(pd);
      const prevRow = v.rows.find(r => r.tanggal === prevDateStr);

      let deltaHTML = '<span style="color:#cbd5e1">—</span>';
      if (prevRow) {
        const prevRoas = prevRow.cost > 0 ? prevRow.gross_revenue / prevRow.cost : 0;
        const roasDelta = roas - prevRoas;
        const costDelta = prevRow.cost > 0 ? (row.cost - prevRow.cost) / prevRow.cost * 100 : null;
        const revDelta = prevRow.gross_revenue > 0 ? (row.gross_revenue - prevRow.gross_revenue) / prevRow.gross_revenue * 100 : null;

        const parts = [];
        if (costDelta !== null) {
          // Cost naik = merah (boncos lebih besar), cost turun = hijau (hemat)
          const col = costDelta > 0 ? '#ef4444' : '#10b981';
          parts.push(`<span style="color:${col}">Cost ${costDelta > 0 ? '↑' : '↓'}${Math.abs(costDelta).toFixed(0)}%</span>`);
        }
        if (revDelta !== null) {
          const col = revDelta > 0 ? '#10b981' : '#ef4444';
          parts.push(`<span style="color:${col}">Rev ${revDelta > 0 ? '↑' : '↓'}${Math.abs(revDelta).toFixed(0)}%</span>`);
        }
        const roasCol = roasDelta >= 0 ? '#10b981' : '#ef4444';
        parts.push(`<span style="color:${roasCol};font-weight:600">ROAS ${roasDelta >= 0 ? '↑' : '↓'}${Math.abs(roasDelta).toFixed(2)}</span>`);
        deltaHTML = `<div style="font-size:11px;display:flex;gap:6px;flex-wrap:wrap">${parts.join('')}</div>`;
      }

      let statusBadge = '';
      if (row.cost > 0) {
        if (roas >= thr.high) statusBadge = '<span class="badge badge-green">Bagus</span>';
        else if (roas >= thr.mid) statusBadge = '<span class="badge badge-orange">Monitor</span>';
        else statusBadge = '<span class="badge badge-red">Boncos</span>';
      }

      return `<tr>
        <td style="white-space:nowrap;font-weight:500">${formatDate(row.tanggal)}</td>
        <td class="text-right num">${fmtRp(row.cost)}</td>
        <td class="text-right num">${fmtRp(row.gross_revenue)}</td>
        <td class="text-right"><span class="${roasClass(roas, thr.high, thr.mid)} num">${roas > 0 ? roas.toFixed(2) + 'x' : '-'}</span></td>
        <td class="text-right">${fmtNum(row.orders)}</td>
        <td>${deltaHTML}</td>
        <td>${statusBadge}</td>
      </tr>`;
    }).join('');

    return `
    <div class="card" style="margin-bottom:14px;padding:0;overflow:hidden">
      <!-- Header Video -->
      <div style="padding:14px 16px;border-bottom:1px solid #f1f5f9;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
            <span onclick="copyText('${v.video_id}', this)" title="Copy Video ID"
              style="font-weight:700;font-size:13px;font-family:monospace;cursor:pointer;color:var(--primary);user-select:none">${v.video_id}</span>
            <span class="badge badge-purple">${prodName}</span>
          </div>
          ${v.video_title !== v.video_id && v.video_title
            ? `<div style="font-size:13px;color:#334155;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:380px" title="${v.video_title}">${v.video_title}</div>`
            : ''}
          ${v.tiktok_account ? `<div style="font-size:12px;color:#94a3b8">${v.tiktok_account}</div>` : ''}
        </div>
        <!-- Ringkasan periode -->
        <div style="display:flex;gap:20px;flex-wrap:wrap;flex-shrink:0">
          <div style="text-align:right">
            <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Total Cost</div>
            <div style="font-size:14px;font-weight:700">${fmtRp(totalCost)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Total Revenue</div>
            <div style="font-size:14px;font-weight:700">${fmtRp(totalRev)}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Avg ROAS</div>
            <div class="${roasClass(avgRoas, thr.high, thr.mid)}" style="font-size:18px;font-weight:700">${avgRoas > 0 ? avgRoas.toFixed(2) + 'x' : '-'}</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:10px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px">Total Orders</div>
            <div style="font-size:14px;font-weight:700">${fmtNum(totalOrders)}</div>
          </div>
        </div>
      </div>
      <!-- Tabel harian -->
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tanggal</th>
              <th class="text-right">Cost</th>
              <th class="text-right">Revenue</th>
              <th class="text-right">ROAS</th>
              <th class="text-right">Orders</th>
              <th>vs Kemarin</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>
    </div>`;
  }).join('');
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
