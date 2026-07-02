let profile = null;
let parsedRows = [];
let userProducts = []; // cache produk user

(async () => {
  profile = await initPage('data-iklan', 'Data Iklan');
  await loadFilters();
  await loadData();
  setupFilters();
})();

async function loadFilters() {
  const uid = (await getUser()).id;

  // Load produk user → untuk filter & auto-match saat upload
  let q = db().from('products').select('*').order('nama_produk');
  if (profile?.role !== 'admin') q = q.eq('user_id', uid);
  const { data: prods } = await q;
  userProducts = prods || [];

  // Isi filter produk
  const selProduk = document.getElementById('fil-produk');
  userProducts.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.nama_produk;
    selProduk.appendChild(opt);
  });

  // Isi filter bulan dari data existing
  let qb = db().from('ads_data').select('bulan').order('bulan');
  if (profile?.role !== 'admin') qb = qb.eq('user_id', uid);
  const { data: bd } = await qb;
  const bulanSet = [...new Set((bd || []).map(r => r.bulan).filter(Boolean))];
  const selBulan = document.getElementById('fil-bulan');
  bulanSet.forEach(b => {
    const opt = document.createElement('option');
    opt.value = b; opt.textContent = b;
    selBulan.appendChild(opt);
  });
}

function setupFilters() {
  ['fil-bulan','fil-produk','fil-creative'].forEach(id => {
    document.getElementById(id).addEventListener('change', loadData);
  });
  document.getElementById('fil-search').addEventListener('input', loadData);
}

async function loadData() {
  const uid = (await getUser()).id;
  const bulan    = document.getElementById('fil-bulan').value;
  const produkId = document.getElementById('fil-produk').value;
  const creative = document.getElementById('fil-creative').value;
  const search   = document.getElementById('fil-search').value.toLowerCase();

  let q = db().from('ads_data')
    .select('*, products(nama_produk)')
    .order('gross_revenue', { ascending: false });

  if (profile?.role !== 'admin') q = q.eq('user_id', uid);
  if (bulan) q = q.eq('bulan', bulan);
  if (produkId) q = q.eq('product_id', produkId);
  if (creative) q = q.eq('creative_type', creative);

  const { data, error } = await q;
  if (error) { showToast('Gagal load data', 'error'); return; }

  let rows = data || [];
  if (search) {
    rows = rows.filter(r =>
      (r.video_title || '').toLowerCase().includes(search) ||
      (r.tiktok_account || '').toLowerCase().includes(search) ||
      (r.campaign_name || '').toLowerCase().includes(search)
    );
  }

  document.getElementById('data-count').textContent = `${rows.length} data iklan`;
  document.getElementById('btn-hapus-filter').style.display = bulan ? 'inline-flex' : 'none';
  renderTable(rows);
}

function renderTable(rows) {
  const el = document.getElementById('data-table');
  if (!rows.length) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📭</div><h3>Tidak ada data</h3><p>Upload data iklan dari TikTok Seller Center</p></div>';
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Produk</th>
            <th>Bulan</th>
            <th>Campaign</th>
            <th>Video / Akun</th>
            <th>Creative</th>
            <th>Status</th>
            <th class="text-right">Cost</th>
            <th class="text-right">Revenue</th>
            <th class="text-right">ROAS</th>
            <th class="text-right">Orders</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => {
            const roas = r.cost > 0 ? r.gross_revenue / r.cost : 0;
            const roasTxt = r.cost > 0 ? roas.toFixed(2) + 'x' : '-';
            return `
            <tr>
              <td><span class="badge badge-purple">${r.products?.nama_produk || '—'}</span></td>
              <td class="text-muted">${r.bulan || '-'}</td>
              <td style="font-size:12px">${r.campaign_name || '-'}</td>
              <td class="td-video">
                <div class="vtitle">${r.video_title && r.video_title !== '-' ? r.video_title.slice(0,40) : (r.video_id || '-')}</div>
                <div class="vaccount">${r.tiktok_account || '-'}</div>
              </td>
              <td><span class="badge ${r.creative_type === 'Video' ? 'badge-blue' : 'badge-gray'}">${r.creative_type || '-'}</span></td>
              <td style="font-size:12px">${r.status || '-'}</td>
              <td class="text-right num">${fmtRp(r.cost)}</td>
              <td class="text-right num">${fmtRp(r.gross_revenue)}</td>
              <td class="text-right"><span class="${roasClass(roas)} num">${roasTxt}</span></td>
              <td class="text-right">${r.orders || 0}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ============ UPLOAD ============
function openUploadModal() {
  document.getElementById('modal-upload').classList.add('open');
  document.getElementById('upload-err').style.display = 'none';
  document.getElementById('preview-info').style.display = 'none';
  document.getElementById('btn-upload').disabled = true;
  document.getElementById('file-input').value = '';
  parsedRows = [];
}

function closeUpload() {
  document.getElementById('modal-upload').classList.remove('open');
}

document.addEventListener('DOMContentLoaded', () => {
  const area = document.getElementById('upload-area');
  area.addEventListener('dragover', e => { e.preventDefault(); area.classList.add('dragover'); });
  area.addEventListener('dragleave', () => area.classList.remove('dragover'));
  area.addEventListener('drop', e => {
    e.preventDefault();
    area.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
});

function handleFile(file) {
  if (!file) return;
  const errEl = document.getElementById('upload-err');
  errEl.style.display = 'none';
  document.getElementById('preview-info').style.display = 'none';
  document.getElementById('btn-upload').disabled = true;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'binary' });

      // Cari sheet dengan kolom yang relevan
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

      if (!ws) { showErr(errEl, 'Tidak menemukan data yang valid. Pastikan file dari TikTok Seller Center.'); return; }

      parsedRows = parseExcelRows(ws);
      if (!parsedRows.length) { showErr(errEl, 'Tidak ada baris data yang bisa diproses.'); return; }

      // Hitung ringkasan: bulan & produk yang terdeteksi
      const bulanSet = [...new Set(parsedRows.map(r => r.bulan).filter(Boolean))];
      const prodIdSet = [...new Set(parsedRows.map(r => r.product_id_raw).filter(Boolean))];

      // Cek apakah product ID ada di produk user
      const matched = prodIdSet.filter(pid =>
        userProducts.some(p => p.product_id_tiktok === pid)
      );
      const unmatched = prodIdSet.filter(pid =>
        !userProducts.some(p => p.product_id_tiktok === pid)
      );

      let previewHTML = `
        ✅ <strong>${parsedRows.length} baris</strong> siap diupload<br>
        <span class="text-muted" style="font-size:12px">
          📅 Bulan: ${bulanSet.join(', ') || '-'}<br>
          📦 Product ID terdeteksi: ${prodIdSet.length} produk
          ${matched.length ? ` (${matched.length} cocok)` : ''}
        </span>`;

      if (unmatched.length) {
        previewHTML += `<br><span style="color:#f59e0b;font-size:12px">
          ⚠️ ${unmatched.length} Product ID belum terdaftar di menu Produk — data tetap masuk tapi tanpa info produk.
        </span>`;
      }

      document.getElementById('preview-text').innerHTML = previewHTML;
      document.getElementById('preview-info').style.display = 'block';
      document.getElementById('btn-upload').disabled = false;

    } catch(err) {
      showErr(errEl, 'Gagal baca file: ' + err.message);
    }
  };
  reader.readAsBinaryString(file);
}

function parseExcelRows(json) {
  const rawHeaders = json[0] || [];
  const headers = rawHeaders.map(h => String(h).toLowerCase().trim());

  const map = {
    bulan:          ['bulan'],
    campaign_name:  ['campaign name', 'nama kampanye'],
    campaign_id:    ['campaign id', 'id campaign'],
    product_id_raw: ['product id', 'id produk'],
    creative_type:  ['creative type', 'jenis materi iklan'],
    video_title:    ['video title', 'judul video'],
    video_id:       ['video id', 'id video'],
    tiktok_account: ['titkok account', 'tiktok account', 'akun tiktok'],
    status:         ['status'],
    cost:           ['cost', 'biaya'],
    orders:         ['orders (sku)', 'orders', 'pesanan sku'],
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

    const cost    = parseFloat(String(row[idx.cost] || '0').replace(/[^0-9.]/g,'')) || 0;
    const revenue = parseFloat(String(row[idx.gross_revenue] || '0').replace(/[^0-9.]/g,'')) || 0;

    // Bulan: bisa string "Juli 2026" atau Excel date number
    let bulan = idx.bulan >= 0 ? String(row[idx.bulan] || '').trim() : '';
    if (bulan && /^\d+(\.\d+)?$/.test(bulan)) {
      // Excel date serial → convert
      const d = new Date(Math.round((parseFloat(bulan) - 25569) * 86400 * 1000));
      const bulanNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
      bulan = `${bulanNames[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    }

    rows.push({
      bulan,
      campaign_name:  idx.campaign_name >= 0  ? String(row[idx.campaign_name] || '').trim() : '',
      campaign_id:    idx.campaign_id >= 0     ? String(row[idx.campaign_id] || '').trim() : '',
      product_id_raw: idx.product_id_raw >= 0  ? String(row[idx.product_id_raw] || '').trim() : '',
      creative_type:  idx.creative_type >= 0   ? String(row[idx.creative_type] || '').trim() : '',
      video_title:    idx.video_title >= 0     ? String(row[idx.video_title] || '').trim() : '',
      video_id:       idx.video_id >= 0        ? String(row[idx.video_id] || '').trim() : '',
      tiktok_account: idx.tiktok_account >= 0  ? String(row[idx.tiktok_account] || '').trim() : '',
      status:         idx.status >= 0          ? String(row[idx.status] || '').trim() : '',
      cost,
      orders:         parseInt(String(row[idx.orders] || '0')) || 0,
      gross_revenue:  revenue,
    });
  }

  return rows;
}

async function doUpload() {
  const errEl = document.getElementById('upload-err');
  const btn   = document.getElementById('btn-upload');
  errEl.style.display = 'none';

  if (!parsedRows.length) { showErr(errEl, 'Belum ada file yang diparsing.'); return; }

  btn.disabled = true; btn.textContent = 'Mengupload...';

  const uid = (await getUser()).id;

  // Buat lookup: product_id_tiktok → product UUID
  const produkMap = {};
  userProducts.forEach(p => { produkMap[p.product_id_tiktok] = p.id; });

  // Group rows by bulan → hapus data lama per bulan
  const bulanSet = [...new Set(parsedRows.map(r => r.bulan).filter(Boolean))];
  for (const bulan of bulanSet) {
    await db().from('ads_data').delete().eq('bulan', bulan).eq('user_id', uid);
  }

  // Map rows ke format DB, auto-assign product_id dari product_id_raw
  const now = new Date().toISOString();
  const batch = parsedRows.map(r => ({
    user_id:        uid,
    product_id:     produkMap[r.product_id_raw] || null,
    bulan:          r.bulan,
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
    upload_date:    now.split('T')[0],
    uploaded_at:    now,
  }));

  const CHUNK = 500;
  let errMsg = null;
  for (let i = 0; i < batch.length; i += CHUNK) {
    const { error } = await db().from('ads_data').insert(batch.slice(i, i + CHUNK));
    if (error) { errMsg = error.message; break; }
  }

  btn.disabled = false; btn.textContent = 'Upload Data';
  if (errMsg) { showErr(errEl, 'Gagal upload: ' + errMsg); return; }

  showToast(`${parsedRows.length} data berhasil diupload!`, 'success');
  closeUpload();

  // Refresh filter bulan
  const selBulan = document.getElementById('fil-bulan');
  bulanSet.forEach(b => {
    if (![...selBulan.options].some(o => o.value === b)) {
      const opt = document.createElement('option');
      opt.value = b; opt.textContent = b;
      selBulan.appendChild(opt);
    }
  });

  await loadData();
}

async function hapusDataFilter() {
  const bulan    = document.getElementById('fil-bulan').value;
  const produkId = document.getElementById('fil-produk').value;
  if (!bulan) return;
  if (!confirm(`Hapus semua data bulan "${bulan}"${produkId ? ' untuk produk ini' : ''}?`)) return;

  const uid = (await getUser()).id;
  let q = db().from('ads_data').delete().eq('bulan', bulan).eq('user_id', uid);
  if (produkId) q = q.eq('product_id', produkId);
  const { error } = await q;
  if (error) { showToast('Gagal hapus: ' + error.message, 'error'); return; }
  showToast('Data dihapus.', 'success');
  await loadData();
}
