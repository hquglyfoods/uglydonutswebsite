#!/usr/bin/env node
/**
 * Ugly Donuts site build step. Runs on every Netlify deploy (see netlify.toml).
 *
 * Markdown files under content/* are the single source of truth. This script
 * regenerates everything derived from them so nothing goes stale and so search
 * engines and AI scanners can read the content without running JavaScript:
 *
 *   1. content/<col>/_index.json     listings the client JS fetches.
 *   2. journal.html                  static article cards + ItemList JSON-LD.
 *   3. menu.html                     static menu cards (grouped by category).
 *   4. locations.html                static location cards.
 *   5. journal/<slug>.html           one fully rendered page per article, with
 *                                    title, description, canonical, OG tags and
 *                                    Article JSON-LD baked in.
 *   6. sitemap.xml                   one entry per published article page.
 *
 * All in-place HTML/sitemap edits are marker based and idempotent.
 *
 * Usage: node build-index.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SITE = 'https://www.uglydonutsncorndogs.com';
const OG_IMAGE = SITE + '/og-image.jpg';

/* ===================== SEO helpers ===================== */

function extractHead(html) {
  const t = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || 'Ugly Donuts &amp; Corn Dogs';
  const c = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1] || (SITE + '/');
  const d = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  return { title: t.trim(), canonical: c, description: d };
}
function meta(prop, val, useName) {
  return '<meta ' + (useName ? 'name' : 'property') + '="' + prop + '" content="' + val + '">';
}
function stripSocial(html) {
  return html.replace(/[ \t]*<meta (?:property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\n?/g, '');
}
function ensureManifest(html) {
  if (html.indexOf('rel="manifest"') !== -1) return html;
  return html.replace('<meta name="theme-color"', '<link rel="manifest" href="/site.webmanifest">\n<meta name="theme-color"');
}
function socialBlock(m, ogType) {
  return '\n' + [
    meta('og:site_name', 'Ugly Donuts &amp; Corn Dogs'),
    meta('og:type', ogType || 'website'),
    meta('og:url', m.canonical),
    meta('og:title', m.title),
    meta('og:description', m.description),
    meta('og:image', OG_IMAGE),
    meta('og:image:width', '1200'),
    meta('og:image:height', '630'),
    meta('twitter:card', 'summary_large_image', true),
    meta('twitter:title', m.title, true),
    meta('twitter:description', m.description, true),
    meta('twitter:image', OG_IMAGE, true)
  ].join('\n') + '\n';
}
function jsonLd(obj) { return '<script type="application/ld+json">' + JSON.stringify(obj) + '</script>'; }
function glob_html() {
  return fs.readdirSync(ROOT).filter(function (f) { return f.endsWith('.html') && f !== 'cookie-banner-snippet.html'; });
}

/* ===================== shared helpers ===================== */

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

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function attrEscape(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

// Mirrors article.html markdownToHtml so static bodies match the JS render.
function markdownToHtml(md) {
  if (!md) return '';
  const lines = md.split('\n');
  let html = '', inList = false, listType = '', inQuote = false, paraLines = [];
  function flushPara() {
    if (paraLines.length) {
      const text = paraLines.join(' ').trim();
      if (text) html += '<p>' + processInline(text) + '</p>\n';
      paraLines = [];
    }
  }
  function flushList() { if (inList) { html += '</' + listType + '>\n'; inList = false; listType = ''; } }
  function flushQuote() { if (inQuote) { html += '</blockquote>\n'; inQuote = false; } }
  function processInline(text) {
    text = escapeHtml(text);
    text = text.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(?<!\*)\*([^\*\n]+)\*(?!\*)/g, '<em>$1</em>');
    text = text.replace(/_([^_\n]+)_/g, '<em>$1</em>');
    text = text.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    return text;
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) { flushPara(); flushList(); flushQuote(); let level = Math.min(h[1].length, 6); if (level === 1) level = 2; html += '<h' + level + '>' + processInline(h[2]) + '</h' + level + '>\n'; continue; }
    if (/^---+\s*$/.test(line) || /^\*\*\*+\s*$/.test(line)) { flushPara(); flushList(); flushQuote(); html += '<hr>\n'; continue; }
    if (/^>\s?/.test(line)) { flushPara(); flushList(); if (!inQuote) { html += '<blockquote>\n'; inQuote = true; } html += '<p>' + processInline(line.replace(/^>\s?/, '')) + '</p>\n'; continue; }
    else if (inQuote && line.trim() === '') { flushQuote(); continue; }
    const ul = line.match(/^[\*\-]\s+(.+)$/);
    if (ul) { flushPara(); flushQuote(); if (!inList || listType !== 'ul') { flushList(); html += '<ul>\n'; inList = true; listType = 'ul'; } html += '<li>' + processInline(ul[1]) + '</li>\n'; continue; }
    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) { flushPara(); flushQuote(); if (!inList || listType !== 'ol') { flushList(); html += '<ol>\n'; inList = true; listType = 'ol'; } html += '<li>' + processInline(ol[1]) + '</li>\n'; continue; }
    const img = line.match(/^!\[([^\]]*)\]\(([^\)]+)\)\s*$/);
    if (img) { flushPara(); flushList(); flushQuote(); html += '<img src="' + img[2] + '" alt="' + escapeHtml(img[1]) + '" loading="lazy">\n'; continue; }
    if (line.trim() === '') { flushPara(); flushList(); continue; }
    paraLines.push(line);
  }
  flushPara(); flushList(); flushQuote();
  return html;
}

function formatDate(d) {
  if (!d) return '';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(d);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return months[parseInt(m[2], 10) - 1] + ' ' + parseInt(m[3], 10) + ', ' + m[1];
}

function listMd(dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter(function (f) { return f.endsWith('.md') && !f.startsWith('_'); }).sort();
}
function readItems(dir) {
  return listMd(dir).map(function (file) {
    const item = parseFrontmatter(fs.readFileSync(path.join(ROOT, dir, file), 'utf8'));
    item.slug = file.replace(/\.md$/, '');
    return item;
  });
}
function injectBetween(source, startMark, endMark, payload, anchorBefore) {
  const s = source.indexOf(startMark), e = source.indexOf(endMark);
  if (s !== -1 && e !== -1 && e > s) return source.slice(0, s + startMark.length) + payload + source.slice(e);
  if (!anchorBefore) return source;
  const at = source.indexOf(anchorBefore);
  if (at === -1) return source;
  return source.slice(0, at) + startMark + payload + endMark + source.slice(at);
}

// Replace the inner content of a <div> element (matched by openRe) with
// payload wrapped in markers. On later runs the markers already exist so we
// just swap between them. Uses depth matching so nested <div>s are handled.
function setInner(html, openRe, startMark, endMark, payload) {
  if (html.indexOf(startMark) !== -1 && html.indexOf(endMark) !== -1) {
    return injectBetween(html, startMark, endMark, '\n' + payload + '\n', null);
  }
  const m = openRe.exec(html);
  if (!m) return html;
  const openEnd = m.index + m[0].length;
  let depth = 1, j = openEnd;
  while (depth > 0 && j < html.length) {
    const nd = html.indexOf('<div', j);
    const nc = html.indexOf('</div>', j);
    if (nc === -1) break;
    if (nd !== -1 && nd < nc) { depth++; j = nd + 4; }
    else { depth--; j = nc + 6; }
  }
  const closeStart = j - 6; // start of the matching </div>
  return html.slice(0, openEnd) + startMark + '\n' + payload + '\n' + endMark + html.slice(closeStart);
}

/* ===================== 0. extract inline base64 images (perf) ===================== */
/* Pages may keep images inline as base64 so the repo is self-contained and never
   shows broken images. On each deploy this extracts them to content-hashed files
   under /images/extracted and rewrites references, so the served pages stay light. */

(function () {
  const crypto = require('crypto');
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
  const dir = path.join(ROOT, 'images', 'extracted');
  const re = /data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=]+)/g;
  const map = {};
  let pages = glob_html();
  const jdir = path.join(ROOT, 'journal');
  if (fs.existsSync(jdir)) pages = pages.concat(fs.readdirSync(jdir).filter(function (f) { return f.endsWith('.html'); }).map(function (f) { return 'journal/' + f; }));
  let count = 0;
  pages.forEach(function (rel) {
    const fp = path.join(ROOT, rel);
    let html = fs.readFileSync(fp, 'utf8'), changed = false;
    html = html.replace(re, function (m, mime, data) {
      if (!map[m]) {
        const buf = Buffer.from(data, 'base64');
        const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const out = path.join(dir, hash + '.' + (EXT[mime] || 'bin'));
        if (!fs.existsSync(out)) fs.writeFileSync(out, buf);
        map[m] = '/images/extracted/' + hash + '.' + (EXT[mime] || 'bin');
        count++;
      }
      changed = true;
      return map[m];
    });
    if (changed) fs.writeFileSync(fp, html);
  });
  if (count) console.log('[ok]   extracted ' + count + ' inline image(s) to /images/extracted');
})();

/* ===================== 1. _index.json ===================== */

['content/menu', 'content/articles', 'content/locations'].forEach(function (dir) {
  if (!fs.existsSync(path.join(ROOT, dir))) { console.log('[skip] ' + dir); return; }
  const files = listMd(dir);
  fs.writeFileSync(path.join(ROOT, dir, '_index.json'), JSON.stringify(files, null, 2));
  console.log('[ok]   ' + dir + '/_index.json (' + files.length + ' files)');
});

/* ===================== 2. articles ===================== */

const articles = readItems('content/articles')
  .filter(function (it) { return it.data && it.data.title && it.data.draft !== true; })
  .sort(function (a, b) { return new Date(b.data.published_date || 0) - new Date(a.data.published_date || 0); });

function articleUrlPath(slug) { return '/journal/' + slug + '.html'; }

/* ---- 2a. per-article static pages ---- */

const APATH = path.join(ROOT, 'article.html');
const outDir = path.join(ROOT, 'journal');
if (fs.existsSync(APATH)) {
  const template = fs.readFileSync(APATH, 'utf8');
  fs.mkdirSync(outDir, { recursive: true });
  // Clean previously generated article pages so deleted articles do not linger.
  fs.readdirSync(outDir).forEach(function (f) { if (f.endsWith('.html')) fs.unlinkSync(path.join(outDir, f)); });

  articles.forEach(function (it) {
    const d = it.data;
    const url = SITE + articleUrlPath(it.slug);
    const bodyHtml = markdownToHtml(it.body || '');
    const cover = d.cover ? '<div class="article-cover"><img src="' + d.cover + '" alt="' + attrEscape(d.title || '') + '"></div>' : '';
    const dateStr = formatDate(d.published_date);
    const metaParts = ['<span>' + (d.category || 'Journal') + '</span>'];
    if (dateStr) metaParts.push('<span class="sep">&middot;</span><span class="date">' + dateStr + '</span>');
    if (d.read_time) metaParts.push('<span class="sep">&middot;</span><span class="date">' + d.read_time + '</span>');
    const baked =
      '<div class="article-meta">' + metaParts.join('') + '</div>' +
      '<h1 class="article-title">' + (d.title || 'Untitled') + '</h1>' +
      (d.excerpt ? '<p class="article-excerpt">' + d.excerpt + '</p>' : '') +
      cover +
      '<div class="article-body">' + bodyHtml + '</div>';

    const ld = {
      '@context': 'https://schema.org', '@type': 'BlogPosting',
      headline: d.title || '', description: d.excerpt || '',
      datePublished: (d.published_date || '').toString().slice(0, 10),
      image: d.cover ? SITE + d.cover : undefined,
      author: { '@type': 'Organization', name: 'Ugly Donuts & Corn Dogs' },
      publisher: { '@type': 'Organization', name: 'Ugly Donuts & Corn Dogs' },
      mainEntityOfPage: url
    };

    let page = template;
    page = page.replace('<div id="article-content">', '<div id="article-content" data-prerendered="true">');
    page = page.replace('<div class="article-loading">Loading article...</div>', baked);
    page = page.replace('<title>Journal · Ugly Donuts &amp; Corn Dogs</title>',
      '<title>' + attrEscape(d.title || 'Journal') + ' · Ugly Donuts &amp; Corn Dogs</title>');
    page = page.replace('<meta name="description" content="Stories from the Ugly Donuts kitchen and beyond.">',
      '<meta name="description" content="' + attrEscape(d.excerpt || '') + '">');
    page = page.replace('<link rel="canonical" href="https://www.uglydonutsncorndogs.com/article.html">',
      '<link rel="canonical" href="' + url + '">');
    page = page.replace('<meta property="og:type" content="website">', '<meta property="og:type" content="article">\n<meta property="og:site_name" content="Ugly Donuts &amp; Corn Dogs">');
    page = page.replace('<meta property="og:url" content="https://www.uglydonutsncorndogs.com/">',
      '<meta property="og:url" content="' + url + '">');
    page = page.replace('<meta property="og:title" content="Korean Corn Dogs &amp; Handmade Donuts · Ugly Donuts">',
      '<meta property="og:title" content="' + attrEscape(d.title || '') + '">' +
      (d.cover ? '\n<meta property="og:image" content="' + SITE + d.cover + '">' : ''));
    page = page.replace('<meta property="og:description" content="Made to order. Fried in 100% avocado oil.">',
      '<meta property="og:description" content="' + attrEscape(d.excerpt || '') + '">');
    page = page.replace('<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:card" content="summary_large_image">\n' +
      '<meta name="twitter:title" content="' + attrEscape(d.title || '') + '">\n' +
      '<meta name="twitter:description" content="' + attrEscape(d.excerpt || '') + '">' +
      (d.cover ? '\n<meta name="twitter:image" content="' + SITE + d.cover + '">' : ''));
    const crumbs = {
      '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
        { '@type': 'ListItem', position: 2, name: 'Journal', item: SITE + '/journal.html' },
        { '@type': 'ListItem', position: 3, name: d.title || '', item: url }
      ]
    };
    page = injectBetween(page, '<!--AUTO-ARTICLE-JSONLD:START-->', '<!--AUTO-ARTICLE-JSONLD:END-->',
      '\n' + jsonLd(ld) + '\n' + jsonLd(crumbs) + '\n', '</head>');

    fs.writeFileSync(path.join(outDir, it.slug + '.html'), page);
  });
  console.log('[ok]   journal/*.html (' + articles.length + ' article pages)');
}

/* ---- 2b. journal.html listing cards + ItemList ---- */

const JPATH = path.join(ROOT, 'journal.html');
if (fs.existsSync(JPATH)) {
  let html = fs.readFileSync(JPATH, 'utf8');
  const cards = articles.map(function (it) {
    const d = it.data;
    const coverImg = d.cover ? '<img src="' + d.cover + '" alt="' + attrEscape(d.title || '') + '" loading="lazy">' : '';
    return '<a href="' + articleUrlPath(it.slug) + '" class="journal-page-card">' +
      '<div class="journal-page-card-photo">' + coverImg + '</div>' +
      '<div class="journal-page-card-meta">' + (d.category || 'Journal') +
      '<span class="sep">&middot;</span>' + (d.read_time || '3 min read') + '</div>' +
      '<h3>' + (d.title || '') + '</h3>' +
      '<p>' + (d.excerpt || '') + '</p></a>';
  }).join('\n');
  const hasArticles = articles.length > 0;

  html = html.replace(/<div class="journal-page-grid" id="journal-page-grid"[^>]*>/, '<div class="journal-page-grid" id="journal-page-grid">');
  if (html.indexOf('<!--AUTO-ARTICLE-CARDS:START-->') !== -1) {
    html = injectBetween(html, '<!--AUTO-ARTICLE-CARDS:START-->', '<!--AUTO-ARTICLE-CARDS:END-->', '\n' + cards + '\n', null);
  } else {
    html = html.replace('<div class="journal-page-grid" id="journal-page-grid"></div>',
      '<div class="journal-page-grid" id="journal-page-grid"><!--AUTO-ARTICLE-CARDS:START-->\n' + cards + '\n<!--AUTO-ARTICLE-CARDS:END--></div>');
  }
  html = html.replace(/<div id="journal-page-empty" class="journal-empty-page"[^>]*>[\s\S]*?<\/div>/,
    hasArticles
      ? '<div id="journal-page-empty" class="journal-empty-page" style="display:none"></div>'
      : '<div id="journal-page-empty" class="journal-empty-page">\n      <p>The first issue is coming soon. Stories on how we make our doughs, why we fry to order, and how we open each store.</p>\n    </div>');

  const itemList = {
    '@context': 'https://schema.org', '@type': 'ItemList', name: 'Ugly Donuts & Corn Dogs Journal',
    itemListElement: articles.map(function (it, i) {
      return { '@type': 'ListItem', position: i + 1, url: SITE + articleUrlPath(it.slug), name: it.data.title || '' };
    })
  };
  html = injectBetween(html, '<!--AUTO-JSONLD:START-->', '<!--AUTO-JSONLD:END-->',
    '\n<script type="application/ld+json">' + JSON.stringify(itemList) + '</script>\n', '</head>');
  fs.writeFileSync(JPATH, html);
  console.log('[ok]   journal.html (' + articles.length + ' cards)');
}

/* ===================== 2b. index.html home previews ===================== */

(function () {
  const fp = path.join(ROOT, 'index.html');
  if (!fs.existsSync(fp)) return;
  let html = fs.readFileSync(fp, 'utf8');

  let menu = readItems('content/menu').filter(function (it) { return it.data && it.data.name; });
  const best = menu.filter(function (it) { return it.data.best_seller === true || it.data.best_seller === 'true'; });
  const pick = (best.length ? best : menu).slice(0, 4);
  const menuCards = pick.map(function (it) {
    const d = it.data;
    const photo = d.photo ? '<img src="' + d.photo + '" alt="' + attrEscape(d.name || '') + '" loading="lazy">' : '';
    return '<a href="/menu.html" class="menu-card"><div class="menu-card-photo">' + photo + '</div>' +
      '<div class="menu-card-cat">' + escapeHtml(d.category || '') + '</div>' +
      '<h4 class="menu-card-name">' + escapeHtml(d.name || '') + '</h4>' +
      '<p class="menu-card-desc">' + escapeHtml(d.description || '') + '</p></a>';
  }).join('\n');

  const jpick = articles.slice(0, 3);
  const journalCards = jpick.map(function (it) {
    const d = it.data;
    const cover = d.cover ? '<img src="' + d.cover + '" alt="' + attrEscape(d.title || '') + '" loading="lazy">' : '';
    return '<a href="' + articleUrlPath(it.slug) + '" class="journal-card"><div class="journal-card-photo">' + cover + '</div>' +
      '<div class="journal-card-meta">' + escapeHtml(d.category || 'Journal') + '<span class="sep">&middot;</span>' + escapeHtml(d.read_time || '3 min read') + '</div>' +
      '<h3>' + escapeHtml(d.title || '') + '</h3><p>' + escapeHtml(d.excerpt || '') + '</p></a>';
  }).join('\n');

  if (pick.length) {
    html = setInner(html, /<div class="menu-grid" id="menu-grid"[^>]*>/, '<!--AUTO-HOME-MENU:START-->', '<!--AUTO-HOME-MENU:END-->', menuCards);
    html = html.replace(/<div class="menu-grid" id="menu-grid"[^>]*>/, '<div class="menu-grid" id="menu-grid">');
    html = html.replace(/<div class="menu-empty fade-up" id="menu-empty"[^>]*>[\s\S]*?<\/div>/, '<div class="menu-empty fade-up" id="menu-empty" style="display:none"></div>');
    html = html.replace(/<div class="section-cta" id="menu-see-all"[^>]*>/, '<div class="section-cta" id="menu-see-all">');
  }
  if (jpick.length) {
    html = setInner(html, /<div class="journal-grid" id="journal-grid"[^>]*>/, '<!--AUTO-HOME-JOURNAL:START-->', '<!--AUTO-HOME-JOURNAL:END-->', journalCards);
    html = html.replace(/<div class="journal-grid" id="journal-grid"[^>]*>/, '<div class="journal-grid" id="journal-grid">');
    html = html.replace(/<div class="journal-empty fade-up" id="journal-empty"[^>]*>[\s\S]*?<\/div>/, '<div class="journal-empty fade-up" id="journal-empty" style="display:none"></div>');
    html = html.replace(/<div class="section-cta" id="journal-see-all"[^>]*>/, '<div class="section-cta" id="journal-see-all">');
  }
  fs.writeFileSync(fp, html);
  console.log('[ok]   index.html home previews (' + pick.length + ' items, ' + jpick.length + ' articles)');
})();

/* ===================== 3. menu.html ===================== */

const MPATH = path.join(ROOT, 'menu.html');
if (fs.existsSync(MPATH)) {
  let html = fs.readFileSync(MPATH, 'utf8');
  const categoryMap = { 'Corn Dog': 'Korean Corn Dogs', 'Corn Dogs': 'Korean Corn Dogs', 'Donut': 'Donuts', 'Beverage': 'Fruit Refreshers', 'Beverages': 'Fruit Refreshers', 'Drink': 'Fruit Refreshers', 'Drinks': 'Fruit Refreshers' };
  const catOrder = { 'Korean Corn Dogs': 0, 'Donuts': 1, 'Ice Cream Donuts': 2, 'Fruit Refreshers': 3, 'Fizzy Refreshers': 4, 'Ugly Boba': 5, 'Coco Sips': 6, 'Smoothies': 7 };
  let items = readItems('content/menu').filter(function (it) { return it.data && it.data.name; });
  items.forEach(function (it) { if (it.data.category && categoryMap[it.data.category]) it.data.category = categoryMap[it.data.category]; });
  items.sort(function (a, b) {
    let ao = catOrder[a.data.category], bo = catOrder[b.data.category];
    if (ao === undefined) ao = 99; if (bo === undefined) bo = 99;
    if (ao !== bo) return ao - bo;
    let aOrder = (a.data.order !== undefined && a.data.order !== null && a.data.order !== '') ? Number(a.data.order) : 9999;
    let bOrder = (b.data.order !== undefined && b.data.order !== null && b.data.order !== '') ? Number(b.data.order) : 9999;
    if (isNaN(aOrder)) aOrder = 9999; if (isNaN(bOrder)) bOrder = 9999;
    return aOrder - bOrder;
  });
  function menuCard(it) {
    const d = it.data;
    const photo = d.photo ? '<img src="' + d.photo + '" alt="' + attrEscape(d.name || '') + '" loading="lazy">' : '';
    return '<div class="menu-card"><div class="menu-card-text"><h4 class="menu-card-name">' + (d.name || '') + '</h4>' +
      '<p class="menu-card-desc">' + (d.description || '') + '</p></div>' +
      '<div class="menu-card-photo">' + photo + '</div></div>';
  }
  let grid = '', curCat = null;
  items.forEach(function (it) {
    const c = it.data.category || 'Other';
    if (c !== curCat) { grid += '<div class="menu-cat-header"><h3 class="menu-cat-title">' + c + '</h3></div>'; curCat = c; }
    grid += menuCard(it);
  });
  const has = items.length > 0;

  html = setInner(html, /<div class="menu-page-grid" id="menu-page-grid"[^>]*>/,
    '<!--AUTO-MENU-CARDS:START-->', '<!--AUTO-MENU-CARDS:END-->', grid);
  html = html.replace(/<div id="menu-page-content"[^>]*>/, '<div id="menu-page-content"' + (has ? '' : ' style="display:none"') + '>');
  html = html.replace(/<div id="menu-page-empty" class="menu-empty-page"[^>]*>[\s\S]*?<\/div>/,
    has
      ? '<div id="menu-page-empty" class="menu-empty-page" style="display:none"></div>'
      : '<div id="menu-page-empty" class="menu-empty-page">\n      <p>The full menu is being photographed and added now. For the live menu and current prices, <a href="/locations.html" class="text-link">visit one of our stores</a>.</p>\n    </div>');

  // Menu structured data (restaurant menu rich result), grouped by category.
  const secMap = {}, secOrder = [];
  items.forEach(function (it) {
    const cat = it.data.category || 'Other';
    if (!secMap[cat]) { secMap[cat] = []; secOrder.push(cat); }
    const mi = { '@type': 'MenuItem', name: it.data.name || '' };
    if (it.data.description) mi.description = it.data.description;
    if (it.data.photo) mi.image = SITE + it.data.photo;
    secMap[cat].push(mi);
  });
  const menuLd = {
    '@context': 'https://schema.org', '@type': 'Menu', name: 'Ugly Donuts & Corn Dogs Menu',
    hasMenuSection: secOrder.map(function (c) { return { '@type': 'MenuSection', name: c, hasMenuItem: secMap[c] }; })
  };
  html = injectBetween(html, '<!--AUTO-MENU-SCHEMA:START-->', '<!--AUTO-MENU-SCHEMA:END-->', '\n' + jsonLd(menuLd) + '\n', '</head>');

  fs.writeFileSync(MPATH, html);
  console.log('[ok]   menu.html (' + items.length + ' items)');
}

/* ===================== 4. locations.html ===================== */

const LPATH = path.join(ROOT, 'locations.html');
if (fs.existsSync(LPATH)) {
  let html = fs.readFileSync(LPATH, 'utf8');
  let items = readItems('content/locations').filter(function (it) { return it.data && it.data.name; });
  items.sort(function (a, b) {
    const fa = a.data.store_type === 'Flagship' ? 0 : 1, fb = b.data.store_type === 'Flagship' ? 0 : 1;
    if (fa !== fb) return fa - fb;
    return (a.data.name || '').localeCompare(b.data.name || '');
  });
  const cards = items.map(function (it) {
    const d = it.data;
    const tag = d.store_type === 'Flagship' ? 'Flagship' : (d.state === 'NY' ? 'New York' : d.state === 'TX' ? 'Texas' : d.state === 'NJ' ? 'New Jersey' : (d.state || ''));
    const url = d.maps_url || ('https://www.google.com/maps/search/Ugly+Donuts+Corn+Dogs+' + encodeURIComponent((d.name || '') + ' ' + (d.city || '')));
    const photo = d.photo ? '<img src="' + d.photo + '" alt="' + attrEscape(d.name || '') + '">' : '<div class="location-detail-photo-placeholder">' + (d.name || '') + '</div>';
    let meta = '<div><strong>Type</strong>' + (d.store_type || '') + '</div>';
    if (d.address) meta += '<div><strong>Address</strong>' + d.address + '</div>';
    if (d.phone) meta += '<div><strong>Phone</strong>' + d.phone + '</div>';
    if (d.hours) meta += '<div><strong>Hours</strong>' + String(d.hours).replace(/\n/g, '<br>') + '</div>';
    return '<div class="location-detail"><div class="location-detail-photo">' + photo + '</div>' +
      '<div class="location-detail-info"><div class="tag">' + tag + '</div><h2>' + (d.name || '') + '</h2>' +
      '<div class="city">' + (d.city || '') + (d.state ? ', ' + d.state : '') + '</div>' +
      '<div class="location-detail-meta">' + meta + '</div>' +
      '<div class="location-detail-actions"><a href="' + url + '" target="_blank" rel="noopener" class="btn btn-outline">Get Directions</a>' +
      (d.order_url ? '<a href="' + d.order_url + '" target="_blank" rel="noopener" class="btn btn-primary">Order Online</a>' : '') +
      '</div></div></div>';
  }).join('\n');

  if (html.indexOf('<!--AUTO-LOC-CARDS:START-->') !== -1) {
    html = injectBetween(html, '<!--AUTO-LOC-CARDS:START-->', '<!--AUTO-LOC-CARDS:END-->', '\n' + cards + '\n', null);
  } else {
    html = setInner(html, /<div class="location-list" id="locations-list"[^>]*>/,
      '<!--AUTO-LOC-CARDS:START-->', '<!--AUTO-LOC-CARDS:END-->', cards);
  }

  // Restaurant + per-location department structured data, regenerated from markdown.
  const dept = items.map(function (it) {
    const d = it.data;
    const r = {
      '@type': 'Restaurant', name: 'Ugly Donuts & Corn Dogs - ' + (d.name || ''),
      servesCuisine: ['Korean Corn Dogs', 'Donuts'], priceRange: '$$', url: SITE + '/locations.html',
      address: { '@type': 'PostalAddress', streetAddress: d.address || '', addressLocality: d.city || '', addressRegion: d.state || '', addressCountry: 'US' }
    };
    if (d.photo) r.image = SITE + d.photo;
    if (d.maps_url) r.hasMap = d.maps_url;
    if (d.order_url) r.potentialAction = { '@type': 'OrderAction', target: d.order_url };
    return r;
  });
  const restLd = {
    '@context': 'https://schema.org', '@type': 'Restaurant', name: 'Ugly Donuts & Corn Dogs',
    description: 'Premium Korean corn dogs and fresh handmade donuts, made to order. Fried in 100% avocado oil.',
    url: SITE, servesCuisine: ['Korean', 'Korean Street Food', 'Korean Corn Dogs', 'Donuts'],
    priceRange: '$$', email: 'hq@uglydonutsncorndogs.com', image: OG_IMAGE, department: dept
  };
  if (html.indexOf('<!--AUTO-LOC-SCHEMA:START-->') === -1) {
    html = html.replace(/<script type="application\/ld\+json">[^<]*"department"[^<]*<\/script>\s*/, '');
  }
  html = injectBetween(html, '<!--AUTO-LOC-SCHEMA:START-->', '<!--AUTO-LOC-SCHEMA:END-->', '\n' + jsonLd(restLd) + '\n', '</head>');

  fs.writeFileSync(LPATH, html);
  console.log('[ok]   locations.html (' + items.length + ' locations)');
}

/* ===================== 5. sitemap.xml ===================== */

const SPATH = path.join(ROOT, 'sitemap.xml');
if (fs.existsSync(SPATH)) {
  let xml = fs.readFileSync(SPATH, 'utf8');
  const urls = articles.map(function (it) {
    const lastmod = (it.data.published_date || '').toString().slice(0, 10);
    return '  <url>\n    <loc>' + SITE + articleUrlPath(it.slug) + '</loc>\n' +
      (lastmod ? '    <lastmod>' + lastmod + '</lastmod>\n' : '') +
      '    <changefreq>yearly</changefreq>\n    <priority>0.5</priority>\n  </url>\n';
  }).join('');
  xml = injectBetween(xml, '<!--AUTO-ARTICLES:START-->', '<!--AUTO-ARTICLES:END-->', '\n' + urls, '</urlset>');
  fs.writeFileSync(SPATH, xml);
  console.log('[ok]   sitemap.xml (' + articles.length + ' article urls)');
}

/* ===================== 6. social meta + manifest (all listing pages) ===================== */

const SEO_PAGES = ['index.html', 'menu.html', 'locations.html', 'story.html', 'journal.html', 'faq.html',
  'careers.html', 'catering.html', 'contact.html', 'franchise.html',
  'privacy-policy.html', 'terms-of-service.html', 'refund-policy.html', 'accessibility.html'];
SEO_PAGES.forEach(function (p) {
  const fp = path.join(ROOT, p);
  if (!fs.existsSync(fp)) return;
  let html = fs.readFileSync(fp, 'utf8');
  const m = extractHead(html);
  html = stripSocial(html);
  html = ensureManifest(html);
  html = injectBetween(html, '<!--AUTO-SEO:START-->', '<!--AUTO-SEO:END-->', socialBlock(m, 'website'), '</head>');
  fs.writeFileSync(fp, html);
});
console.log('[ok]   social meta + manifest on ' + SEO_PAGES.length + ' pages');

/* ===================== 7. Organization + WebSite (index.html) ===================== */

(function () {
  const fp = path.join(ROOT, 'index.html');
  if (!fs.existsSync(fp)) return;
  let html = fs.readFileSync(fp, 'utf8');
  const org = {
    '@context': 'https://schema.org', '@type': 'Organization',
    name: 'Ugly Donuts & Corn Dogs', url: SITE,
    logo: SITE + '/images/favicon/android-chrome-512x512.png',
    image: OG_IMAGE, email: 'hq@uglydonutsncorndogs.com',
    sameAs: ['https://www.instagram.com/uglydonutsncorndogs']
  };
  const web = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Ugly Donuts & Corn Dogs', url: SITE };
  const block = '\n' + jsonLd(org) + '\n' + jsonLd(web) + '\n';
  html = injectBetween(html, '<!--AUTO-ORG-SCHEMA:START-->', '<!--AUTO-ORG-SCHEMA:END-->', block, '</head>');
  fs.writeFileSync(fp, html);
  console.log('[ok]   Organization + WebSite schema on index.html');
})();

/* ===================== 8. FAQ internal link (footer) + sitemap ===================== */

glob_html().forEach(function (p) {
  const fp = path.join(ROOT, p);
  let html = fs.readFileSync(fp, 'utf8');
  if (html.indexOf('<li><a href="/journal.html">Journal</a></li>') === -1) return;
  if (html.indexOf('<li><a href="/faq.html">FAQ</a></li>') !== -1) return;
  html = html.replace('<li><a href="/journal.html">Journal</a></li>',
    '<li><a href="/journal.html">Journal</a></li>\n          <li><a href="/faq.html">FAQ</a></li>');
  fs.writeFileSync(fp, html);
});
(function () {
  const sp = path.join(ROOT, 'sitemap.xml');
  if (!fs.existsSync(sp)) return;
  let xml = fs.readFileSync(sp, 'utf8');
  if (xml.indexOf('/faq.html') === -1) {
    const entry = '  <url>\n    <loc>' + SITE + '/faq.html</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>\n';
    const anchor = xml.indexOf('<!--AUTO-ARTICLES:START-->');
    if (anchor !== -1) xml = xml.slice(0, anchor) + entry + xml.slice(anchor);
    else xml = xml.replace('</urlset>', entry + '</urlset>');
    fs.writeFileSync(sp, xml);
  }
})();
console.log('[ok]   FAQ internal links + sitemap entry');

console.log('Build complete.');
