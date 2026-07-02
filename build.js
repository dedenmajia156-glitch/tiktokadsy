const fs = require('fs');

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';

if (!url || !key) {
  console.warn('⚠️  SUPABASE_URL atau SUPABASE_ANON_KEY belum diset!');
}

const content = `const SUPABASE_URL = '${url}';\nconst SUPABASE_ANON_KEY = '${key}';\n`;

fs.writeFileSync('js/config.js', content);
console.log('✅ config.js berhasil dibuat dari environment variables');
