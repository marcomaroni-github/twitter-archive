'use strict';

const fs = require('fs');
const path = require('path');
const { readManifest } = require('../archive/read');
const { parseYtd } = require('../archive/parse');
const { UserError } = require('../errors');

/**
 * Data types read ONLY to know what must never appear in the site.
 * The values stay inside this module: they are not returned to the pipeline or logged.
 */
const SENSITIVE_TYPES = {
  account: 'email',
  phoneNumber: 'phone',
  accountCreationIp: 'ip',
  ipAudit: 'ip',
};
const KEY_PATTERN = { email: /email/i, phone: /phone/i, ip: /ip$/i };
// '' = no extension (e.g. CNAME copied from extra/): treated as text.
const TEXT_EXT = new Set(['.html', '.js', '.css', '.json', '.txt', '']);

function stringLeaves(value, key, out) {
  if (typeof value === 'string') out.push([key, value]);
  else if (Array.isArray(value)) value.forEach((v) => stringLeaves(v, key, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) stringLeaves(v, k, out);
  }
  return out;
}

function collectSensitive(root) {
  const manifest = readManifest(root);
  const found = new Map();
  const add = (kind, value) => { if (value.length >= 5) found.set(`${kind}:${value}`, { kind, value }); };

  for (const [type, kind] of Object.entries(SENSITIVE_TYPES)) {
    const dataType = manifest.dataTypes && manifest.dataTypes[type];
    for (const file of (dataType && dataType.files) || []) {
      const full = path.join(root, file.fileName);
      if (!fs.existsSync(full)) continue;
      const entries = parseYtd(fs.readFileSync(full, 'utf8'), file.fileName);
      for (const [key, value] of stringLeaves(entries, '', [])) {
        if (!KEY_PATTERN[kind].test(key)) continue;
        add(kind, value.trim());
        if (kind === 'phone') add(kind, value.replace(/\D/g, ''));
      }
    }
  }
  return [...found.values()];
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matcher({ kind, value }) {
  const body = escapeRegExp(value);
  // Numbers must not be part of a longer number (e.g. an IP inside a version string).
  const source = kind === 'email' ? body : `(?<![\\d.])${body}(?![\\d]|\\.\\d)`;
  return new RegExp(source, 'i');
}

const matchersFor = (sensitive) => sensitive.map((s) => ({ kind: s.kind, re: matcher(s) }));

/** Kinds of sensitive values found in content, e.g. new Set(['email']). */
function kindsIn(content, matchers) {
  return new Set(matchers.filter((m) => m.re.test(content)).map((m) => m.kind));
}

/** Compile the matchers once: returns (text) => true if text contains a sensitive value (same rules as scanSite). */
function makeSensitiveTest(sensitive) {
  const matchers = matchersFor(sensitive);
  return (text) => kindsIn(String(text), matchers).size > 0;
}

/** One-off check; use makeSensitiveTest when checking many texts. */
function containsSensitive(text, sensitive) {
  return makeSensitiveTest(sensitive)(text);
}

function textFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...textFiles(full, base));
    else if (TEXT_EXT.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

function scanSite(siteDir, sensitive) {
  const matchers = matchersFor(sensitive);
  const findings = [];
  for (const file of textFiles(siteDir)) {
    const content = fs.readFileSync(file, 'utf8');
    const kinds = kindsIn(content, matchers);
    const rel = path.relative(siteDir, file).split(path.sep).join('/');
    for (const kind of kinds) findings.push({ kind, file: rel });
  }
  return findings;
}

function guardSite(siteDir, sensitive) {
  const findings = scanSite(siteDir, sensitive);
  if (findings.length === 0) return;
  fs.rmSync(siteDir, { recursive: true, force: true });
  const list = findings.map((f) => `your ${f.kind} in ${f.file}`).join(', ');
  throw new UserError(
    `Privacy check failed: found ${list}. The site folder was deleted.`,
    'This data was found in the generated files although tweets and profile fields containing it are hidden. ' +
      'Please report the problem (without sharing your data).'
  );
}

module.exports = { collectSensitive, containsSensitive, makeSensitiveTest, scanSite, guardSite };
