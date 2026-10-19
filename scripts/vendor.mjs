import { copyFileSync } from 'node:fs';
for (const [source, target] of [
  ['node_modules/dompurify/dist/purify.min.js', 'public/vendor/purify.min.js'],
  ['node_modules/dompurify/LICENSE', 'public/vendor/DOMPurify-LICENSE'],
  ['node_modules/@supabase/supabase-js/dist/umd/supabase.js', 'public/vendor/supabase.js'],
  ['node_modules/@supabase/supabase-js/LICENSE', 'public/vendor/Supabase-LICENSE']
]) copyFileSync(source, target);
