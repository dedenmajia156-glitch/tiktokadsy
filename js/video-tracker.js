let profile = null;
let videoMap = {};
let selectedVideoId = null;
let prodThresholds = {}; // product_id → { high, mid }
let allVideos = []; // semua video setelah filter, untuk pagination
let vtPage = 0;

(async () => {
  profile = await initPage('video-tracker', 'Video Tracker');
  await loadFilters();
  await loadVideos();
  setupFilters();
})();

async function loadFilters() {
  const uid = (await getUser()).id;
  let q = db().from('products').select('*').order('nama_produk');
  if (profile?.role !== 'admin') q = q.eq('user_id', uid);
  const { data: prods } = await q;

  const sel = document.getElementById('fil-produk');
  (prods || []).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.nama_produk;
    sel.appendChild(opt);
    prodThresholds[p.id] = { high: p.roas_high ?? 3, mid: p.roas_mid ?? 1.5 };
  });
}

function setupFilters() {
  ['fil-produk','fil-roas','fil-status','fil-sort'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => { vtPage = 0; loadVideos(); });
  });
  document.getElementById('fil-search').addEventListener('input', () => { vtPage = 0; loadVideos(); });
  document.getElementById('fil-perpage').addEventListener('change', () => { vtPage = 0; renderPage(); });
}

async function loadVideos() {
  const uid = (await getUser()).id;
  const produkId  = document.getElementById('fil-produk').value;
  const search    = document.getElementById('fil-search').value.toLowerCase();
  const sort      = document.getElementById('fil-sort').value;
  const filRoas   = document.getElementById('fil-roas').value;
  const filStatus = document.getElementById('fil-status').value;

  let q = db().from('ads_data')
    .select('*, products(nama_produk)')
    .not('video_id', 'is', null)
    .neq('video_id', 'N/A')
    .gt('cost', 0);

  if (profile?.role !== 'admin') q = q.eq('user_id', uid);
  if (produkId) q = q.eq('product_id', produkId);

  let data;
  try { data = await fetchAllRows(q); }
  catch(e) { showToast('Gagal load: ' + e.message, 'error'); return; }

  // Aggregate per video_id
  const vmap = {};
  (data || []).forEach(r => {
    const vid = r.video_id;
    if (!vmap[vid]) {
      vmap[vid] = {
        vid,
        title: r.video_title || '',
        account: r.tiktok_account || '',
        produk: r.products?.nama_produk || '',
        product_id: r.product_id,
        bulanData: {},
        totalCost: 0,
        totalRev: 0,
        totalOrders: 0,
        status: r.status || '',
      };
    }
    vmap[vid].totalCost += Number(r.cost) || 0;
    vmap[vid].totalRev  += Number(r.gross_revenue) || 0;
    vmap[vid].totalOrders += Number(r.orders) || 0;
    if (!vmap[vid].bulanData[r.bulan]) vmap[vid].bulanData[r.bulan] = { cost: 0, rev: 0 };
    vmap[vid].bulanData[r.bulan].cost += Number(r.cost) || 0;
    vmap[vid].bulanData[r.bulan].rev  += Number(r.gross_revenue) || 0;
  });

  // Load last decision per video
  let dq = db().from('video_decisions')
    .select('video_id, keputusan, waktu_mulai, hasil')
    .order('created_at', { ascending: false });
  if (profile?.role !== 'admin') dq = dq.eq('user_id', uid);
  const { data: decisions } = await dq;

  const lastDecision = {};
  (decisions || []).forEach(d => {
    if (!lastDecision[d.video_id]) lastDecision[d.video_id] = d;
  });

  videoMap = vmap;
  let videos = Object.values(vmap).map(v => ({
    ...v,
    roas: v.totalCost > 0 ? v.totalRev / v.totalCost : 0,
    decision: lastDecision[v.vid] || null,
  }));

  // Filter search
  if (search) {
    videos = videos.filter(v =>
      v.title.toLowerCase().includes(search) ||
      v.account.toLowerCase().includes(search) ||
      v.vid.includes(search)
    );
  }

  // Filter ROAS
  if (filRoas !== '') {
    const minR = parseFloat(filRoas);
    const opt = document.getElementById('fil-roas').selectedOptions[0];
    const maxR = opt.dataset.max ? parseFloat(opt.dataset.max) : null;
    videos = videos.filter(v => {
      if (maxR !== null) return v.roas >= minR && v.roas < maxR;
      return v.roas >= minR;
    });
  }

  // Filter Keputusan
  if (filStatus === 'none') {
    videos = videos.filter(v => !v.decision);
  } else if (filStatus) {
    videos = videos.filter(v => v.decision?.keputusan === filStatus);
  }

  // Sort
  videos.sort((a, b) => {
    if (sort === 'roas_desc') return b.roas - a.roas;
    if (sort === 'roas_asc')  return a.roas - b.roas;
    if (sort === 'revenue_desc') return b.totalRev - a.totalRev;
    if (sort === 'cost_desc')    return b.totalCost - a.totalCost;
    return 0;
  });

  allVideos = videos;
  renderPage();
}

function renderPage() {
  const pageSize = parseInt(document.getElementById('fil-perpage').value) || 100;
  const totalPages = Math.ceil(allVideos.length / pageSize);
  vtPage = Math.min(vtPage, Math.max(0, totalPages - 1));
  const slice = allVideos.slice(vtPage * pageSize, (vtPage + 1) * pageSize);
  renderVideos(slice);

  const pg = document.getElementById('vt-pagination');
  if (totalPages <= 1) { pg.style.display = 'none'; return; }
  pg.style.display = 'flex';

  const start = vtPage * pageSize + 1;
  const end   = Math.min((vtPage + 1) * pageSize, allVideos.length);
  document.getElementById('vt-page-info').textContent = `${start}–${end} dari ${allVideos.length} video`;
  document.getElementById('vt-btn-prev').disabled = vtPage === 0;
  document.getElementById('vt-btn-next').disabled = vtPage >= totalPages - 1;

  const nums = document.getElementById('vt-page-nums');
  nums.innerHTML = '';
  let startP = Math.max(0, vtPage - 2);
  let endP   = Math.min(totalPages - 1, startP + 4);
  startP = Math.max(0, endP - 4);
  for (let i = startP; i <= endP; i++) {
    const btn = document.createElement('button');
    btn.textContent = i + 1;
    btn.className = 'btn btn-sm ' + (i === vtPage ? 'btn-primary-sm' : 'btn-outline');
    btn.style.minWidth = '34px';
    btn.onclick = () => { vtPage = i; renderPage(); };
    nums.appendChild(btn);
  }
}

function vtChangePage(dir) {
  const pageSize = parseInt(document.getElementById('fil-perpage').value) || 100;
  const totalPages = Math.ceil(allVideos.length / pageSize);
  vtPage = Math.max(0, Math.min(vtPage + dir, totalPages - 1));
  renderPage();
}

function renderVideos(videos) {
  const el = document.getElementById('video-list');

  if (!videos.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">🎬</div><h3>Tidak ada video</h3><p>Upload data iklan terlebih dahulu di menu Data Iklan</p></div>';
    return;
  }

  // Ambil semua bulan unik
  const allBulan = [...new Set(
    videos.flatMap(v => Object.keys(v.bulanData))
  )].sort();

  el.innerHTML = `
    <div class="card" style="padding:0;overflow:hidden">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Video</th>
              <th>Produk</th>
              <th>Total Cost</th>
              <th>Total Revenue</th>
              <th>ROAS</th>
              <th>Orders</th>
              ${allBulan.map(b => `<th style="min-width:80px;text-align:center">${b.replace(' 20','<br>20')}</th>`).join('')}
              <th>Keputusan</th>
              <th style="position:sticky;right:0;background:#f8f9fe;z-index:2;box-shadow:-2px 0 6px rgba(0,0,0,0.06)">Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${videos.map(v => {
              const thr = prodThresholds[v.product_id] || { high: 3, mid: 1.5 };
              const decBadge = v.decision
                ? `<span class="badge badge-${v.decision.keputusan}">${v.decision.keputusan}</span>`
                : '<span class="badge badge-gray">-</span>';

              const bulanCols = allBulan.map(b => {
                const d = v.bulanData[b];
                if (!d) return '<td style="text-align:center;color:#cbd5e1">-</td>';
                const r = d.cost > 0 ? d.rev / d.cost : 0;
                return `<td style="text-align:center">
                  <div class="${roasClass(r, thr.high, thr.mid)} num" style="font-size:12px;font-weight:700">${r.toFixed(1)}x</div>
                  <div style="font-size:10px;color:#94a3b8">${fmtRp(d.cost)}</div>
                </td>`;
              }).join('');

              return `<tr>
                <td class="td-video" style="min-width:180px">
                  <div class="vtitle">${v.title && v.title !== '-' ? v.title.slice(0,40) : 'ID: '+v.vid.slice(-10)}</div>
                  <div class="vaccount">${v.account}</div>
                  <div style="display:flex;align-items:center;gap:4px;margin-top:3px">
                    <span style="font-size:10px;color:#64748b;font-family:monospace">${v.vid}</span>
                    <button onclick="copyVid('${v.vid}')" title="Copy Video ID" style="background:none;border:none;cursor:pointer;padding:0;color:#94a3b8;line-height:1;flex-shrink:0">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </div>
                </td>
                <td><span class="badge badge-purple" style="font-size:10px">${v.produk}</span></td>
                <td class="num">${fmtRp(v.totalCost)}</td>
                <td class="num">${fmtRp(v.totalRev)}</td>
                <td><span class="${roasClass(v.roas, thr.high, thr.mid)} num fw-700">${v.roas.toFixed(2)}x</span></td>
                <td>${v.totalOrders}</td>
                ${bulanCols}
                <td>${decBadge}</td>
                <td style="position:sticky;right:0;background:#fff;z-index:1;box-shadow:-2px 0 6px rgba(0,0,0,0.06)">
                  <div style="display:flex;gap:6px">
                    <button class="btn btn-outline btn-sm" onclick="openPreview('${v.vid}','${(v.title||'').replace(/'/g,"\\'").slice(0,50)}')" title="Preview Video">▶</button>
                    <button class="btn btn-primary-sm btn-sm" onclick="openDecisionModal('${v.vid}')">Keputusan</button>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function copyVid(vid) {
  navigator.clipboard.writeText(vid).then(() => showToast('Video ID disalin!', 'success'));
}

// ============ VIDEO PREVIEW ============
function openPreview(vid, title) {
  document.getElementById('preview-title').textContent = title || ('Video ' + vid);
  document.getElementById('preview-vid-id').textContent = vid;
  document.getElementById('preview-tiktok-link').href = `https://www.tiktok.com/video/${vid}`;
  document.getElementById('preview-body').innerHTML =
    `<iframe src="https://www.tiktok.com/embed/v2/${vid}"
      style="width:100%;height:560px;border:none"
      allow="autoplay;fullscreen" allowfullscreen></iframe>`;
  document.getElementById('modal-preview').classList.add('open');
}

function closePreview() {
  document.getElementById('modal-preview').classList.remove('open');
  document.getElementById('preview-body').innerHTML =
    '<div class="loader" style="margin:auto"><div class="spinner" style="border-color:#fff3;border-top-color:#fff"></div></div>';
}

// ============ DECISION MODAL ============
function openDecisionModal(videoId) {
  selectedVideoId = videoId;
  const v = videoMap[videoId];
  if (!v) return;

  const roas = v.totalCost > 0 ? v.totalRev / v.totalCost : 0;
  document.getElementById('modal-dec-title').textContent = 'Keputusan: ' + (v.title?.slice(0,30) || videoId);
  document.getElementById('modal-dec-info').innerHTML = `
    <div style="display:flex;gap:24px;flex-wrap:wrap">
      <div><div class="fw-600">${fmtRp(v.totalCost)}</div><div class="text-muted" style="font-size:11px">Total Spend</div></div>
      <div><div class="fw-600">${fmtRp(v.totalRev)}</div><div class="text-muted" style="font-size:11px">Total Revenue</div></div>
      <div><div class="fw-600 ${roasClass(roas)}">${roas.toFixed(2)}x</div><div class="text-muted" style="font-size:11px">ROAS</div></div>
      <div><div class="fw-600">${v.account}</div><div class="text-muted" style="font-size:11px">Akun TikTok</div></div>
    </div>`;

  document.getElementById('dec-value').value = '';
  document.getElementById('dec-note').value = '';
  document.getElementById('dec-err').style.display = 'none';
  ['scale','kill','monitor'].forEach(d =>
    document.getElementById('dec-'+d).style.outline = 'none'
  );
  document.getElementById('modal-decision').classList.add('open');
}

function closeDecisionModal() {
  document.getElementById('modal-decision').classList.remove('open');
  selectedVideoId = null;
}

function setDecision(val) {
  document.getElementById('dec-value').value = val;
  ['scale','kill','monitor'].forEach(d => {
    document.getElementById('dec-'+d).style.outline =
      d === val ? '2px solid #6366f1' : 'none';
  });
}

async function saveDecision() {
  const keputusan = document.getElementById('dec-value').value;
  const catatan   = document.getElementById('dec-note').value.trim();
  const errEl     = document.getElementById('dec-err');

  errEl.style.display = 'none';
  if (!keputusan) { showErr(errEl, 'Pilih keputusan terlebih dahulu.'); return; }
  if (!selectedVideoId) return;

  const uid = (await getUser()).id;
  const v = videoMap[selectedVideoId];

  const { error } = await db().from('video_decisions').insert({
    video_id: selectedVideoId,
    product_id: v?.product_id || null,
    user_id: uid,
    keputusan,
    catatan: catatan || null,
    waktu_mulai: new Date().toISOString(),
  });

  if (error) { showErr(errEl, error.message); return; }

  showToast(`Keputusan "${keputusan}" disimpan!`, 'success');
  closeDecisionModal();
  await loadVideos();
}
