'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { stripMetadata } = require('../src/pipeline/strip');
const { makeJpeg, makePng } = require('./helpers/fixture');

const hasMarker = (buf, a, b) => {
  for (let i = 0; i < buf.length - 1; i++) if (buf[i] === a && buf[i + 1] === b) return true;
  return false;
};

test('JPEG: removes EXIF (APP1) and comments, keeps the rest', () => {
  const out = stripMetadata(makeJpeg());
  assert.ok(!hasMarker(out, 0xff, 0xe1), 'APP1 still present');
  assert.ok(!hasMarker(out, 0xff, 0xfe), 'COM still present');
  assert.ok(!out.toString('latin1').includes('GPSDATA'));
  assert.ok(out.toString('latin1').includes('JFIF'));
  assert.ok(out.toString('latin1').includes('SCANDATA'));
  assert.deepEqual([...out.subarray(0, 2)], [0xff, 0xd8]);
  assert.deepEqual([...out.subarray(-2)], [0xff, 0xd9]);
});

test('PNG: removes text chunks, keeps image chunks', () => {
  const out = stripMetadata(makePng()).toString('latin1');
  assert.ok(!out.includes('tEXt'));
  assert.ok(!out.includes('secret text'));
  assert.ok(out.includes('IHDR') && out.includes('IDAT') && out.includes('IEND'));
});

test('unrecognized or truncated data is returned unchanged', () => {
  const mp4 = Buffer.from('MP4DATA');
  assert.equal(stripMetadata(mp4), mp4);
  const truncated = makeJpeg().subarray(0, 10);
  assert.equal(stripMetadata(truncated), truncated);
});
