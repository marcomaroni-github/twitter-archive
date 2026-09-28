'use strict';

const fs = require('fs');
const { UserError } = require('./errors');

const LANGS = ['it', 'en'];
const FIELDS = ['lang', 'title', 'includeRetweets', 'includeReplies', 'noindex', 'website'];

function detectLang(tweets) {
  const counts = {};
  for (const t of tweets) if (t.lang) counts[t.lang] = (counts[t.lang] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top && top[0] === 'it' ? 'it' : 'en';
}

function titleFor(lang, displayName) {
  return lang === 'it' ? `${displayName} — Archivio Twitter` : `${displayName} — Twitter archive`;
}

function defaultConfig(archive) {
  const lang = detectLang(archive.tweets);
  return {
    lang,
    title: titleFor(lang, archive.user.displayName),
    includeRetweets: false,
    includeReplies: false,
    noindex: true,
    website: '',
  };
}

const VALID = {
  lang: (v) => LANGS.includes(v),
  title: (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= 200,
  includeRetweets: (v) => typeof v === 'boolean',
  includeReplies: (v) => typeof v === 'boolean',
  noindex: (v) => typeof v === 'boolean',
  website: (v) => v === '' || (typeof v === 'string' && /^https?:\/\/\S+$/.test(v)),
};

function normalizeConfig(raw, defaults) {
  const config = {};
  const fixed = [];
  for (const field of FIELDS) {
    if (raw && VALID[field](raw[field])) {
      config[field] = typeof raw[field] === 'string' ? raw[field].trim() : raw[field];
    } else {
      config[field] = defaults[field];
      fixed.push(field);
    }
  }
  return { config, fixed };
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    throw new UserError('config.json is not valid JSON.', 'Delete config.json or run "npm run build -- --reconfigure".');
  }
}

function saveConfig(configPath, config) {
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

function buildQuestions(base, displayName) {
  const customTitle = base.title !== titleFor(base.lang, displayName);
  const yesNo = { active: 'yes', inactive: 'no' };
  return [
    {
      type: 'select', name: 'lang', message: 'Site language',
      choices: [{ title: 'Italiano', value: 'it' }, { title: 'English', value: 'en' }],
      initial: LANGS.indexOf(base.lang),
    },
    {
      type: 'text', name: 'title', message: 'Site title',
      initial: (prev, values) => (customTitle ? base.title : titleFor(values.lang || prev, displayName)),
    },
    { type: 'toggle', name: 'includeRetweets', message: 'Include retweets (content written by other people)?', initial: base.includeRetweets, ...yesNo },
    { type: 'toggle', name: 'includeReplies', message: 'Include your replies to other users?', initial: base.includeReplies, ...yesNo },
    { type: 'toggle', name: 'noindex', message: 'Hide the site from search engines?', initial: base.noindex, ...yesNo },
    {
      type: 'text', name: 'website', message: 'Website to show on your profile (leave empty for none)',
      initial: base.website,
      validate: (v) => v === '' || /^https?:\/\/\S+$/.test(v) || 'Must start with http:// or https://',
    },
  ];
}

async function resolveConfig({ configPath, archive, reconfigure, yes, prompt }) {
  const defaults = defaultConfig(archive);
  const existing = loadConfig(configPath);

  if (existing && !reconfigure) {
    const { config, fixed } = normalizeConfig(existing, defaults);
    if (fixed.length) saveConfig(configPath, config);
    return { config, fixed, asked: false };
  }

  const base = existing ? normalizeConfig(existing, defaults).config : defaults;
  if (yes) {
    saveConfig(configPath, base);
    return { config: base, fixed: [], asked: false };
  }

  const ask = prompt || require('prompts');
  const answers = await ask(buildQuestions(base, archive.user.displayName));
  if (!FIELDS.every((f) => f in answers)) {
    throw new UserError('Setup cancelled.', 'Run "npm run build" again when you are ready.');
  }
  const { config, fixed } = normalizeConfig(answers, base);
  saveConfig(configPath, config);
  return { config, fixed, asked: true };
}

module.exports = { detectLang, titleFor, defaultConfig, normalizeConfig, resolveConfig };
