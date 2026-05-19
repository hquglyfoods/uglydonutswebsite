#!/usr/bin/env node
/**
 * Generate _index.json files listing all markdown files in each content folder.
 * Run by Netlify on every build, before deploy.
 *
 * Usage: node build-index.js
 */

const fs = require('fs');
const path = require('path');

const dirs = ['content/menu', 'content/articles', 'content/locations'];

dirs.forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    console.log(`[skip] ${dir} not found`);
    return;
  }

  const files = fs.readdirSync(fullPath)
    .filter(f => f.endsWith('.md') && !f.startsWith('_'))
    .sort();

  const indexPath = path.join(fullPath, '_index.json');
  fs.writeFileSync(indexPath, JSON.stringify(files, null, 2));
  console.log(`[ok]   ${dir}/_index.json (${files.length} files)`);
});
