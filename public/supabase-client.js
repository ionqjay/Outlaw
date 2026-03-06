const supabaseUrl = (window.APP_CONFIG?.SUPABASE_URL || '').trim();
const supabaseAnonKey = (window.APP_CONFIG?.SUPABASE_ANON_KEY || '').trim();

window.smrSupabaseReady = Boolean(supabaseUrl && supabaseAnonKey && window.supabase?.createClient);
window.smrSupabase = window.smrSupabaseReady
  ? window.supabase.createClient(supabaseUrl, supabaseAnonKey)
  : null;
