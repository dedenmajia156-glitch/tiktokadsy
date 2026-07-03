// api/topup.js — Vercel Serverless
// Actions: extract (Claude Vision) | notify (Fonnte WA)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};

  // ── Extract dari screenshot via Claude Vision ──
  if (action === 'extract') {
    const { image_base64, mime_type } = req.body;
    if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });

    const CLAUDE_KEY = process.env.CLAUDE_KEY;
    if (!CLAUDE_KEY) return res.status(500).json({ error: 'CLAUDE_KEY not configured' });

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 600,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mime_type || 'image/png', data: image_base64 }
              },
              {
                type: 'text',
                text: `Kamu adalah data extractor untuk screenshot TikTok GMV Max Ads / TikTok Seller Center.
Extract data dari gambar ini dan return HANYA valid JSON (tanpa markdown, tanpa penjelasan):
{
  "shop_name": "nama toko",
  "period": "tanggal/periode tampil di screenshot (e.g. 3 Jul 2026 atau 2026-07-03)",
  "cost": 2126,
  "sku_orders": 1,
  "gross_revenue": 127160,
  "roi": 59.81,
  "cost_per_order": 2126
}
Semua angka dalam number (tanpa Rp, tanpa titik/koma pemisah ribuan). Field tidak ditemukan = null.`
              }
            ]
          }]
        })
      });

      const data = await resp.json();
      if (!resp.ok) return res.status(500).json({ error: 'Claude API error', detail: data });

      const text = data.content?.[0]?.text || '{}';
      const match = text.match(/\{[\s\S]*?\}/);
      try {
        const extracted = JSON.parse(match?.[0] || '{}');
        return res.json({ ok: true, data: extracted });
      } catch {
        return res.json({ ok: false, error: 'Gagal parse AI response', raw: text });
      }
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Kirim notif WA via Fonnte ──
  if (action === 'notify') {
    const { wa_targets, message } = req.body;
    if (!wa_targets?.length) return res.json({ ok: true, note: 'No WA targets configured' });

    const FONNTE_TOKEN = process.env.FONNTE_TOKEN;
    if (!FONNTE_TOKEN) return res.status(500).json({ error: 'FONNTE_TOKEN not configured' });

    const results = await Promise.all(
      wa_targets.map(async target => {
        try {
          const r = await fetch('https://api.fonnte.com/send', {
            method: 'POST',
            headers: {
              'Authorization': FONNTE_TOKEN,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ target, message, countryCode: '62' })
          });
          return { target, result: await r.json() };
        } catch (e) {
          return { target, error: e.message };
        }
      })
    );

    return res.json({ ok: true, results });
  }

  return res.status(400).json({ error: 'Invalid action. Use: extract | notify' });
};
