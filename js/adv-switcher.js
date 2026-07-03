/**
 * adv-switcher.js — Advertiser switcher sidebar (admin only)
 * Compact dropdown untuk admin pilih advertiser
 */
(function () {

  // ── CSS ──────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
.adv-switcher { padding: 4px 12px 12px; }

.adv-sw-trigger {
  display: flex; align-items: center; gap: 9px;
  padding: 9px 12px; border-radius: 10px;
  border: 1.5px solid #e2e8f0; cursor: pointer;
  transition: all .15s; background: #f8fafc;
  user-select: none;
}
.adv-sw-trigger:hover { border-color: var(--primary); background: #eef2ff; }
.adv-sw-trigger.open { border-color: var(--primary); background: #eef2ff; }

.adv-sw-av {
  width: 28px; height: 28px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 800; color: #fff;
  flex-shrink: 0; letter-spacing: -.5px;
}
.adv-sw-av.all { background: #e2e8f0; font-size: 14px; }

.adv-sw-info { flex: 1; min-width: 0; }
.adv-sw-name {
  font-size: 12px; font-weight: 700; color: #1e293b;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.adv-sw-sub { font-size: 10px; color: #94a3b8; margin-top: 1px; }

.adv-sw-arrow { font-size: 10px; color: #94a3b8; transition: transform .15s; flex-shrink: 0; }
.adv-sw-trigger.open .adv-sw-arrow { transform: rotate(180deg); }

.adv-sw-label {
  font-size: 10px; font-weight: 700; color: #94a3b8;
  letter-spacing: .06em; text-transform: uppercase;
  padding: 0 12px 4px; margin-top: 2px;
}

/* Dropdown */
.adv-sw-dropdown {
  position: fixed; z-index: 999;
  background: #fff; border: 1.5px solid #e2e8f0;
  border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.12);
  min-width: 200px; overflow: hidden;
  animation: advDrop .12s ease;
}
@keyframes advDrop { from { opacity:0; transform:translateY(-4px) } to { opacity:1; transform:translateY(0) } }

.adv-sw-opt {
  display: flex; align-items: center; gap: 9px;
  padding: 9px 12px; cursor: pointer; transition: background .1s;
}
.adv-sw-opt:hover { background: #f8fafc; }
.adv-sw-opt.active { background: #eef2ff; }

.adv-sw-opt-av {
  width: 30px; height: 30px; border-radius: 7px;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 800; color: #fff; flex-shrink: 0;
}
.adv-sw-opt-av.all { background: #e2e8f0; font-size: 14px; }

.adv-sw-opt-info { flex: 1; min-width: 0; }
.adv-sw-opt-name {
  font-size: 12px; font-weight: 600; color: #1e293b;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.adv-sw-opt-sub { font-size: 10px; color: #94a3b8; margin-top: 1px; }
.adv-sw-opt-check { font-size: 12px; color: var(--primary); flex-shrink: 0; }
.adv-sw-divider { height: 1px; background: #f1f5f9; margin: 3px 0; }
  `;
  document.head.appendChild(style);

  // ── State ─────────────────────────────────────────────────
  const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#06b6d4','#8b5cf6','#f97316','#ec4899'];
  let allAdvertisers = [];
  let activeAdv = sessionStorage.getItem('adv_active') || null;
  if (activeAdv === 'null') activeAdv = null;
  let dropOpen = false;

  // ── Helpers ───────────────────────────────────────────────
  function initials(nama) {
    return (nama || '?').split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
  }

  function getActive() {
    if (!activeAdv) return null;
    return allAdvertisers.find(a => a.id === activeAdv) || null;
  }

  // ── Inject ke sidebar ─────────────────────────────────────
  function injectEl() {
    if (document.getElementById('adv-sw-root')) return;
    const nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    const label = document.createElement('div');
    label.className = 'adv-sw-label';
    label.textContent = 'Advertiser';
    const el = document.createElement('div');
    el.id = 'adv-sw-root';
    el.className = 'adv-switcher';
    nav.insertAdjacentElement('beforebegin', label);
    label.insertAdjacentElement('afterend', el);
  }

  // ── Render trigger ────────────────────────────────────────
  function render() {
    const el = document.getElementById('adv-sw-root');
    if (!el) return;

    const active = getActive();
    const idx    = active ? allAdvertisers.indexOf(active) : -1;
    const color  = idx >= 0 ? COLORS[idx % COLORS.length] : null;

    const avHtml = active
      ? `<div class="adv-sw-av" style="background:${color}">${initials(active.nama)}</div>`
      : `<div class="adv-sw-av all">👥</div>`;

    const nameHtml = active ? active.nama : 'Semua Advertiser';
    const subHtml  = active
      ? (active.email || 'Advertiser')
      : `${allAdvertisers.length} advertiser`;

    el.innerHTML = `
      <div class="adv-sw-trigger ${dropOpen ? 'open' : ''}" id="adv-trigger" onclick="window.__toggleAdvDrop(event)">
        ${avHtml}
        <div class="adv-sw-info">
          <div class="adv-sw-name">${nameHtml}</div>
          <div class="adv-sw-sub">${subHtml}</div>
        </div>
        <div class="adv-sw-arrow">▼</div>
      </div>
    `;
  }

  // ── Render dropdown ───────────────────────────────────────
  function renderDropdown() {
    removeDropdown();
    const trigger = document.getElementById('adv-trigger');
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const dd   = document.createElement('div');
    dd.className = 'adv-sw-dropdown';
    dd.id = 'adv-dropdown';
    dd.style.cssText = `top:${rect.bottom + 6}px;left:${rect.left}px;width:${Math.max(rect.width, 210)}px`;

    const allActive = !activeAdv;
    dd.innerHTML = `
      <div class="adv-sw-opt ${allActive ? 'active' : ''}" onclick="window.__switchAdv(null)">
        <div class="adv-sw-opt-av all">👥</div>
        <div class="adv-sw-opt-info">
          <div class="adv-sw-opt-name">Semua Advertiser</div>
          <div class="adv-sw-opt-sub">${allAdvertisers.length} advertiser</div>
        </div>
        ${allActive ? '<div class="adv-sw-opt-check">✓</div>' : ''}
      </div>
      <div class="adv-sw-divider"></div>
    `;

    allAdvertisers.forEach((a, i) => {
      const color    = COLORS[i % COLORS.length];
      const isActive = activeAdv === a.id;
      dd.innerHTML += `
        <div class="adv-sw-opt ${isActive ? 'active' : ''}" onclick="window.__switchAdv('${a.id}')">
          <div class="adv-sw-opt-av" style="background:${color}">${initials(a.nama)}</div>
          <div class="adv-sw-opt-info">
            <div class="adv-sw-opt-name">${a.nama || '-'}</div>
            <div class="adv-sw-opt-sub">${a.email || 'Advertiser'}</div>
          </div>
          ${isActive ? '<div class="adv-sw-opt-check">✓</div>' : ''}
        </div>
      `;
    });

    document.body.appendChild(dd);
  }

  function removeDropdown() {
    const old = document.getElementById('adv-dropdown');
    if (old) old.remove();
  }

  // ── Toggle ────────────────────────────────────────────────
  window.__toggleAdvDrop = function (e) {
    e.stopPropagation();
    dropOpen = !dropOpen;
    render();
    if (dropOpen) {
      renderDropdown();
      setTimeout(() => document.addEventListener('click', closeDrop, { once: true }), 0);
    } else {
      removeDropdown();
    }
  };

  function closeDrop() {
    if (!dropOpen) return;
    dropOpen = false;
    render();
    removeDropdown();
  }

  // ── Switch advertiser ─────────────────────────────────────
  window.__switchAdv = function (userId) {
    activeAdv = userId;
    sessionStorage.setItem('adv_active', userId || 'null');
    dropOpen = false;
    removeDropdown();
    render();
    window.__activeAdvertiser = userId;
    window.dispatchEvent(new CustomEvent('advertiserSwitch', { detail: { userId } }));
  };

  // Expose ke halaman
  window.__activeAdvertiser = activeAdv;

  // ── Load advertiser dari Supabase ─────────────────────────
  async function loadAdvertisers() {
    try {
      const user = await getUser();
      if (!user) { console.log('[AdvSW] no user'); return; }

      // Fetch profile diri sendiri
      const { data: myProfile, error: profErr } = await db()
        .from('profiles').select('role').eq('id', user.id).single();
      console.log('[AdvSW] my profile:', myProfile, profErr);
      if (myProfile?.role !== 'admin') return; // bukan admin

      // Fetch semua profiles kecuali diri sendiri dan admin
      const { data: advs, error: advErr } = await db()
        .from('profiles')
        .select('id, nama, role, no_wa')
        .neq('id', user.id)          // kecualikan diri sendiri
        .neq('role', 'admin')        // kecualikan admin lain
        .order('nama');

      console.log('[AdvSW] advertisers:', advs, advErr);
      if (!advs?.length) {
        console.log('[AdvSW] no advertisers found — cek RLS policy di profiles table');
        return;
      }

      allAdvertisers = advs.map(a => ({
        id:    a.id,
        nama:  a.nama || 'Tanpa Nama',
        email: a.no_wa ? `📱 ${a.no_wa}` : 'Advertiser'
      }));

      // Reset filter kalau advertiser yang dipilih sudah tidak ada
      if (activeAdv && !allAdvertisers.find(a => a.id === activeAdv)) {
        activeAdv = null;
        sessionStorage.removeItem('adv_active');
        window.__activeAdvertiser = null;
      }

      injectEl();
      render();

    } catch (e) { console.log('[AdvSW] error', e); }
  }

  // ── Init: tunggu sidebar render ───────────────────────────
  function tryInit() {
    if (document.querySelector('.sidebar-nav')) {
      loadAdvertisers();
    } else {
      const obs = new MutationObserver(() => {
        if (document.querySelector('.sidebar-nav')) {
          obs.disconnect();
          loadAdvertisers();
        }
      });
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 5000);
    }
  }

  window.__loadAdvSwitcher = loadAdvertisers;
  setTimeout(tryInit, 0);

})();
