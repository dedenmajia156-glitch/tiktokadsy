// Render sidebar + topbar ke dalam elemen target
function renderNav(activePage, pageTitle) {
  const sidebarHTML = `
  <aside class="sidebar">
    <a href="dashboard.html" class="sidebar-brand">
      <div class="brand-icon">📊</div>
      <div>
        <div class="brand-name">GMV Tracker</div>
        <span class="brand-sub">MAX Ads Dashboard</span>
      </div>
    </a>

    <nav class="sidebar-nav">
      <div class="nav-section-title">Menu</div>
      <a href="dashboard.html" class="nav-link" data-page="dashboard">
        <span class="icon">🏠</span> Dashboard
      </a>
      <a href="data-iklan.html" class="nav-link" data-page="data-iklan">
        <span class="icon">📥</span> Data Iklan
      </a>
      <a href="video-tracker.html" class="nav-link" data-page="video-tracker">
        <span class="icon">🎬</span> Video Tracker
      </a>
      <a href="scale-kill.html" class="nav-link" data-page="scale-kill" id="nav-sk">
        <span class="icon">⚡</span> Scale / Kill
        <span class="nav-badge" id="badge-pending" style="display:none">0</span>
      </a>

      <div class="nav-section-title" style="margin-top:8px">Pengaturan</div>
      <a href="produk.html" class="nav-link" data-page="produk">
        <span class="icon">📦</span> Produk
      </a>
      <a href="users.html" class="nav-link admin-only" data-page="users">
        <span class="icon">👥</span> Users
      </a>
      <a href="settings.html" class="nav-link" data-page="settings">
        <span class="icon">⚙️</span> Settings
      </a>
    </nav>

    <div class="sidebar-signout">
      <button class="btn-signout" onclick="doSignOut()">
        <span class="icon">🚪</span> Sign Out
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
