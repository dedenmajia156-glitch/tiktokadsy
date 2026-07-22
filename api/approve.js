// api/approve.js — One-click approve top up request
// GET  /api/approve?id=xxx&token=yyy        → halaman konfirmasi (aman dari WA preview)
// POST /api/approve?id=xxx&token=yyy        → eksekusi approve

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id, token } = req.query;

  const htmlResult = (icon, title, msg, color) => `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f5f6fa; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; }
  .card { background:#fff; border-radius:20px; padding:40px 32px; text-align:center; max-width:360px; width:100%; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
  .icon { font-size:56px; margin-bottom:16px; }
  h1 { font-size:20px; font-weight:700; color:${color}; margin-bottom:8px; }
  p { font-size:14px; color:#64748b; line-height:1.6; }
  .sub { font-size:12px; color:#94a3b8; margin-top:16px; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${msg}</p>
    <div class="sub">Kamu bisa tutup halaman ini.</div>
  </div>
</body>
</html>`;

  const htmlConfirm = (userName, nominal) => `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Konfirmasi Approve Top Up</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f5f6fa; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:20px; }
  .card { background:#fff; border-radius:20px; padding:40px 32px; text-align:center; max-width:380px; width:100%; box-shadow:0 4px 24px rgba(0,0,0,0.08); }
  .icon { font-size:56px; margin-bottom:16px; }
  h1 { font-size:20px; font-weight:700; color:#1e293b; margin-bottom:8px; }
  .info { background:#f8fafc; border-radius:12px; padding:16px; margin:20px 0; text-align:left; }
  .info-row { display:flex; justify-content:space-between; font-size:14px; padding:4px 0; }
  .info-row .label { color:#64748b; }
  .info-row .value { font-weight:600; color:#1e293b; }
  .btn-approve {
    width:100%; padding:14px; border:none; border-radius:12px;
    background:#10b981; color:#fff; font-size:15px; font-weight:700;
    cursor:pointer; margin-top:4px; font-family:inherit;
    transition:background .2s;
  }
  .btn-approve:hover { background:#059669; }
  .btn-approve:disabled { background:#94a3b8; cursor:not-allowed; }
  .sub { font-size:12px; color:#94a3b8; margin-top:16px; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon">💳</div>
    <h1>Konfirmasi Approve Top Up</h1>
    <div class="info">
      <div class="info-row"><span class="label">Advertiser</span><span class="value">${userName}</span></div>
      <div class="info-row"><span class="label">Nominal</span><span class="value">Rp ${nominal}</span></div>
    </div>
    <form method="POST" action="/api/approve?id=${id}&token=${token}" onsubmit="handleSubmit(event)">
      <button type="submit" class="btn-approve" id="btn-approve">✅ Approve Sekarang</button>
    </form>
    <div class="sub">Pastikan data sudah benar sebelum approve.</div>
  </div>
  <script>
    function handleSubmit(e) {
      const btn = document.getElementById('btn-approve');
      btn.disabled = true;
      btn.textContent = 'Memproses...';
    }
  </script>
</body>
</html>`;

  if (!id || !token) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(htmlResult('⚠️', 'Link Tidak Valid', 'Parameter tidak lengkap.', '#ef4444'));
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(htmlResult('⚠️', 'Konfigurasi Error', 'SUPABASE_SERVICE_KEY belum diset di Vercel.', '#ef4444'));
  }

  const sbHeaders = { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` };
  const fmtNum = n => Number(n).toLocaleString('id-ID');

  // Cek request dulu (untuk GET maupun POST)
  const checkResp = await fetch(
    `${SUPABASE_URL}/rest/v1/topup_requests?id=eq.${id}&approve_token=eq.${token}&select=id,status,user_name,user_id,nominal`,
    { headers: sbHeaders }
  );
  const rows = await checkResp.json();

  if (!rows?.length) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(404).send(htmlResult('🔗', 'Link Tidak Valid', 'Request tidak ditemukan atau token salah.', '#ef4444'));
  }

  const req_data = rows[0];

  if (req_data.status === 'approved') {
    res.setHeader('Content-Type', 'text/html');
    return res.send(htmlResult('✅', 'Sudah Disetujui', `Request top up dari <strong>${req_data.user_name}</strong> sudah pernah disetujui sebelumnya.`, '#10b981'));
  }

  if (req_data.status === 'rejected') {
    res.setHeader('Content-Type', 'text/html');
    return res.send(htmlResult('❌', 'Sudah Ditolak', 'Request ini sebelumnya sudah ditolak.', '#ef4444'));
  }

  // ── GET → tampilkan halaman konfirmasi (WA preview berhenti di sini) ──
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html');
    return res.send(htmlConfirm(req_data.user_name, fmtNum(req_data.nominal)));
  }

  // ── POST → eksekusi approve ──
  if (req.method !== 'POST') {
    return res.status(405).send(htmlResult('⚠️', 'Method Tidak Diizinkan', 'Gunakan tombol Approve pada halaman konfirmasi.', '#ef4444'));
  }

  try {
    // 1. Update status
    const updateResp = await fetch(
      `${SUPABASE_URL}/rest/v1/topup_requests?id=eq.${id}&approve_token=eq.${token}`,
      {
        method: 'PATCH',
        headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'approved', updated_at: new Date().toISOString() })
      }
    );

    if (!updateResp.ok) throw new Error('Gagal update status');

    // 2. In-app notification untuk advertiser
    try {
      await fetch(
        `${SUPABASE_URL}/rest/v1/notifications`,
        {
          method: 'POST',
          headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            user_id: req_data.user_id,
            type: 'topup_approved',
            title: 'Top Up Disetujui ✅',
            message: `Request top up Rp ${fmtNum(req_data.nominal)} kamu sudah disetujui!`,
            link: 'topup.html'
          })
        }
      );
    } catch(_) {}

    // 3. Notif WA ke advertiser
    const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
    if (FONNTE_TOKEN && req_data.user_id) {
      try {
        const profResp = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=eq.${req_data.user_id}&select=no_wa,nama`,
          { headers: sbHeaders }
        );
        const profiles = await profResp.json();
        const noWa = profiles?.[0]?.no_wa;

        if (noWa) {
          let target = noWa.replace(/\D/g, '');
          if (target.startsWith('0')) target = '62' + target.slice(1);

          const pesan = [
            `✅ *Top Up Disetujui!*`,
            ``,
            `Halo *${req_data.user_name}*,`,
            `Request top up kamu sebesar *Rp ${fmtNum(req_data.nominal)}* sudah disetujui.`,
            ``,
            `Silakan cek budget TikTok Ads kamu.`,
            `_${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}_`
          ].join('\n');

          await fetch('https://api.fonnte.com/send', {
            method: 'POST',
            headers: { 'Authorization': FONNTE_TOKEN, 'Content-Type': 'application/json' },
            body: JSON.stringify({ target, message: pesan, countryCode: '62' })
          });
        }
      } catch (_) {}
    }

    res.setHeader('Content-Type', 'text/html');
    return res.send(htmlResult(
      '✅',
      'Request Disetujui!',
      `Top up <strong>Rp ${fmtNum(req_data.nominal)}</strong> dari <strong>${req_data.user_name}</strong> berhasil disetujui. Notifikasi sudah dikirim ke advertiser.`,
      '#10b981'
    ));

  } catch (e) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(htmlResult('⚠️', 'Terjadi Error', e.message, '#ef4444'));
  }
};
