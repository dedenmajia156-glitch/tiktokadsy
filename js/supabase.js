// SUPABASE_URL dan SUPABASE_ANON_KEY diambil dari js/config.js
const _supa = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function getSession() {
  const { data } = await _supa.auth.getSession();
  return data.session;
}

async function getUser() {
  const { data } = await _supa.auth.getUser();
  return data.user;
}

async function getProfile() {
  const user = await getUser();
  if (!user) return null;
  const { data } = await _supa.from('profiles').select('*').eq('id', user.id).single();
  return data;
}

async function signIn(email, password) {
  const { data, error } = await _supa.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function signUp(email, password, meta) {
  const { data, error } = await _supa.auth.signUp({ email, password, options: { data: meta } });
  if (error) throw error;
  return data;
}

async function signOut() {
  await _supa.auth.signOut();
}

function db() { return _supa; }
