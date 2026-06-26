#!/usr/bin/env node
/**
 * Ugly Donuts site build step. Runs on every Netlify deploy (see netlify.toml).
 *
 * Markdown files under content/* are the single source of truth. This script
 * regenerates everything derived from them so nothing goes stale:
 *
 *   1. content/<col>/_index.json  - file listings the client JS fetches.
 *   2. journal.html               - static, crawlable article cards injected
 *                                   into the page (between markers) plus
 *                                   ItemList structured data, so search engines
 *                                   and AI scanners see the Journal without JS.
 *   3. sitemap.xml                - one entry per published article.
 *
 * All HTML/sitemap edits are marker based and idempotent: running this twice
 * produces the same output.
 *
 * Usage: node build-index.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SITE = 'https://www.uglydonutsncorndogs.com';

/* ---------- helpers ---------- */

// Mirror journal.html parseFrontmatter exactly so static cards match JS cards.
function parseFrontmatter(text) {
  const m = text.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  const data = {};
  m[1].split('\n').forEach(function (line) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (!kv) return;
    let val = kv[2].trim().replace(/^["']|["']$/g, '');
    if (val === 'true') val = true;
    else if (val === 'false') val = false;
    data[kv[1].trim()] = val;
  });
  return { data: data, body: m[2].trim() };
}

function listMd(dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full)
    .filter(function (f) { return f.endsWith('.md') && !f.startsWith('_'); })
    .sort();
}

// Replace the content between two marker comments, inserting the markers
// (with surrounding text) when they are not yet present.
function injectBetween(source, startMark, endMark, payload, insertBeforeIfMissing) {
  const s = source.indexOf(startMark);
  const e = source.indexOf(endMark);
  if (s !== -1 && e !== -1 && e > s) {
    return source.slice(0, s + startMark.length) + payload + source.slice(e);
  }
  const block = startMark + payload + endMark;
  const at = source.indexOf(insertBeforeIfMissing);
  if (at === -1) return source; // anchor missing; leave untouched
  return source.slice(0, at) + block + source.slice(at);
}

/* ---------- 1. _index.json for every collection ---------- */

['content/menu', 'content/articles', 'content/locations'].forEach(function (dir) {
  const files = listMd(dir);
  if (!fs.existsSync(path.join(ROOT, dir))) { console.log('[skip] ' + dir); return; }
  fs.writeFileSync(path.join(ROOT, dir, '_index.json'), JSON.stringify(files, null, 2));
  console.log('[ok]   ' + dir + '/_index.json (' + files.length + ' files)');
});

/* ---------- 2. read published articles (source of truth) ---------- */

const articles = listMd('content/articles').map(function (file) {
  const item = parseFrontmatter(fs.readFileSync(path.join(ROOT, 'content/articles', file), 'utf8'));
  item.slug = file.replace(/\.md$/, '');
  return item;
}).filter(function (it) {
  return it.data && it.data.title && it.data.draft !== true;
}).sort(function (a, b) {
  return new Date(b.data.published_date || 0) - new Date(a.data.published_date || 0);
});

/* ---------- 3. prerender journal.html ---------- */

const JPATH = path.join(ROOT, 'journal.html');
if (fs.existsSync(JPATH)) {
  let html = fs.readFileSync(JPATH, 'utf8');

  // Build static cards identical to journal.html buildCardHtml output.
  const cards = articles.map(function (it) {
    const d = it.data;
    const cover = d.cover ? '<img src="' + d.cover + '" alt="' + (d.title || '') + '" loading="lazy">' : '';
    return '<a href="/article.html?slug=' + encodeURIComponent(it.slug) + '" class="journal-page-card">' +
      '<div class="journal-page-card-photo">' + cover + '</div>' +
      '<div class="journal-page-card-meta">' + (d.category || 'Journal') +
      '<span class="sep">&middot;</span>' + (d.read_time || '3 min read') + '</div>' +
      '<h3>' + (d.title || '') + '</h3>' +
      '<p>' + (d.excerpt || '') + '</p>' +
      '</a>';
  }).join('\n');

  const hasArticles = articles.length > 0;

  // a) Normalize the grid opening tag (remove the default display:none so the
  //    static cards are visible to crawlers; JS still re-renders for users).
  html = html.replace(
    /<div class="journal-page-grid" id="journal-page-grid"[^>]*>/,
    '<div class="journal-page-grid" id="journal-page-grid">'
  );

  // b) Inject the cards between markers inside the grid.
  if (html.indexOf('<!--AUTO-ARTICLE-CARDS:START-->') !== -1) {
    html = injectBetween(html, '<!--AUTO-ARTICLE-CARDS:START-->', '<!--AUTO-ARTICLE-CARDS:END-->',
      '\n' + cards + '\n', null);
  } else {
    html = html.replace(
      '<div class="journal-page-grid" id="journal-page-grid"></div>',
      '<div class="journal-page-grid" id="journal-page-grid"><!--AUTO-ARTICLE-CARDS:START-->\n' +
      cards + '\n<!--AUTO-ARTICLE-CARDS:END--></div>'
    );
  }

  // c) Show/hide the "coming soon" empty state depending on whether we have articles.
  html = html.replace(
    /<div id="journal-page-empty" class="journal-empty-page"[^>]*>/,
    '<div id="journal-page-empty" class="journal-empty-page"' + (hasArticles ? ' style="display:none"' : '') + '>'
  );

  // d) ItemList structured data for the Journal listing.
  const itemList = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Ugly Donuts & Corn Dogs Journal',
    itemListElement: articles.map(function (it, i) {
      return {
        '@type': 'ListItem',
        position: i + 1,
        url: SITE + '/article.html?slug=' + encodeURIComponent(it.slug),
        name: it.data.title || ''
      };
    })
  };
  const jsonld = '\n<script type="application/ld+json">' + JSON.stringify(itemList) + '</script>\n';
  html = injectBetween(html, '<!--AUTO-JSONLD:START-->', '<!--AUTO-JSONLD:END-->', jsonld, '</head>');

  fs.writeFileSync(JPATH, html);
  console.log('[ok]   journal.html prerendered (' + articles.length + ' cards)');
}

/* ---------- 4. sitemap.xml article URLs ---------- */

const SPATH = path.join(ROOT, 'sitemap.xml');
if (fs.existsSync(SPATH)) {
  let xml = fs.readFileSync(SPATH, 'utf8');
  const urls = articles.map(function (it) {
    const lastmod = (it.data.published_date || '').toString().slice(0, 10);
    return '  <url>\n' +
      '    <loc>' + SITE + '/article.html?slug=' + encodeURIComponent(it.slug) + '</loc>\n' +
      (lastmod ? '    <lastmod>' + lastmod + '</lastmod>\n' : '') +
      '    <changefreq>yearly</changefreq>\n' +
      '    <priority>0.4</priority>\n' +
      '  </url>\n';
  }).join('');
  xml = injectBetween(xml, '<!--AUTO-ARTICLES:START-->', '<!--AUTO-ARTICLES:END-->',
    '\n' + urls, '</urlset>');
  fs.writeFileSync(SPATH, xml);
  console.log('[ok]   sitemap.xml (' + articles.length + ' article urls)');
}

console.log('Build complete.');
