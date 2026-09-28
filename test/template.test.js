'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TPL = path.join(__dirname, '..', 'template');
const read = (rel) => fs.readFileSync(path.join(TPL, rel), 'utf8');
const it = JSON.parse(read('i18n/it.json'));
const en = JSON.parse(read('i18n/en.json'));

test('it and en have the same keys, all non-empty strings', () => {
  assert.deepEqual(Object.keys(it).sort(), Object.keys(en).sort());
  for (const dict of [it, en]) for (const [k, v] of Object.entries(dict)) {
    assert.equal(typeof v, 'string', k);
    assert.ok(v.length > 0, k);
  }
});

test('every {{t.key}} in index.html exists in i18n', () => {
  const keys = [...read('index.html').matchAll(/\{\{t\.(\w+)\}\}/g)].map((m) => m[1]);
  assert.ok(keys.length > 0);
  for (const k of keys) assert.ok(k in it, `missing i18n key: ${k}`);
});

test('every tr("key") in app.js exists in i18n', () => {
  const keys = [...read('assets/js/app.js').matchAll(/tr\('(\w+)'/g)].map((m) => m[1]);
  assert.ok(keys.length > 10);
  for (const k of keys) assert.ok(k in it, `missing i18n key: ${k}`);
});

test('app.js is valid JavaScript', () => {
  assert.doesNotThrow(() => new vm.Script(read('assets/js/app.js')));
});

test('template contains no reference to a specific owner or locale', () => {
  for (const rel of ['index.html', 'assets/js/app.js', 'assets/css/style.css']) {
    const src = read(rel);
    for (const needle of ['marcomaroni', 'Marco Maroni', '15570883', 'it-IT', 'edpovFA7', '1702049469']) {
      assert.ok(!src.includes(needle), `${rel} contains ${needle}`);
    }
  }
});
