'use strict';

const { UserError } = require('../errors');

const UNSUPPORTED_HINT =
  'This tool supports the Twitter archive format of April 2024 ' +
  '(data/manifest.js starting with "window.__THAR_CONFIG").';

/** Split "prefix = json" into [prefix, parsed json]. Returns null on failure. */
function splitAssignment(content) {
  const eq = content.indexOf('=');
  if (eq === -1) return null;
  const prefix = content.slice(0, eq).trim();
  const body = content.slice(eq + 1).trim().replace(/;\s*$/, '');
  try {
    return [prefix, JSON.parse(body)];
  } catch {
    return null;
  }
}

function parseManifest(content) {
  const parts = splitAssignment(content);
  if (!parts || parts[0] !== 'window.__THAR_CONFIG' || typeof parts[1] !== 'object') {
    throw new UserError('Unsupported archive format: data/manifest.js is not recognized.', UNSUPPORTED_HINT);
  }
  return parts[1];
}

function parseYtd(content, label) {
  const parts = splitAssignment(content);
  if (!parts || !parts[0].startsWith('window.YTD.') || !Array.isArray(parts[1])) {
    throw new UserError(`Unsupported archive format: cannot read ${label}.`, UNSUPPORTED_HINT);
  }
  return parts[1];
}

module.exports = { parseManifest, parseYtd };
