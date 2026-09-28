'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { detectLang, titleFor, defaultConfig, normalizeConfig, resolveConfig } = require('../src/wizard');
const { UserError } = require('../src/errors');
const { makeTmpDir } = require('./helpers/fixture');

const archive = {
  user: { displayName: 'Test User' },
  tweets: [{ lang: 'it' }, { lang: 'it' }, { lang: 'en' }],
};
const configPath = () => path.join(makeTmpDir('cfg'), 'config.json');
const noPrompt = async () => { throw new Error('prompt must not be called'); };

test('detectLang picks it only when Italian is the most frequent language', () => {
  assert.equal(detectLang([{ lang: 'it' }, { lang: 'it' }, { lang: 'en' }]), 'it');
  assert.equal(detectLang([{ lang: 'en' }, { lang: 'it' }, { lang: 'en' }]), 'en');
  assert.equal(detectLang([{ lang: 'es' }]), 'en');
  assert.equal(detectLang([]), 'en');
});

test('defaultConfig uses privacy-first defaults', () => {
  assert.deepEqual(defaultConfig(archive), {
    lang: 'it', title: 'Test User — Archivio Twitter',
    includeRetweets: false, includeReplies: false, noindex: true, website: '',
  });
  assert.equal(titleFor('en', 'Ann'), 'Ann — Twitter archive');
});

test('normalizeConfig fixes invalid fields and reports them', () => {
  const defaults = defaultConfig(archive);
  const { config, fixed } = normalizeConfig(
    { lang: 'fr', title: '', includeRetweets: 'yes', includeReplies: true, noindex: false, website: 'example.org' },
    defaults
  );
  assert.deepEqual(config, { ...defaults, includeReplies: true, noindex: false });
  assert.deepEqual(fixed.sort(), ['includeRetweets', 'lang', 'title', 'website']);
});

test('--yes without config.json writes and returns the defaults', async () => {
  const file = configPath();
  const r = await resolveConfig({ configPath: file, archive, reconfigure: false, yes: true, prompt: noPrompt });
  assert.deepEqual(r.config, defaultConfig(archive));
  assert.equal(r.asked, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), r.config);
});

test('an existing config.json is reused without questions', async () => {
  const file = configPath();
  fs.writeFileSync(file, JSON.stringify({ lang: 'en', title: 'Mine', includeRetweets: true, includeReplies: false, noindex: true, website: '' }));
  const r = await resolveConfig({ configPath: file, archive, reconfigure: false, yes: false, prompt: noPrompt });
  assert.equal(r.config.title, 'Mine');
  assert.equal(r.config.includeRetweets, true);
  assert.equal(r.asked, false);
});

test('an unreadable config.json is a UserError', async () => {
  const file = configPath();
  fs.writeFileSync(file, '{ not json');
  await assert.rejects(resolveConfig({ configPath: file, archive, reconfigure: false, yes: false, prompt: noPrompt }), UserError);
});

test('first run asks the questions and saves the answers', async () => {
  const file = configPath();
  let questions;
  const prompt = async (qs) => {
    questions = qs;
    return { lang: 'en', title: 'Hello', includeRetweets: false, includeReplies: true, noindex: true, website: '' };
  };
  const r = await resolveConfig({ configPath: file, archive, reconfigure: false, yes: false, prompt });
  assert.equal(r.asked, true);
  assert.deepEqual(questions.map((q) => q.name), ['lang', 'title', 'includeRetweets', 'includeReplies', 'noindex', 'website']);
  const titleQ = questions.find((q) => q.name === 'title');
  assert.equal(titleQ.initial('en', { lang: 'en' }), 'Test User — Twitter archive');
  assert.equal(r.config.includeReplies, true);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).title, 'Hello');
});

test('--reconfigure asks again starting from the saved values', async () => {
  const file = configPath();
  fs.writeFileSync(file, JSON.stringify({ ...defaultConfig(archive), website: 'https://saved.example' }));
  let websiteInitial;
  const prompt = async (qs) => {
    websiteInitial = qs.find((q) => q.name === 'website').initial;
    return { ...defaultConfig(archive), website: '' };
  };
  const r = await resolveConfig({ configPath: file, archive, reconfigure: true, yes: false, prompt });
  assert.equal(websiteInitial, 'https://saved.example');
  assert.equal(r.config.website, '');
});

test('cancelling the questions is a UserError', async () => {
  const prompt = async () => ({ lang: 'it' }); // prompts returns partial answers on Ctrl+C
  await assert.rejects(resolveConfig({ configPath: configPath(), archive, reconfigure: false, yes: false, prompt }), UserError);
});
