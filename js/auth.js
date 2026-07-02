// Redirect ke login kalau belum login
async function requireAuth() {
  const session = await getSession();
  if (!session) { window.location.href = 'index.html'; return null; }
  return session;
}

// Redirect ke dashboard kalau sudah login (untuk halaman login)
async function redirectIfLoggedIn() {
  const session = await getSession();
  if (session) window.location.href = 'dashboard.html';
}

// Render nama + role di header
async function renderUserHeader() {
  const profile = await getProfile();
  if (!profile) return;
  const nameEl = document.getElementById('user-name');
  const roleEl = document.getElementById('user-role');
  const avatarEl = document.getElementById('user-avatar');
  if (nameEl) nameEl.textContent = profile.nama || 'User';
  if (roleEl) roleEl.textContent = profile.role === 'admin' ? 'Admin' : 'Advertiser';
  if (avatarEl) avatarEl.textContent = (profile.nama || 'U')[0].toUpperCase();

  // Sembunyikan menu admin kalau bukan admin
  if (profile.role !== 'admin') {
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
  }
  return profile;
}

// Highlight menu aktif
function setActiveMenu(page) {
  document.querySelectorAll('.nav-link').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
}

function showErr(el, msg) {
  el.textContent = msg;
  el.style.display = 'block';
}
