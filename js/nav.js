// Inline SVG icons (Lucide-style)
const ic = (d) => `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'>${d}</svg>`;
const NAV_ICONS = {
  dashboard:     ic(`<rect x='3' y='3' width='7' height='7' rx='1'/><rect x='14' y='3' width='7' height='7' rx='1'/><rect x='3' y='14' width='7' height='7' rx='1'/><rect x='14' y='14' width='7' height='7' rx='1'/>`),
  'data-iklan':  ic(`<path d='M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4'/><polyline points='17 8 12 3 7 8'/><line x1='12' y1='3' x2='12' y2='15'/>`),
  'video-tracker': ic(`<polygon points='23 7 16 12 23 17 23 7'/><rect x='1' y='5' width='15' height='14' rx='2' ry='2'/>`),
  'scale-kill':  ic(`<polyline points='22 7 13.5 15.5 8.5 10.5 2 17'/><polyline points='16 7 22 7 22 13'/>`),
  produk:        ic(`<path d='m7.5 4.27 9 5.15'/><path d='M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z'/><path d='m3.3 7 8.7 5 8.7-5'/><path d='M12 22V12'/>`),
  users:         ic(`<path d='M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M22 21v-2a4 4 0 0 0-3-3.87'/><path d='M16 3.13a4 4 0 0 1 0 7.75'/>`),
  settings:      ic(`<path d='M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z'/><circle cx='12' cy='12' r='3'/>`),
  signout:       ic(`<path d='M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4'/><polyline points='16 17 21 12 16 7'/><line x1='21' y1='12' x2='9' y2='12'/>`),
};

// Render sidebar + topbar ke dalam elemen target
function renderNav(activePage, pageTitle) {
  const sidebarHTML = `
  <aside class="sidebar">
    <a href="dashboard.html" class="sidebar-brand">
      <div class="brand-icon"><img src="img/logo-adsy.png" alt="Adsy" style="width:24px;height:24px;object-fit:contain"></div>
      <div>
        <div class="brand-name">GMV Tracker</div>
        <span class="brand-sub">MAX Ads Dashboard</span>
      </div>
    </a>

    <nav class="sidebar-nav">
      <div class="nav-section-title">Menu</div>
      <a href="dashboard.html" class="nav-link" data-page="dashboard">
        <span class="icon">${NAV_ICONS.dashboard}</span> Dashboard
      </a>
      <a href="data-iklan.html" class="nav-link" data-page="data-iklan">
        <span class="icon">${NAV_ICONS['data-iklan']}</span> Data Iklan
      </a>
      <a href="video-tracker.html" class="nav-link" data-page="video-tracker">
        <span class="icon">${NAV_ICONS['video-tracker']}</span> Video Tracker
      </a>
      <a href="scale-kill.html" class="nav-link" data-page="scale-kill" id="nav-sk">
        <span class="icon">${NAV_ICONS['scale-kill']}</span> Scale / Kill
        <span class="nav-badge" id="badge-pending" style="display:none">0</span>
      </a>

      <div class="nav-section-title" style="margin-top:8px">Pengaturan</div>
      <a href="produk.html" class="nav-link" data-page="produk">
        <span class="icon">${NAV_ICONS.produk}</span> Produk
      </a>
      <a href="users.html" class="nav-link admin-only" data-page="users">
        <span class="icon">${NAV_ICONS.users}</span> Users
      </a>
      <a href="settings.html" class="nav-link" data-page="settings">
        <span class="icon">${NAV_ICONS.settings}</span> Settings
      </a>
    </nav>

    <div class="sidebar-signout">
      <button class="btn-signout" onclick="doSignOut()">
        <span class="icon">${NAV_ICONS.signout}</span> Sign Out
      </button>
    </div>
  </aside>`;

  const topbarHTML = `
  <header class="topbar">
    <div class="topbar-title">${pageTitle}</div>
    <div class="topbar-search">
      <span>🔍</span>
      <input type="text" placeholder="Cari di sini..." />
    </div>
    <div class="topbar-actions">
      <div class="btn-icon" title="Notifikasi">
        🔔
        <span class="notif-dot" id="notif-dot" style="display:none"></span>
      </div>
      <div class="user-pill" onclick="window.location.href='settings.html'">
        <div class="user-avatar" id="user-avatar">?</div>
        <div class="user-info">
          <div class="name" id="user-name">Loading...</div>
          <div class="role" id="user-role">-</div>
        </div>
      </div>
    </div>
  </header>`;

  document.getElementById('sidebar-container').innerHTML = sidebarHTML;
  document.getElementById('topbar-container').innerHTML = topbarHTML;

  // set active menu
  document.querySelectorAll('.nav-link').forEach(el => {
    el.classList.toggle('active', el.dataset.page === activePage);
  });
}

async function initPage(activePage, pageTitle) {
  await requireAuth();
  renderNav(activePage, pageTitle);
  const profile = await renderUserHeader();

  // Badge Scale/Kill pending
  loadPendingBadge();

  return profile;
}

async function loadPendingBadge() {
  try {
    const user = await getUser();
    if (!user) return;
    const { count } = await db()
      .from('video_decisions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .is('hasil', null)
      .eq('keputusan', 'scale');
    const badge = document.getElementById('badge-pending');
    if (badge && count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-flex';
    }
  } catch(_) {}
}

async function doSignOut() {
  sessionStorage.removeItem('gmv_profile_cache');
  await signOut();
  window.location.href = 'index.html';
}

// Format angka ke Rupiah singkat
function fmtRp(val) {
  const n = Number(val) || 0;
  if (n >= 1e9) return 'Rp ' + (n/1e9).toFixed(1) + 'M';
  if (n >= 1e6) return 'Rp ' + (n/1e6).toFixed(1) + 'jt';
  if (n >= 1e3) return 'Rp ' + (n/1e3).toFixed(0) + 'rb';
  return 'Rp ' + n.toFixed(0);
}

function fmtNum(val) {
  return Number(val || 0).toLocaleString('id-ID');
}

function fmtRoas(cost, revenue) {
  if (!cost || cost === 0) return '-';
  return (revenue / cost).toFixed(2) + 'x';
}

function roasClass(roas) {
  const r = parseFloat(roas);
  if (isNaN(r)) return '';
  if (r >= 3) return 'roas-high';
  if (r >= 1.5) return 'roas-mid';
  return 'roas-low';
}

// Toast notification
function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
