let profile = null;
let videoMap = {};
let selectedVideoId = null;
let prodThresholds = {}; // product_id → { high, mid }
let prodTiktokId = {};   // product_id → product_id_tiktok
let allVideos = []; // semua video setelah filter, untuk pagination
let vtPage = 0;

const VT_CACHE_TTL = 5 * 60 * 1000; // 5 menit
function vtGetCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > VT_CACHE_TTL) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch(_) { return null; }
}
function vtSetCache(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch(_) {}
}
function clearVtCache() {
  Object.keys(sessionStorage).filter(k => k.startsWith('gmv_vt_')).forEach(k => sessionStorage.removeItem(k));
}

(async () => {
  profile = await initPage('video-tracker', 'Video Tracker');
  await loadFilters();
  await loadVideos();
  setupFilters();
})();

// Re-load ketika admin ganti advertiser
window.addEventListener('advertiserSwitch', async () => {
  clearVtCache();
  document.getElementById('fil-produk').innerHTML = '<option value="">Semua Produk</option>';
  prodThresholds = {};
  prodTiktokId = {};
  vtPage = 0;
  await loadFilters();
  await loadVideos();
});

// Pakai advertiser yang dipilih (admin), atau user sendiri
async function getTargetUid() {
  const uid = (await getUser()).id;
  return window.__activeAdvertiser || uid;
}

async function loadFilters() {
  const uid = await getTargetUid();
  let q = db().from('products').select('*').order('nama_produk');
  if (profile?.role !== 'admin' || window.__activeAdvertiser) q = q.eq('user_id', uid);
  const { data: prods } = await q;

  const sel = document.getElementById('fil-produk');
  (prods || []).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.nama_produk;
    sel.appendChild(opt);
    prodThresholds[p.id] = { high: p.roas_high ?? 3, mid: p.roas_mid ?? 1.5 };
    prodTiktokId[p.id] = p.product_id_tiktok;
  });
  updateRoasFilter();
}

function setupFilters() {
  document.getElementById('fil-produk').addEventListener('change', () => {
    updateRoasFilter();
    vtPage = 0;
    loadVideos();
  });
  ['fil-roas','fil-status','fil-sort'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => { vtPage = 0; loadVideos(); });
  });
  document.getElementById('fil-search').addEventListener('input', () => { vtPage = 0; loadVideos(); });
  document.getElementById('fil-perpage').addEventListener('change', () => { vtPage = 0; renderPage(); });
}

async function loadVideos() {
  const uid = await getTargetUid();
  const produkId  = document.getElementById('fil-produk').value;
  const search    = document.getElementById('fil-search').value.toLowerCase();
  const sort      = document.getElementById('fil-sort').value;
  const filRoas   = document.getElementById('fil-roas').value;
  const filStatus = document.getElementById('fil-status').value;

  const ckey = `gmv_vt_${uid}_${produkId || 'all'}`;
  let rows, decisionsRaw;

  const cached = vtGetCache(ckey);
  if (cached) {
    rows = cached.rows;
    decisionsRaw = cached.decisions;
  } else {
    document.getElementById('video-list').innerHTML = '<div class="loader"><div class="spinner"></div></div>';

    // Pakai RPC — aggregasi di server, 1 request vs ribuan baris
    const rpcParams = {
      p_user_id: (profile?.role !== 'admin' || window.__activeAdvertiser) ? uid : null,
      p_product_id: produkId || null,
    };

    let dq = db().from('video_decisions')
      .select('video_id, keputusan, waktu_mulai, hasil')
      .order('created_at', { ascending: false });
    if (profile?.role !== 'admin') dq = dq.eq('user_id', uid);

    const [{ data: rpcData, error: rpcErr }, { data: dec }] = await Promise.all([
      db().rpc('get_video_tracker', rpcParams),
      dq,
    ]);

    if (rpcErr) { showToast('Gagal load: ' + rpcErr.message, 'error'); return; }
    rows = rpcData || [];
    decisionsRaw = dec || [];

    vtSetCache(ckey, { rows, decisions: decisionsRaw });
  }

  // Map langsung dari hasil RPC (sudah di-aggregate server-side)
  const vmap = {};
  rows.forEach(r => {
    vmap[r.video_id] = {
      vid:        r.video_id,
      title:      r.video_title || '',
      account:    r.tiktok_account || '',
      produk:     r.product_name || '',
      product_id: r.product_id,
      bulanData:  r.bulan_data || {},
      totalCost:  Number(r.total_cost) || 0,
      totalRev:   Number(r.total_rev) || 0,
      totalOrders: Number(r.total_orders) || 0,
    };
  });

  const lastDecision = {};
  (decisionsRaw || []).forEach(d => {
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

function updateRoasFilter() {
  const produkId = document.getElementById('fil-produk').value;
  const thr = prodThresholds[produkId] || { high: 3, mid: 1.5 };
  const sel = document.getElementById('fil-roas');
  const current = sel.value;
  sel.innerHTML = `
    <option value="">Semua</option>
    <option value="${thr.high}">≥ ${thr.high}x (Bagus)</option>
    <option value="${thr.mid}" data-max="${thr.high}">${thr.mid}x – ${thr.high}x (Monitor)</option>
    <option value="0" data-max="${thr.mid}">< ${thr.mid}x (Kill)</option>`;
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
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

  // Ambil semua bulan unik — sort kronologis
  const bulanOrder = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const parseBulan = s => { const p = (s||'').split(' '); return (parseInt(p[1])||0)*100 + bulanOrder.indexOf(p[0]); };
  const allBulan = [...new Set(
    videos.flatMap(v => Object.keys(v.bulanData))
  )].sort((a, b) => parseBulan(a) - parseBulan(b));

  // Sticky column layout: left positions & widths
  const S = [
    { l: 0,   w: 220 },  // 0: Video
    { l: 220, w: 160 },  // 1: Produk
    { l: 380, w: 100 },  // 2: Total Cost
    { l: 480, w: 110 },  // 3: Total Revenue
    { l: 590, w: 90  },  // 4: ROAS
    { l: 680, w: 70  },  // 5: Orders  ← last pinned, has right shadow
  ];
  const DIVIDER = 'box-shadow:2px 0 8px rgba(0,0,0,0.08);border-right:1px solid #e2e8f0;';
  const sH = i => `position:sticky;left:${S[i].l}px;width:${S[i].w}px;min-width:${S[i].w}px;background:#f8f9fe;z-index:4;${i===5?DIVIDER:''}`;
  const sD = (i, bg='#fff') => `position:sticky;left:${S[i].l}px;width:${S[i].w}px;min-width:${S[i].w}px;background:${bg};z-index:2;${i===5?DIVIDER:''}`;

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
              ${allBulan.map(b => `
                <th style="min-width:110px;text-align:center">
                  ${b.replace(' 20','<br>20')}
                  <div style="font-size:9px;font-weight:400;color:#94a3b8;margin-top:2px">Cost · Revenue · ROAS</div>
                </th>`).join('')}
              <th>Keputusan</th>
              <th style="position:sticky;right:0;background:#f8f9fe;z-index:4;box-shadow:-2px 0 6px rgba(0,0,0,0.06)">Aksi</th>
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
                return `<td style="text-align:center;padding:6px 8px">
                  <div style="font-size:11px;color:#64748b">${fmtRp(d.cost)}</div>
                  <div style="font-size:11px;color:#10b981;font-weight:600">${fmtRp(d.rev)}</div>
                  <div class="${roasClass(r, thr.high, thr.mid)} num" style="font-size:12px;font-weight:700">${r.toFixed(1)}x</div>
                </td>`;
              }).join('');

              return `<tr style="border-top:1px solid #f1f5f9">
                <td class="td-video" style="${sD(0)}">
                  <div class="vtitle">${v.title && v.title !== '-' ? v.title.slice(0,40) : 'ID: '+v.vid.slice(-10)}</div>
                  <div class="vaccount">${v.account}</div>
                  <div style="display:flex;align-items:center;gap:4px;margin-top:3px">
                    <span style="font-size:10px;color:#64748b;font-family:monospace">${v.vid}</span>
                    <button onclick="copyVid('${v.vid}')" title="Copy Video ID" style="background:none;border:none;cursor:pointer;padding:0;color:#94a3b8;line-height:1;flex-shrink:0">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </div>
                </td>
                <td style="${sD(1)}">
                  <span class="badge badge-purple" style="font-size:10px">${v.produk}</span>
                  ${prodTiktokId[v.product_id] ? `
                  <div style="display:flex;align-items:center;gap:4px;margin-top:3px">
                    <span style="font-size:10px;color:#64748b;font-family:monospace">${prodTiktokId[v.product_id]}</span>
                    <button onclick="copyVid('${prodTiktokId[v.product_id]}')" title="Copy Product ID" style="background:none;border:none;cursor:pointer;padding:0;color:#94a3b8;line-height:1">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                    </button>
                  </div>` : ''}
                </td>
                <td class="num" style="${sD(2)}">${fmtRp(v.totalCost)}</td>
                <td class="num" style="${sD(3)}">${fmtRp(v.totalRev)}</td>
                <td style="${sD(4)}"><span class="${roasClass(v.roas, thr.high, thr.mid)} num fw-700">${v.roas.toFixed(2)}x</span></td>
                <td style="${sD(5)}">${v.totalOrders}</td>
                ${bulanCols}
                <td>${decBadge}</td>
                <td style="position:sticky;right:0;background:#fff;z-index:2;box-shadow:-2px 0 6px rgba(0,0,0,0.06)">
                  <button class="btn btn-primary-sm btn-sm" onclick="openDecisionModal('${v.vid}')">Keputusan</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="background:#f8f9fe;border-top:2px solid #e2e8f0;font-weight:700">
              <td style="${sD(0,'#f8f9fe')}padding:10px 14px;font-size:13px;color:#475569">
                TOTAL (${videos.length} video)
              </td>
              <td style="${sD(1,'#f8f9fe')}padding:10px 8px"></td>
              <td class="num" style="${sD(2,'#f8f9fe')}padding:10px 8px">
                ${fmtRp(videos.reduce((s,v) => s + v.totalCost, 0))}
              </td>
              <td class="num" style="${sD(3,'#f8f9fe')}padding:10px 8px">
                ${fmtRp(videos.reduce((s,v) => s + v.totalRev, 0))}
              </td>
              <td style="${sD(4,'#f8f9fe')}padding:10px 8px">
                ${(() => {
                  const tc = videos.reduce((s,v) => s + v.totalCost, 0);
                  const tr = videos.reduce((s,v) => s + v.totalRev, 0);
                  const r = tc > 0 ? tr/tc : 0;
                  return `<span class="${roasClass(r)}" style="font-size:14px">${r.toFixed(2)}x</span>`;
                })()}
              </td>
              <td style="${sD(5,'#f8f9fe')}padding:10px 8px">
                ${videos.reduce((s,v) => s + v.totalOrders, 0).toLocaleString('id-ID')}
              </td>
              ${allBulan.map(b => {
                const tc = videos.reduce((s,v) => s + (v.bulanData[b]?.cost||0), 0);
                const tr = videos.reduce((s,v) => s + (v.bulanData[b]?.rev||0), 0);
                const r = tc > 0 ? tr/tc : 0;
                if (!tc) return '<td style="text-align:center;color:#cbd5e1;padding:10px 8px">-</td>';
                return `<td style="text-align:center;padding:10px 8px">
                  <div style="font-size:11px;color:#64748b">${fmtRp(tc)}</div>
                  <div style="font-size:11px;color:#10b981;font-weight:600">${fmtRp(tr)}</div>
                  <div class="${roasClass(r)}" style="font-size:12px;font-weight:700">${r.toFixed(1)}x</div>
                </td>`;
              }).join('')}
              <td colspan="2" style="padding:10px 8px"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

function copyVid(vid) {
  navigator.clipboard.writeText(vid).then(() => showToast('Video ID disalin!', 'success'));
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

  clearVtCache(); // decisions berubah, paksa re-fetch
  showToast(`Keputusan "${keputusan}" disimpan!`, 'success');
  closeDecisionModal();
  await loadVideos();
}
