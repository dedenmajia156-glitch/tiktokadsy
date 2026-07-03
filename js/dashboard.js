let profile = null;
let allData = [];
let products = [];
let prodThresholds = {};
let chartRevenue = null;

(async () => {
  profile = await initPage('dashboard', 'Dashboard');
  await loadFilters();
  await loadDashboard();
})();

async function loadFilters() {
  const uid = (await getUser()).id;

  // Load produk user
  let q = db().from('products').select('*').order('nama_produk');
  if (profile?.role !== 'admin') q = q.eq('user_id', uid);
  const { data: prods } = await q;
  products = prods || [];
  products.forEach(p => {
    prodThresholds[p.id] = { high: p.roas_high ?? 3, mid: p.roas_mid ?? 1.5 };
  });

  const selProduk = document.getElementById('fil-produk');
  products.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.nama_produk;
    selProduk.appendChild(opt);
  });

  // Load bulan — pakai fetchAllRows biar tidak kena limit 1000
  let qb = db().from('ads_data').select('bulan').order('bulan');
  if (profile?.role !== 'admin') qb = qb.eq('user_id', uid);
  const bulanData = await fetchAllRows(qb);
  const bulanOrder = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const bulanSet = [...new Set((bulanData || []).map(r => r.bulan).filter(Boolean))];
  bulanSet.sort((a, b) => {
    const parse = s => {
      const p = s.split(' ');
      return (parseInt(p[1]) || 0) * 100 + bulanOrder.indexOf(p[0]);
    };
    return parse(b) - parse(a); // terbaru dulu
  });
  const selBulan = document.getElementById('fil-bulan');
  bulanSet.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b; opt.textContent = b;
    selBulan.appendChild(opt);
  });

  selBulan.addEventListener('change', loadDashboard);
  selProduk.addEventListener('change', loadDashboard);
}

async function loadDashboard() {
  const uid = (await getUser()).id;
  const bulan = document.getElementById('fil-bulan').value;
  const produkId = document.getElementById('fil-produk').value;

  let q = db().from('ads_data').select('*, products(nama_produk, product_id_tiktok)');
  if (profile?.role !== 'admin') q = q.eq('user_id', uid);
  if (bulan) q = q.eq('bulan', bulan);
  if (produkId) q = q.eq('product_id', produkId);
  // hanya yang ada spend
  q = q.gt('cost', 0);

  let allData2;
  try { allData2 = await fetchAllRows(q); }
  catch(e) { showToast('Gagal load data: ' + e.message, 'error'); return; }
  allData = allData2;

  renderStats();
  renderChart();
  renderTopVideo();
  renderNeedCheck();
  renderKillCandidates();
}

function renderStats() {
  const totalSpend = allData.reduce((s, r) => s + (Number(r.cost) || 0), 0);
  const totalRev = allData.reduce((s, r) => s + (Number(r.gross_revenue) || 0), 0);
  const roas = totalSpend > 0 ? totalRev / totalSpend : 0;

  // unique video id aktif (cost > 0 dan bukan N/A)
  const videoSet = new Set(allData.filter(r => r.video_id && r.video_id !== 'N/A').map(r => r.video_id));

  document.getElementById('stat-spend').textContent = fmtRp(totalSpend);
  document.getElementById('stat-revenue').textContent = fmtRp(totalRev);
  document.getElementById('stat-roas').textContent = roas.toFixed(2) + 'x';
  document.getElementById('stat-video').textContent = videoSet.size;
}

function renderChart() {
  // Group by bulan
  const byBulan = {};
  allData.forEach(r => {
    if (!r.bulan) return;
    if (!byBulan[r.bulan]) byBulan[r.bulan] = { cost: 0, rev: 0 };
    byBulan[r.bulan].cost += Number(r.cost) || 0;
    byBulan[r.bulan].rev += Number(r.gross_revenue) || 0;
  });

  const labels = Object.keys(byBulan).sort();
  const costs = labels.map(b => byBulan[b].cost);
  const revs = labels.map(b => byBulan[b].rev);

  const ctx = document.getElementById('chart-revenue').getContext('2d');
  if (chartRevenue) chartRevenue.destroy();

  chartRevenue = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Revenue',
          data: revs,
          backgroundColor: 'rgba(99,102,241,0.8)',
          borderRadius: 6,
          order: 1
        },
        {
          label: 'Ads Spend',
          data: costs,
          backgroundColor: 'rgba(16,185,129,0.7)',
          borderRadius: 6,
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { font: { family: 'Plus Jakarta Sans', size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => ' ' + fmtRp(ctx.raw)
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: v => fmtRp(v),
            font: { family: 'Plus Jakarta Sans', size: 11 }
          },
          grid: { color: '#f1f5f9' }
        },
        x: {
          ticks: { font: { family: 'Plus Jakarta Sans', size: 11 } },
          grid: { display: false }
        }
      }
    }
  });
}

function renderTopVideo() {
  // Aggregate per video_id
  const byVideo = {};
  allData.filter(r => r.video_id && r.video_id !== 'N/A').forEach(r => {
    const vid = r.video_id;
    if (!byVideo[vid]) byVideo[vid] = { title: r.video_title || '-', account: r.tiktok_account || '-', product_id: r.product_id, cost: 0, rev: 0 };
    byVideo[vid].cost += Number(r.cost) || 0;
    byVideo[vid].rev += Number(r.gross_revenue) || 0;
  });

  const sorted = Object.entries(byVideo)
    .map(([vid, d]) => ({ vid, ...d, roas: d.cost > 0 ? d.rev / d.cost : 0 }))
    .sort((a, b) => b.roas - a.roas)
    .slice(0, 5);

  const numClasses = ['gold', 'silver', 'bronze', '', ''];
  const list = document.getElementById('top-video-list');

  if (!sorted.length) {
    list.innerHTML = '<li><div class="empty-state"><div class="icon">📭</div><p>Belum ada data</p></div></li>';
    return;
  }

  list.innerHTML = sorted.map((v, i) => {
    const thr = prodThresholds[v.product_id] || { high: 3, mid: 1.5 };
    return `
    <li>
      <div class="top-num ${numClasses[i]}">${String(i+1).padStart(2,'0')}</div>
      <div class="top-info">
        <div class="vname">${v.title === '-' || !v.title ? 'Video ID: ' + v.vid.slice(-8) : v.title.slice(0,40)}</div>
        <div class="vacct">${v.account}</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.min(100, v.roas / thr.high * 100)}%"></div></div>
      </div>
      <div class="top-roas ${roasClass(v.roas, thr.high, thr.mid)}">${v.roas.toFixed(1)}x</div>
    </li>`;
  }).join('');
}

async function renderNeedCheck() {
  const uid = (await getUser()).id;
  let q = db().from('video_decisions')
    .select('*, ads_data(video_title, tiktok_account, cost, gross_revenue)')
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

function renderKillCandidates() {
  const byVideo = {};
  allData.filter(r => r.video_id && r.video_id !== 'N/A' && Number(r.cost) > 0).forEach(r => {
    const vid = r.video_id;
    if (!byVideo[vid]) byVideo[vid] = { title: r.video_title || '-', account: r.tiktok_account || '-', product_id: r.product_id, cost: 0, rev: 0 };
    byVideo[vid].cost += Number(r.cost) || 0;
    byVideo[vid].rev += Number(r.gross_revenue) || 0;
  });

  const candidates = Object.entries(byVideo)
    .map(([vid, d]) => ({ vid, ...d, roas: d.cost > 0 ? d.rev / d.cost : 0 }))
    .filter(v => {
      const thr = prodThresholds[v.product_id] || { high: 3, mid: 1.5 };
      return v.roas < thr.mid && v.cost > 10000;
    })
    .sort((a, b) => a.roas - b.roas)
    .slice(0, 5);

  const el = document.getElementById('kill-candidates');

  if (!candidates.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">🎉</div><p>Tidak ada kandidat kill</p></div>';
    return;
  }

  el.innerHTML = `
    <table>
      <thead><tr><th>Video</th><th>ROAS</th><th>Spend</th></tr></thead>
      <tbody>
        ${candidates.map(v => {
          const thr = prodThresholds[v.product_id] || { high: 3, mid: 1.5 };
          return `<tr>
          <td class="td-video">
            <div class="vtitle">${v.title === '-' ? 'Video ID: ' + v.vid.slice(-8) : v.title.slice(0,30)}</div>
            <div class="vaccount">${v.account}</div>
          </td>
          <td><span class="${roasClass(v.roas, thr.high, thr.mid)}">${v.roas.toFixed(2)}x</span></td>
          <td><span class="text-muted">${fmtRp(v.cost)}</span></td>
        </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}
