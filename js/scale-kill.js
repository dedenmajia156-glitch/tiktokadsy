let profile = null;
let currentTab = 'perlu-dicek';
let selectedDecisionId = null;
let allDecisions = [];

(async () => {
  profile = await initPage('scale-kill', 'Scale / Kill');
  await loadDecisions();
})();

window.addEventListener('advertiserSwitch', () => loadDecisions());

async function getTargetUid() {
  const uid = (await getUser()).id;
  return window.__activeAdvertiser || uid;
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  renderDecisions();
}

async function loadDecisions() {
  const uid = await getTargetUid();

  let q = db().from('video_decisions')
    .select('*, ads_data!inner(video_title, tiktok_account, cost, gross_revenue, bulan, products(nama_produk))')
    .order('created_at', { ascending: false });

  if (profile?.role !== 'admin' || window.__activeAdvertiser) q = q.eq('user_id', uid);

  const { data, error } = await q;

  // Jika inner join gagal (karena tidak ada ads_data terkait), coba tanpa join
  if (error) {
    let q2 = db().from('video_decisions')
      .select('*')
      .order('created_at', { ascending: false });
    if (profile?.role !== 'admin' || window.__activeAdvertiser) q2 = q2.eq('user_id', uid);
    const { data: d2 } = await q2;
    allDecisions = d2 || [];
  } else {
    allDecisions = data || [];
  }

  // Badge perlu dicek
  const perluDicek = allDecisions.filter(d => d.keputusan === 'scale' && !d.hasil).length;
  const badge = document.getElementById('badge-cek');
  if (badge) badge.textContent = perluDicek;

  renderDecisions();
}

function renderDecisions() {
  let list = [...allDecisions];

  if (currentTab === 'perlu-dicek') {
    list = list.filter(d => d.keputusan === 'scale' && !d.hasil);
  } else if (currentTab !== 'semua') {
    list = list.filter(d => d.keputusan === currentTab);
  }

  const el = document.getElementById('sk-content');

  if (!list.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="icon">${currentTab === 'perlu-dicek' ? '✅' : '📭'}</div>
      <h3>${currentTab === 'perlu-dicek' ? 'Tidak ada yang perlu dicek' : 'Belum ada data'}</h3>
      <p>${currentTab === 'perlu-dicek' ? 'Semua video sudah dievaluasi' : 'Buat keputusan dari halaman Video Tracker'}</p>
    </div>`;
    return;
  }

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      ${list.map(d => renderDecisionCard(d)).join('')}
    </div>`;
}

function renderDecisionCard(d) {
  const jam = Math.round((Date.now() - new Date(d.waktu_mulai)) / 3600000);
  const vTitle = d.ads_data?.video_title || d.video_id?.slice(-12) || '-';
  const vAcct  = d.ads_data?.tiktok_account || '-';
  const produk = d.ads_data?.products?.nama_produk || '-';
  const bulan  = d.ads_data?.bulan || '-';
  const cost   = Number(d.ads_data?.cost || 0);
  const rev    = Number(d.ads_data?.gross_revenue || 0);
  const roas   = cost > 0 ? rev / cost : 0;

  const needCheck = d.keputusan === 'scale' && !d.hasil;

  const hasilBadge = d.hasil
    ? `<span class="badge ${d.hasil === 'naik' ? 'badge-green' : d.hasil === 'turun' ? 'badge-red' : 'badge-orange'}">
        ${d.hasil === 'naik' ? '📈 Naik' : d.hasil === 'turun' ? '📉 Turun' : '➡ Flat'}
      </span>`
    : (d.keputusan === 'scale' ? '<span class="badge badge-orange">⏳ Belum dievaluasi</span>' : '');

  return `
    <div class="decision-card ${d.keputusan}" style="${needCheck ? 'box-shadow:0 0 0 2px #f59e0b;' : ''}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
            <span class="badge badge-${d.keputusan}">${d.keputusan === 'scale' ? '⬆ Scale' : d.keputusan === 'kill' ? '❌ Kill' : '👁 Monitor'}</span>
            <span class="badge badge-purple" style="font-size:10px">${produk}</span>
            ${hasilBadge}
            ${d.keputusan_lanjut ? `<span class="badge badge-blue">→ ${d.keputusan_lanjut}</span>` : ''}
          </div>
          <div class="dc-title">${vTitle.slice(0, 60)}</div>
          <div class="dc-meta">${vAcct} • ${bulan} • ${jam}j lalu</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div class="fw-700 ${roasClass(roas)}">${roas > 0 ? roas.toFixed(2) + 'x' : '-'}</div>
          <div style="font-size:11px;color:#94a3b8">ROAS</div>
        </div>
      </div>

      <div class="dc-stats" style="margin-top:10px">
        <div class="dc-stat">
          <div class="ds-val">${fmtRp(cost)}</div>
          <div class="ds-label">Spend</div>
        </div>
        <div class="dc-stat">
          <div class="ds-val">${fmtRp(rev)}</div>
          <div class="ds-label">Revenue</div>
        </div>
        ${d.catatan ? `<div class="dc-stat" style="flex:1">
          <div class="ds-val" style="font-size:12px;font-weight:500;color:#64748b">${d.catatan}</div>
          <div class="ds-label">Catatan</div>
        </div>` : ''}
      </div>

      ${d.hasil_catatan ? `<div style="font-size:12px;color:#64748b;margin-top:6px;padding-top:8px;border-top:1px solid #e2e8f0">📝 ${d.hasil_catatan}</div>` : ''}

      <div class="dc-actions" style="margin-top:12px">
        ${needCheck
          ? `<button class="btn btn-primary-sm btn-sm" onclick="openHasilModal('${d.id}')">📊 Isi Hasil</button>`
          : ''
        }
        <button class="btn btn-danger btn-sm" onclick="deleteDecision('${d.id}')">Hapus</button>
      </div>
    </div>`;
}

// ============ HASIL MODAL ============
function openHasilModal(id) {
  selectedDecisionId = id;
  const d = allDecisions.find(x => x.id === id);
  if (!d) return;

  const vTitle = d.ads_data?.video_title || d.video_id?.slice(-12) || '-';
  const jam = Math.round((Date.now() - new Date(d.waktu_mulai)) / 3600000);
  const cost = Number(d.ads_data?.cost || 0);
  const rev  = Number(d.ads_data?.gross_revenue || 0);
  const roas = cost > 0 ? rev / cost : 0;

  document.getElementById('modal-hasil-info').innerHTML = `
    <div style="font-weight:600;margin-bottom:6px">${vTitle.slice(0,50)}</div>
    <div style="display:flex;gap:20px;flex-wrap:wrap">
      <div><span class="fw-600">${jam}j</span> <span class="text-muted">sejak di-scale</span></div>
      <div><span class="fw-600 ${roasClass(roas)}">${roas > 0 ? roas.toFixed(2) + 'x' : '-'}</span> <span class="text-muted">ROAS</span></div>
      <div><span class="fw-600">${fmtRp(cost)}</span> <span class="text-muted">spend</span></div>
      <div><span class="fw-600">${fmtRp(rev)}</span> <span class="text-muted">revenue</span></div>
    </div>`;

  document.getElementById('hasil-value').value = '';
  document.getElementById('hasil-lanjut-value').value = '';
  document.getElementById('hasil-note').value = '';
  document.getElementById('hasil-err').style.display = 'none';

  ['naik','turun','flat'].forEach(h =>
    document.getElementById('h-'+h).style.outline = 'none');
  ['scale','kill','monitor'].forEach(h =>
    document.getElementById('hl-'+h).style.outline = 'none');

  document.getElementById('modal-hasil').classList.add('open');
}

function closeHasilModal() {
  document.getElementById('modal-hasil').classList.remove('open');
  selectedDecisionId = null;
}

function setHasil(val) {
  document.getElementById('hasil-value').value = val;
  ['naik','turun','flat'].forEach(h =>
    document.getElementById('h-'+h).style.outline = h === val ? '2px solid #6366f1' : 'none');
}

function setHasilLanjut(val) {
  document.getElementById('hasil-lanjut-value').value = val;
  ['scale','kill','monitor'].forEach(h =>
    document.getElementById('hl-'+h).style.outline = h === val ? '2px solid #6366f1' : 'none');
}

async function saveHasil() {
  const hasil       = document.getElementById('hasil-value').value;
  const lanjut      = document.getElementById('hasil-lanjut-value').value;
  const catatan     = document.getElementById('hasil-note').value.trim();
  const errEl       = document.getElementById('hasil-err');

  errEl.style.display = 'none';
  if (!hasil) { showErr(errEl, 'Pilih hasil terlebih dahulu.'); return; }
  if (!lanjut) { showErr(errEl, 'Pilih keputusan lanjut.'); return; }

  const { error } = await db().from('video_decisions').update({
    hasil,
    keputusan_lanjut: lanjut,
    hasil_catatan: catatan || null,
    hasil_at: new Date().toISOString(),
  }).eq('id', selectedDecisionId);

  if (error) { showErr(errEl, error.message); return; }

  showToast('Hasil disimpan!', 'success');
  closeHasilModal();
  await loadDecisions();
}

async function deleteDecision(id) {
  if (!confirm('Hapus keputusan ini?')) return;
  const { error } = await db().from('video_decisions').delete().eq('id', id);
  if (error) { showToast('Gagal hapus: ' + error.message, 'error'); return; }
  showToast('Keputusan dihapus.', 'success');
  await loadDecisions();
}
