// Injected by Vercel buildCommand before deploy.
// Replaces {{BUILD_TIMESTAMP}} in index.html with the current UTC time
// in YYYYMMDDHHmmSS format. The result is baked into the deployed HTML —
// it never changes for a given deploy and requires no client-side JS.

const fs = require('fs');
const path = require('path');

const now = new Date();
const pad = n => String(n).padStart(2, '0');
const ts =
  now.getUTCFullYear() +
  pad(now.getUTCMonth() + 1) +
  pad(now.getUTCDate()) +
  pad(now.getUTCHours()) +
  pad(now.getUTCMinutes()) +
  pad(now.getUTCSeconds());

const file = path.join(__dirname, 'index.html');
const html = fs.readFileSync(file, 'utf8');
const updated = html.replace(/\{\{BUILD_TIMESTAMP\}\}/g, ts);
fs.writeFileSync(file, updated, 'utf8');

console.log(`Build timestamp injected: ${ts}`);
