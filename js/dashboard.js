let profile = null;
let products = [];
let prodThresholds = {};
let chartRevenue = null;

const CACHE_TTL = 5 * 60 * 1000; // 5 menit

function cacheKey(uid, bulan, produkId) {
  return `gmv_dash_${uid}_${bulan || 'all'}_${produkId || 'all'}`;
}

function getCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { sessionStorage.removeItem(key); return null; }
    return data;
  } catch(_) { return null; }
}

function setCache(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch(_) {}
}

function clearDashCache() {
  Object.keys(sessionStorage).filter(k => k.startsWith('gmv_dash_')).forEach(k => sessionStorage.removeItem(k));
}

(async () => {
  profile = await initPage('dashboard', 'Dashboard');
  await loadFilters();
  await loadDashboard();
})();

// Re-load ketika admin ganti advertiser
window.addEventListener('advertiserSwitch', async () => {
  clearDashCache();
  // Reset filter produk & bulan, lalu reload
  document.getElementById('fil-produk').innerHTML = '<option value="">Semua Produk</option>';
  document.getElementById('fil-bulan').innerHTML  = '<option value="">Semua Bulan</option>';
  products = [];
  prodThresholds = {};
  await loadFilters();
  await loadDashboard(true);
});

// Pakai advertiser yang dipilih (admin), atau user sendiri
async function getTargetUid() {
  const uid = (await getUser()).id;
  return window.__activeAdvertiser || uid;
}

async function loadFilters() {
  const uid = await getTargetUid();

  // Load produk
  let q = db().from('products').select('*').order('nama_produk');
  if (profile?.role !== 'admin' || window.__activeAdvertiser) q = q.eq('user_id', uid);
  const { data: prods } = await q;
  products = prods || [];
  products.forEach(p => {
    prodThresholds[p.id] = { high: p.roas_high ?? 3, mid: p.roas_mid ?? 1.5 };
  });
  const selProduk = document.getElementById('fil-produk');
  products.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.nama_produk;
    selProduk.appendChild(opt);
  });

  // Load distinct bulan via RPC
  const { data: bulanRaw } = await db().rpc('get_distinct_bulan', { p_user_id: uid });
  const bulanOrder = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const bulanSet = (bulanRaw || []).map(r => r.bulan).filter(Boolean);
  bulanSet.sort((a, b) => {
    const parse = s => {
      const p = s.split(' ');
      return (parseInt(p[1]) || 0) * 100 + bulanOrder.indexOf(p[0]);
    };
    return parse(b) - parse(a);
  });
  const selBulan = document.getElementById('fil-bulan');
  bulanSet.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b; opt.textContent = b;
    selBulan.appendChild(opt);
  });

  // Default ke bulan terbaru
  if (bulanSet.length > 0) selBulan.value = bulanSet[0];

  selBulan.addEventListener('change', loadDashboard);
  selProduk.addEventListener('change', loadDashboard);
}

async function loadDashboard(forceRefresh = false) {
  const uid      = await getTargetUid();
  const bulan    = document.getElementById('fil-bulan').value || null;
  const produkId = document.getElementById('fil-produk').value || null;
  const key      = cacheKey(uid, bulan, produkId);
  const chartKey = `gmv_chart_${uid}_${produkId || 'all'}`;

  // Cek cache stats dulu
  if (!forceRefresh) {
    const cached      = getCache(key);
    const cachedChart = getCache(chartKey);
    if (cached && cachedChart) {
      renderStats(cached.stats);
      renderChart(cachedChart, bulan);
      renderTopVideo(cached.topVids);
      renderTopRevenue(cached.topRevs || []);
      renderKillCandidates(cached.kills);
      renderNeedCheck();
      return;
    }
  }

  // Fetch paralel — chart pakai cache terpisah (tidak tergantung bulan)
  const needChart = !getCache(chartKey);
  const requests = [
    db().rpc('get_dashboard_stats', { p_user_id: uid, p_bulan: bulan, p_product_id: produkId }),
    db().rpc('get_top_videos',      { p_user_id: uid, p_bulan: bulan, p_product_id: produkId }),
    db().rpc('get_kill_candidates', { p_user_id: uid, p_bulan: bulan, p_product_id: produkId }),
    db().rpc('get_top_revenue',     { p_user_id: uid, p_bulan: bulan, p_product_id: produkId }),
    needChart ? db().rpc('get_bulan_chart', { p_user_id: uid, p_product_id: produkId }) : Promise.resolve(null),
  ];

  const [statsRes, topRes, killRes, revRes, chartRes] = await Promise.all(requests);

  const stats    = statsRes.data?.[0] || {};
  const topVids  = topRes.data || [];
  const kills    = killRes.data || [];
  const topRevs  = revRes.data || [];
  const chart    = chartRes ? (chartRes.data || []) : getCache(chartKey);
  if (revRes.error) console.error('get_top_revenue error:', revRes.error);
  console.log('top revenue data:', topRevs);

  setCache(key, { stats, topVids, kills, topRevs });
  if (needChart) setCache(chartKey, chart);

  renderStats(stats);
  renderChart(chart, bulan);
  renderTopVideo(topVids);
  renderTopRevenue(topRevs);
  renderKillCandidates(kills);
  renderNeedCheck();
}

function renderStats(stats) {
  const cost = Number(stats.total_cost) || 0;
  const rev  = Number(stats.total_revenue) || 0;
  const roas = cost > 0 ? rev / cost : 0;

  document.getElementById('stat-spend').textContent   = fmtRp(cost);
  document.getElementById('stat-revenue').textContent = fmtRp(rev);
  document.getElementById('stat-roas').textContent    = roas.toFixed(2) + 'x';
  document.getElementById('stat-video').textContent   = stats.video_count || 0;
}

function renderChart(chart, selectedBulan) {
  const bulanOrder = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const sorted = [...chart].sort((a, b) => {
    const parse = s => { const p = (s||'').split(' '); return (parseInt(p[1])||0)*100 + bulanOrder.indexOf(p[0]); };
    return parse(a.bulan) - parse(b.bulan);
  });

  const labels = sorted.map(r => r.bulan);
  const costs  = sorted.map(r => Number(r.total_cost) || 0);
  const revs   = sorted.map(r => Number(r.total_revenue) || 0);

  // Highlight bulan yang dipilih, redup yang lain
  const revColors  = labels.map(b => !selectedBulan || b === selectedBulan ? 'rgba(99,102,241,0.85)' : 'rgba(99,102,241,0.25)');
  const costColors = labels.map(b => !selectedBulan || b === selectedBulan ? 'rgba(16,185,129,0.75)' : 'rgba(16,185,129,0.2)');

  const ctx = document.getElementById('chart-revenue').getContext('2d');
  if (chartRevenue) chartRevenue.destroy();
  chartRevenue = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Revenue',   data: revs,  backgroundColor: revColors,  borderRadius: 6, order: 1 },
        { label: 'Ads Spend', data: costs, backgroundColor: costColors, borderRadius: 6, order: 2 }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: 'Plus Jakarta Sans', size: 12 } } },
        tooltip: { callbacks: { label: ctx => ' ' + fmtRp(ctx.raw) } }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: v => fmtRp(v), font: { family: 'Plus Jakarta Sans', size: 11 } },
          grid: { color: '#f1f5f9' }
        },
        x: { ticks: { font: { family: 'Plus Jakarta Sans', size: 11 } }, grid: { display: false } }
      }
    }
  });
}

function renderTopVideo(vids) {
  const list = document.getElementById('top-video-list');
  if (!vids.length) {
    list.innerHTML = '<li><div class="empty-state"><div class="icon">📭</div><p>Belum ada data</p></div></li>';
    return;
  }
  const numClasses = ['gold','silver','bronze','',''];
  list.innerHTML = vids.map((v, i) => {
    const thr  = prodThresholds[v.product_id] || { high: 3, mid: 1.5 };
    const roas = Number(v.roas) || 0;
    const title = v.video_title && v.video_title !== '-' ? v.video_title.slice(0, 40) : 'Video ID: ' + (v.video_id || '').slice(-8);
    return `<li>
      <div class="top-num ${numClasses[i]}">${String(i+1).padStart(2,'0')}</div>
      <div class="top-info">
        <div class="vname">${title}</div>
        <div class="vacct">${v.tiktok_account || '-'}</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, roas/thr.high*100)}%"></div></div>
      </div>
      <div class="top-roas ${roasClass(roas, thr.high, thr.mid)}">${roas.toFixed(1)}x</div>
    </li>`;
  }).join('');
}

function renderTopRevenue(vids) {
  const list = document.getElementById('top-revenue-list');
  if (!vids.length) {
    list.innerHTML = '<li><div class="empty-state"><div class="icon">📭</div><p>Belum ada data</p></div></li>';
    return;
  }
  const numClasses = ['gold','silver','bronze','',''];
  const maxRev = Number(vids[0]?.total_revenue) || 1;
  list.innerHTML = vids.map((v, i) => {
    const rev   = Number(v.total_revenue) || 0;
    const title = v.video_title && v.video_title !== '-' ? v.video_title.slice(0, 40) : 'Video ID: ' + (v.video_id || '').slice(-8);
    return `<li>
      <div class="top-num ${numClasses[i]}">${String(i+1).padStart(2,'0')}</div>
      <div class="top-info">
        <div class="vname">${title}</div>
        <div class="vacct">${v.tiktok_account || '-'}</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, rev/maxRev*100)}%;background:linear-gradient(90deg,#10b981,#34d399)"></div></div>
      </div>
      <div class="top-roas roas-high">${fmtRp(rev)}</div>
    </li>`;
  }).join('');
}

function renderKillCandidates(kills) {
  const el = document.getElementById('kill-candidates');
  if (!kills.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">🎉</div><p>Tidak ada kandidat kill</p></div>';
    return;
  }
  el.innerHTML = `
    <table>
      <thead><tr><th>Video</th><th>ROAS</th><th>Spend</th></tr></thead>
      <tbody>
        ${kills.map(v => {
          const thr  = prodThresholds[v.product_id] || { high: 3, mid: 1.5 };
          const roas = Number(v.roas) || 0;
          const title = v.video_title && v.video_title !== '-' ? v.video_title.slice(0,30) : 'Video ID: '+(v.video_id||'').slice(-8);
          return `<tr>
            <td class="td-video">
              <div class="vtitle">${title}</div>
              <div class="vaccount">${v.tiktok_account || '-'}</div>
            </td>
            <td><span class="${roasClass(roas, thr.high, thr.mid)}">${roas.toFixed(2)}x</span></td>
            <td><span class="text-muted">${fmtRp(v.total_cost)}</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

async function renderNeedCheck() {
  const uid = await getTargetUid();
  let q = db().from('video_decisions')
    .select('*, ads_data(video_title, tiktok_account)')
    .eq('keputusan', 'scale')
    .is('hasil', null)
    .order('waktu_mulai', { ascending: false })
    .limit(5);
  if (profile?.role !== 'admin') q = q.eq('user_id', uid);

  const { data } = await q;
  const list = document.getElementById('need-check-list');
  if (!data?.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">✅</div><p>Tidak ada yang perlu dicek</p></div>';
    return;
  }
  list.innerHTML = `
    <table>
      <thead><tr><th>Video</th><th>Di-scale</th><th>Aksi</th></tr></thead>
      <tbody>
        ${data.map(d => {
          const jam = Math.round((Date.now() - new Date(d.waktu_mulai)) / 3600000);
          return `<tr>
            <td class="td-video">
              <div class="vtitle">${d.ads_data?.video_title?.slice(0,30) || 'Video ID: '+d.video_id.slice(-8)}</div>
              <div class="vaccount">${d.ads_data?.tiktok_account || '-'}</div>
            </td>
            <td><span class="text-muted">${jam}j lalu</span></td>
            <td><a href="scale-kill.html" class="btn btn-monitor btn-sm">Cek</a></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}
