'use strict';

const fs = require('fs');
const path = require('path');

function prepareSiteDir(siteDir) {
  fs.rmSync(siteDir, { recursive: true, force: true });
  fs.mkdirSync(siteDir, { recursive: true });
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fill(str, params) {
  let s = str;
  for (const [k, v] of Object.entries(params)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

function renderTemplate(html, values, rawValues) {
  return html
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, key) => {
      if (!(key in rawValues)) throw new Error(`Unknown raw placeholder in template: ${key}`);
      return rawValues[key];
    })
    .replace(/\{\{([\w.]+)\}\}/g, (_, key) => {
      if (!(key in values)) throw new Error(`Unknown placeholder in template: ${key}`);
      return escHtml(values[key]);
    });
}

function loadI18n(templateDir, lang) {
  return JSON.parse(fs.readFileSync(path.join(templateDir, 'i18n', `${lang}.json`), 'utf8'));
}

function formatMonthYear(iso, locale) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(d);
}

function groupByYear(tweets) {
  const byYear = {};
  for (const t of tweets) {
    const year = (t.created_at || '').slice(0, 4) || 'unknown';
    (byYear[year] = byYear[year] || []).push(t);
  }
  for (const list of Object.values(byYear)) list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return byYear;
}

function writeData(siteDir, byYear, manifest) {
  const dataDir = path.join(siteDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  for (const [year, list] of Object.entries(byYear)) {
    fs.writeFileSync(
      path.join(dataDir, `tweets-${year}.js`),
      `window.ARCHIVE_TWEETS = window.ARCHIVE_TWEETS || {};\nwindow.ARCHIVE_TWEETS[${JSON.stringify(year)}] = ${JSON.stringify(list)};\n`
    );
  }
  fs.writeFileSync(path.join(dataDir, 'manifest.js'), `window.ARCHIVE_MANIFEST = ${JSON.stringify(manifest, null, 2)};\n`);
}

function writeSite({ siteDir, templateDir, archive, config, tweets, images }) {
  const i18n = loadI18n(templateDir, config.lang);
  const byYear = groupByYear(tweets);
  const years = Object.keys(byYear).sort().reverse();
  const tweetCounts = Object.fromEntries(years.map((y) => [y, byYear[y].length]));
  const username = archive.user.userName;

  writeData(siteDir, byYear, {
    profile: {
      username,
      displayName: archive.user.displayName,
      createdAt: archive.account.createdAt,
      bio: archive.profile.bio,
      website: config.website,
      location: archive.profile.location,
      avatarLocal: images.avatar,
      headerLocal: images.header,
    },
    years,
    tweetCounts,
    totalTweets: tweets.length,
    lang: config.lang,
    exportedAt: archive.generationDate,
    generatedAt: new Date().toISOString(),
  });

  fs.cpSync(path.join(templateDir, 'assets'), path.join(siteDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(siteDir, 'assets', 'js', 'i18n.js'), `window.ARCHIVE_I18N = ${JSON.stringify(i18n, null, 2)};\n`);

  const values = {
    lang: config.lang,
    title: config.title,
    description: fill(i18n.metaDescription, { user: username }),
    displayName: archive.user.displayName,
    username,
    footerArchive: fill(i18n.footerArchive, { user: username }),
    footerExported: fill(i18n.footerExported, { date: formatMonthYear(archive.generationDate, i18n.locale) }),
  };
  for (const [k, v] of Object.entries(i18n)) values[`t.${k}`] = v;
  const robotsMeta = config.noindex ? '<meta name="robots" content="noindex, nofollow">' : '';
  const html = fs.readFileSync(path.join(templateDir, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(siteDir, 'index.html'), renderTemplate(html, values, { robotsMeta }));

  return { years, tweetCounts };
}

module.exports = { prepareSiteDir, renderTemplate, writeSite };
