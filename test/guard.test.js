'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { collectSensitive, scanSite, guardSite, containsSensitive } = require('../src/privacy/guard');
const { UserError } = require('../src/errors');
const { createFixtureArchive, makeTmpDir, SENSITIVE } = require('./helpers/fixture');

function siteWith(files) {
  const dir = makeTmpDir('site');
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

test('collects email, phone (also digits only) and IPs', () => {
  const values = collectSensitive(createFixtureArchive());
  const has = (kind, value) => values.some((v) => v.kind === kind && v.value === value);
  assert.ok(has('email', SENSITIVE.email));
  assert.ok(has('phone', SENSITIVE.phone));
  assert.ok(has('phone', '393331234567'));
  assert.ok(has('ip', SENSITIVE.creationIp));
  assert.ok(has('ip', SENSITIVE.loginIp));
});

test('skips sensitive files that are missing', () => {
  const root = createFixtureArchive();
  fs.rmSync(path.join(root, 'data', 'phone-number.js'));
  fs.rmSync(path.join(root, 'data', 'ip-audit.js'));
  const kinds = collectSensitive(root).map((v) => v.kind);
  assert.ok(!kinds.includes('phone'));
  assert.ok(kinds.includes('email'));
});

test('scanSite finds values case-insensitively in text files only', () => {
  const sensitive = collectSensitive(createFixtureArchive());
  const site = siteWith({
    'index.html': '<p>clean</p>',
    'data/tweets-2020.js': `window.X = "${SENSITIVE.email.toUpperCase()}"`,
    'tweets_media/a.jpg': SENSITIVE.email,
  });
  assert.deepEqual(scanSite(site, sensitive), [{ kind: 'email', file: 'data/tweets-2020.js' }]);
});

test('IP and phone matches respect number boundaries', () => {
  const sensitive = [{ kind: 'ip', value: '1.2.3.4' }];
  assert.deepEqual(scanSite(siteWith({ 'a.js': 'version 11.2.3.45' }), sensitive), []);
  assert.equal(scanSite(siteWith({ 'a.js': 'ip 1.2.3.4.' }), sensitive).length, 1);
});

test('guardSite deletes the site and throws without revealing the value', () => {
  const sensitive = collectSensitive(createFixtureArchive());
  const site = siteWith({ 'data/manifest.js': `phone: ${SENSITIVE.phone}` });
  assert.throws(() => guardSite(site, sensitive), (err) => {
    assert.ok(err instanceof UserError);
    assert.match(err.message, /phone/);
    assert.match(err.message, /data\/manifest\.js/);
    assert.ok(!err.message.includes(SENSITIVE.phone));
    assert.ok(!err.message.includes('393331234567'));
    assert.ok(!err.hint.includes('393331234567'));
    assert.doesNotMatch(err.hint, /cannot be published/);
    return true;
  });
  assert.ok(!fs.existsSync(site));
});

test('guardSite passes on a clean site', () => {
  const site = siteWith({ 'index.html': '<p>ok</p>' });
  guardSite(site, collectSensitive(createFixtureArchive()));
  assert.ok(fs.existsSync(site));
});

test('containsSensitive uses the same matching rules as scanSite', () => {
  const sensitive = collectSensitive(createFixtureArchive());
  assert.equal(containsSensitive(`mail me at ${SENSITIVE.email.toUpperCase()}`, sensitive), true);
  assert.equal(containsSensitive(`call ${SENSITIVE.phone}`, sensitive), true);
  assert.equal(containsSensitive('nothing private here', sensitive), false);
  const ip = [{ kind: 'ip', value: '1.2.3.4' }];
  assert.equal(containsSensitive('version 11.2.3.45', ip), false);
  assert.equal(containsSensitive('ip 1.2.3.4.', ip), true);
  assert.equal(containsSensitive('anything', []), false);
});
