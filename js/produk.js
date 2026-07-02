let profile = null;
let editId = null;

(async () => {
  profile = await initPage('produk', 'Produk');
  await loadProduk();
})();

async function loadProduk() {
  const uid = (await getUser()).id;
  let q = db().from('products').select('*').order('created_at', { ascending: false });
  if (profile?.role !== 'admin') q = q.eq('user_id', uid);

  const { data, error } = await q;
  const el = document.getElementById('produk-list');

  if (error || !data?.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="icon">📦</div>
        <h3>Belum ada produk</h3>
        <p>Tambahkan produk TikTok kamu terlebih dahulu sebelum input data iklan</p>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Nama Produk</th>
            <th>Product ID TikTok</th>
            <th>Keterangan</th>
            <th>ROAS Target</th>
            <th>Dibuat</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          ${data.map((p, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><strong>${p.nama_produk}</strong></td>
              <td><code style="font-size:11px;background:#f1f5f9;padding:3px 8px;border-radius:5px">${p.product_id_tiktok}</code></td>
              <td class="text-muted">${p.keterangan || '-'}</td>
              <td style="white-space:nowrap">
                <span class="badge badge-green" style="font-size:10px">≥${p.roas_high ?? 3}x</span>
                <span class="badge badge-gray" style="font-size:10px;margin-left:4px">≥${p.roas_mid ?? 1.5}x</span>
              </td>
              <td class="text-muted">${new Date(p.created_at).toLocaleDateString('id-ID')}</td>
              <td>
                <div style="display:flex;gap:6px">
                  <button class="btn btn-outline btn-sm" onclick="openModal('${p.id}')">Edit</button>
                  <button class="btn btn-danger btn-sm" onclick="deleteProduk('${p.id}', '${p.nama_produk.replace(/'/g,"\\'")}')">Hapus</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;
}

async function openModal(id = null) {
  editId = id;
  document.getElementById('modal-err').style.display = 'none';
  document.getElementById('modal-produk-title').textContent = id ? 'Edit Produk' : 'Tambah Produk';

  if (id) {
    const { data } = await db().from('products').select('*').eq('id', id).single();
    document.getElementById('p-nama').value = data.nama_produk || '';
    document.getElementById('p-prodid').value = data.product_id_tiktok || '';
    document.getElementById('p-ket').value = data.keterangan || '';
    document.getElementById('p-roas-high').value = data.roas_high ?? 3;
    document.getElementById('p-roas-mid').value = data.roas_mid ?? 1.5;
  } else {
    document.getElementById('p-nama').value = '';
    document.getElementById('p-prodid').value = '';
    document.getElementById('p-ket').value = '';
    document.getElementById('p-roas-high').value = '';
    document.getElementById('p-roas-mid').value = '';
  }

  document.getElementById('modal-produk').classList.add('open');
}

function closeModal() {
  document.getElementById('modal-produk').classList.remove('open');
  editId = null;
}

async function saveProduk() {
  const nama     = document.getElementById('p-nama').value.trim();
  const prodid   = document.getElementById('p-prodid').value.trim();
  const ket      = document.getElementById('p-ket').value.trim();
  const roasHigh = parseFloat(document.getElementById('p-roas-high').value) || 3;
  const roasMid  = parseFloat(document.getElementById('p-roas-mid').value) || 1.5;
  const errEl    = document.getElementById('modal-err');
  const btn      = document.getElementById('btn-save-produk');

  errEl.style.display = 'none';
  if (!nama || !prodid) { showErr(errEl, 'Nama produk dan Product ID wajib diisi.'); return; }

  btn.disabled = true; btn.textContent = 'Menyimpan...';

  const uid = (await getUser()).id;
  const payload = { nama_produk: nama, product_id_tiktok: prodid, keterangan: ket, roas_high: roasHigh, roas_mid: roasMid, user_id: uid };

  let error;
  if (editId) {
    ({ error } = await db().from('products').update(payload).eq('id', editId));
  } else {
    ({ error } = await db().from('products').insert(payload));
  }

  btn.disabled = false; btn.textContent = 'Simpan';

  if (error) { showErr(errEl, error.message); return; }

  // Ambil product UUID berdasarkan product_id_tiktok (cover insert & edit)
  const { data: prod } = await db().from('products')
    .select('id')
    .eq('product_id_tiktok', prodid)
    .eq('user_id', uid)
    .single();

  if (prod?.id) {
    await db().from('ads_data')
      .update({ product_id: prod.id })
      .eq('product_id_raw', prodid)
      .eq('user_id', uid);
  }

  showToast(editId ? 'Produk diperbarui!' : 'Produk ditambahkan!', 'success');
  closeModal();
  await loadProduk();
}

async function syncDataIklan() {
  const btn = document.getElementById('btn-sync');
  btn.disabled = true; btn.textContent = '⏳ Sync...';

  const uid = (await getUser()).id;

  // Ambil semua produk user
  let q = db().from('products').select('id, product_id_tiktok');
  if (profile?.role !== 'admin') q = q.eq('user_id', uid);
  const { data: prods, error } = await q;

  if (error || !prods?.length) {
    showToast('Tidak ada produk untuk di-sync.', 'error');
    btn.disabled = false; btn.textContent = '🔄 Sync Data Iklan';
    return;
  }

  // Update ads_data: cocokkan product_id_raw → product_id
  let hasError = false;
  for (const p of prods) {
    const { error: updErr } = await db().from('ads_data')
      .update({ product_id: p.id })
      .eq('product_id_raw', p.product_id_tiktok)
      .eq('user_id', uid);
    if (updErr) { hasError = true; }
  }

  btn.disabled = false; btn.textContent = '🔄 Sync Data Iklan';
  if (hasError) {
    showToast('Sync selesai dengan beberapa error.', 'error');
  } else {
    showToast(`Sync selesai — ${prods.length} produk disinkronisasi ke data iklan.`, 'success');
  }
}

async function deleteProduk(id, nama) {
  if (!confirm(`Hapus produk "${nama}"? Data iklan terkait juga akan hilang.`)) return;
  const { error } = await db().from('products').delete().eq('id', id);
  if (error) { showToast('Gagal hapus: ' + error.message, 'error'); return; }
  showToast('Produk dihapus.', 'success');
  await loadProduk();
}
