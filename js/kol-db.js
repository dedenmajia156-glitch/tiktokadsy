// ===== SUPABASE CLIENT: KOL Management (DB terpisah) =====
// Read-only access ke project KOL Management Adsy
// URL & key dari KOLmanagement-main/js/supabase.js

const KOL_SUPABASE_URL  = 'https://pdkkcpdjqpyljddeeott.supabase.co';
const KOL_SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBka2tjcGRqcXB5bGpkZGVlb3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwOTAyNzQsImV4cCI6MjA5MjY2NjI3NH0.dgMfJdolmHuMyP_Zm9D912I81sSDQXsxhOI21WgFUa8';

const _kolSupa = supabase.createClient(KOL_SUPABASE_URL, KOL_SUPABASE_KEY);

function kolDb() { return _kolSupa; }
