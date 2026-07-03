// api/approve.js — One-click approve top up request
// GET /api/approve?id=xxx&token=yyy

module.exports = async (req, res) => {
  const { id, token } = req.query;

  const html = (icon, title, msg, color) => `<!DOCTYPE html>
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

  if (!id || !token) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(html('⚠️', 'Link Tidak Valid', 'Parameter tidak lengkap.', '#ef4444'));
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(html('⚠️', 'Konfigurasi Error', 'SUPABASE_SERVICE_KEY belum diset di Vercel.', '#ef4444'));
  }

  try {
    const sbHeaders = { 'apikey': SERVICE_KEY, 'Authorization': `Bearer ${SERVICE_KEY}` };
    const fmtNum = n => Number(n).toLocaleString('id-ID');

    // 1. Cek request: id + token harus cocok
    const checkResp = await fetch(
      `${SUPABASE_URL}/rest/v1/topup_requests?id=eq.${id}&approve_token=eq.${token}&select=id,status,user_name,user_id,nominal`,
      { headers: sbHeaders }
    );
    const rows = await checkResp.json();

    if (!rows?.length) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(404).send(html('🔗', 'Link Tidak Valid', 'Request tidak ditemukan atau token salah.', '#ef4444'));
    }

    const req_data = rows[0];

    if (req_data.status === 'approved') {
      res.setHeader('Content-Type', 'text/html');
      return res.send(html('✅', 'Sudah Disetujui', `Request top up dari <strong>${req_data.user_name}</strong> sudah pernah disetujui sebelumnya.`, '#10b981'));
    }

    if (req_data.status === 'rejected') {
      res.setHeader('Content-Type', 'text/html');
      return res.send(html('❌', 'Sudah Ditolak', 'Request ini sebelumnya sudah ditolak.', '#ef4444'));
    }

    // 2. Approve
    const updateResp = await fetch(
      `${SUPABASE_URL}/rest/v1/topup_requests?id=eq.${id}&approve_token=eq.${token}`,
      {
        method: 'PATCH',
        headers: { ...sbHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({ status: 'approved', updated_at: new Date().toISOString() })
      }
    );

    if (!updateResp.ok) throw new Error('Gagal update status');

    // 3. In-app notification untuk advertiser
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

    // 4. Ambil nomor WA advertiser dari profiles
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
          // Format nomor: 08xxx → 628xxx
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
      } catch (_) { /* notif gagal tidak block approve */ }
    }

    res.setHeader('Content-Type', 'text/html');
    return res.send(html(
      '✅',
      'Request Disetujui!',
      `Top up <strong>Rp ${fmtNum(req_data.nominal)}</strong> dari <strong>${req_data.user_name}</strong> berhasil disetujui. Notifikasi sudah dikirim ke advertiser.`,
      '#10b981'
    ));

  } catch (e) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(html('⚠️', 'Terjadi Error', e.message, '#ef4444'));
  }
};
