const fs = require('fs');
const path = require('path');
require('dotenv').config();

const supabaseUrl =
  process.env['SUPABASE_URL'] ?? process.env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey =
  process.env['SUPABASE_KEY'] ??
  process.env['SUPABASE_PUBLISHABLE_KEY'] ??
  process.env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Variables Supabase manquantes : configurez SUPABASE_URL/SUPABASE_KEY ou les variables NEXT_PUBLIC_SUPABASE_*.',
  );
}

const content = `export const environment = {
  supabaseUrl: ${JSON.stringify(supabaseUrl)},
  supabaseKey: ${JSON.stringify(supabaseKey)}
};
`;

const outputDirectory = path.join(process.cwd(), 'src', 'environments');
fs.mkdirSync(outputDirectory, { recursive: true });
fs.writeFileSync(path.join(outputDirectory, 'environment.ts'), content);
