'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const OWNER = { accountId: '1000', userName: 'testuser', displayName: 'Test User' };

const SENSITIVE = {
  email: 'secret.owner@example.com',
  phone: '+393331234567',
  creationIp: '203.0.113.7',
  loginIp: '198.51.100.23',
  dmMarker: 'DM_SECRET_MARKER',
};

function makeTmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function jpegSegment(marker, payload) {
  const head = Buffer.alloc(4);
  head[0] = 0xff;
  head[1] = marker;
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
}

/** Minimal JPEG-like buffer with APP0, APP1 (EXIF with GPS text), COM, DQT, SOS, scan data, EOI. */
function makeJpeg() {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSegment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')),
    jpegSegment(0xe1, Buffer.from('Exif\0\0GPSDATA-45.1,9.2', 'latin1')),
    jpegSegment(0xfe, Buffer.from('camera comment', 'latin1')),
    jpegSegment(0xdb, Buffer.alloc(65, 1)),
    jpegSegment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from('SCANDATA', 'latin1'),
    Buffer.from([0xff, 0xd9]),
  ]);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
}

/** Minimal PNG-like buffer with IHDR, tEXt (secret text), IDAT, IEND. */
function makePng() {
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', Buffer.alloc(13)),
    pngChunk('tEXt', Buffer.from('Comment\0secret text', 'latin1')),
    pngChunk('IDAT', Buffer.from('PIXELS', 'latin1')),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function rawTweet(fields) {
  const {
    id, date, text, hashtags = [], urls = [], mentions = [], media,
    replyStatus, replyUser, replyName,
  } = fields;
  const tweet = {
    edit_info: { initial: { editTweetIds: [id], editableUntil: '2020-01-01T00:00:00.000Z' } },
    retweeted: false,
    source: '<a href="http://twitter.com/download/android" rel="nofollow">Twitter for Android</a>',
    entities: {
      hashtags: hashtags.map((h) => ({ text: h, indices: ['0', '1'] })),
      symbols: [],
      user_mentions: mentions.map((m) => ({ ...m, id_str: '42', indices: ['0', '1'] })),
      urls,
    },
    display_text_range: ['0', String(text.length)],
    favorite_count: '3',
    id_str: id,
    id,
    retweet_count: '1',
    created_at: date,
    favorited: false,
    full_text: text,
    lang: 'it',
    geo: { type: 'Point', coordinates: ['45.1', '9.2'] },
    coordinates: { type: 'Point', coordinates: ['9.2', '45.1'] },
    place: { full_name: 'Milano, Lombardia' },
  };
  if (media) {
    tweet.entities.media = media;
    tweet.extended_entities = { media };
  }
  if (replyStatus) {
    tweet.in_reply_to_status_id_str = replyStatus;
    tweet.in_reply_to_status_id = replyStatus;
    tweet.in_reply_to_user_id_str = replyUser;
    tweet.in_reply_to_user_id = replyUser;
    tweet.in_reply_to_screen_name = replyName;
  }
  return { tweet };
}

function photo(url) {
  return { type: 'photo', media_url_https: url, media_url: url.replace('https', 'http'), url: 'https://t.co/media1' };
}

const TWEETS_PART0 = [
  rawTweet({
    id: '101', date: 'Thu Jan 02 10:00:00 +0000 2020',
    text: 'Hello world &amp; friends #test https://t.co/abc123 https://t.co/media1',
    hashtags: ['test'],
    urls: [{ url: 'https://t.co/abc123', expanded_url: 'https://example.org/page', display_url: 'example.org/page' }],
    media: [photo('https://pbs.twimg.com/media/photoA.jpg'), photo('https://pbs.twimg.com/media/diagram.png')],
  }),
  rawTweet({ id: '102', date: 'Fri Jan 03 10:00:00 +0000 2020', text: 'RT @other: someone else text' }),
  rawTweet({
    id: '103', date: 'Sat Jan 04 10:00:00 +0000 2020', text: '@other I agree',
    mentions: [{ name: 'Other Person', screen_name: 'other' }],
    replyStatus: '900', replyUser: '2000', replyName: 'other',
  }),
  rawTweet({
    id: '104', date: 'Thu Jan 02 10:05:00 +0000 2020', text: 'Second part of my thread',
    replyStatus: '101', replyUser: '1000', replyName: 'testuser',
  }),
];

const TWEETS_PART1 = [
  rawTweet({
    id: '105', date: 'Mon Mar 01 12:00:00 +0000 2021',
    text: 'This is a long post that gets truncated… https://t.co/long1',
  }),
  rawTweet({
    id: '106', date: 'Tue Mar 02 12:00:00 +0000 2021', text: 'Photo without file',
    media: [photo('https://pbs.twimg.com/media/missing.jpg')],
  }),
  rawTweet({
    id: '107', date: 'Wed Mar 03 12:00:00 +0000 2021', text: 'My video',
    media: [{
      type: 'video',
      media_url_https: 'https://pbs.twimg.com/ext_tw_video_thumb/107/pu/img/thumb.jpg',
      video_info: {
        variants: [
          { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/ext_tw_video/107/pu/pl/list.m3u8' },
          { content_type: 'video/mp4', bitrate: '256000', url: 'https://video.twimg.com/ext_tw_video/107/pu/vid/320x180/clipA.mp4?tag=12' },
          { content_type: 'video/mp4', bitrate: '832000', url: 'https://video.twimg.com/ext_tw_video/107/pu/vid/640x360/clipB.mp4?tag=12' },
        ],
      },
    }],
  }),
];

const NOTE_TEXT = 'This is a long post that gets truncated in the tweet but here it is complete, see https://t.co/n1';

function manifestFor(accountId) {
  const files = (name, fileName, count = '1') => ({ files: [{ fileName, globalName: `YTD.${name}.part0`, count }] });
  return {
    userInfo: { accountId, userName: OWNER.userName, displayName: OWNER.displayName },
    archiveInfo: { sizeBytes: '1000', generationDate: '2024-04-08T15:59:18.409Z', isPartialArchive: false },
    readmeInfo: { fileName: 'data/README.txt', directory: 'data/', name: 'README.txt' },
    dataTypes: {
      account: files('account', 'data/account.js'),
      accountCreationIp: files('account_creation_ip', 'data/account-creation-ip.js'),
      directMessages: { mediaDirectory: 'data/direct_messages_media', ...files('direct_messages', 'data/direct-messages.js') },
      ipAudit: files('ip_audit', 'data/ip-audit.js'),
      noteTweet: files('note_tweet', 'data/note-tweet.js'),
      phoneNumber: files('phone_number', 'data/phone-number.js'),
      profile: { mediaDirectory: 'data/profile_media', ...files('profile', 'data/profile.js') },
      tweets: {
        mediaDirectory: 'data/tweets_media',
        files: [
          { fileName: 'data/tweets.js', globalName: 'YTD.tweets.part0', count: '4' },
          { fileName: 'data/tweets-part1.js', globalName: 'YTD.tweets.part1', count: '3' },
        ],
      },
    },
  };
}

function ytd(name, part, entries) {
  return `window.YTD.${name}.part${part} = ${JSON.stringify(entries, null, 2)}`;
}

function createFixtureArchive(targetDir, overrides = {}) {
  const root = targetDir || makeTmpDir('fixture-archive');
  const accountId = overrides.accountId || OWNER.accountId;
  const data = path.join(root, 'data');
  const write = (rel, content) => {
    const full = path.join(data, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  };

  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(root, 'Your archive.html'), '<html>archive viewer</html>');
  write('manifest.js', `window.__THAR_CONFIG = ${JSON.stringify(manifestFor(accountId), null, 2)}`);
  write('tweets.js', ytd('tweets', 0, TWEETS_PART0));
  write('tweets-part1.js', ytd('tweets', 1, TWEETS_PART1));
  write('note-tweet.js', ytd('note_tweet', 0, [{
    noteTweet: {
      noteTweetId: '5000',
      createdAt: '2021-03-01T12:00:00.000Z',
      core: {
        text: NOTE_TEXT,
        urls: [{ shortUrl: 'https://t.co/n1', expandedUrl: 'https://example.org/full', displayUrl: 'example.org/full' }],
        mentions: [], hashtags: [], cashtags: [], styletags: [],
      },
    },
  }]));
  write('profile.js', ytd('profile', 0, [{
    profile: {
      description: { bio: 'I tweet things', website: 'https://t.co/prof1', location: 'Somewhere' },
      avatarMediaUrl: 'https://pbs.twimg.com/profile_images/1/avatarX.jpg',
      headerMediaUrl: `https://pbs.twimg.com/profile_banners/${accountId}/1600000000`,
    },
  }]));
  write('account.js', ytd('account', 0, [{
    account: {
      email: SENSITIVE.email, createdVia: 'web', username: OWNER.userName, accountId,
      createdAt: '2008-06-01T10:00:00.000Z', accountDisplayName: OWNER.displayName,
    },
  }]));
  write('phone-number.js', ytd('phone_number', 0, [{ device: { phoneNumber: SENSITIVE.phone } }]));
  write('account-creation-ip.js', ytd('account_creation_ip', 0, [{ accountCreationIp: { accountId, userCreationIp: SENSITIVE.creationIp } }]));
  write('ip-audit.js', ytd('ip_audit', 0, [{ ipAudit: { accountId, createdAt: '2024-01-01T00:00:00.000Z', loginIp: SENSITIVE.loginIp, loginPortNumber: '443' } }]));
  write('direct-messages.js', ytd('direct_messages', 0, [{ dmConversation: { conversationId: '1000-2000', messages: [{ messageCreate: { text: SENSITIVE.dmMarker } }] } }]));

  write('tweets_media/101-photoA.jpg', makeJpeg());
  write('tweets_media/101-diagram.png', makePng());
  write('tweets_media/107-clipB.mp4', Buffer.from('MP4DATA'));
  write('tweets_media/999-unused.jpg', makeJpeg());
  write(`profile_media/${accountId}-avatarX.jpg`, makeJpeg());
  write(`profile_media/${accountId}-1600000000.jpg`, makeJpeg());
  return root;
}

function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function zipDir(srcDir, outFile, only = () => true) {
  const yazl = require('yazl');
  const zip = new yazl.ZipFile();
  for (const rel of listFiles(srcDir)) {
    if (only(rel)) zip.addFile(path.join(srcDir, rel), rel);
  }
  return new Promise((resolve, reject) => {
    zip.outputStream.pipe(fs.createWriteStream(outFile)).on('close', resolve).on('error', reject);
    zip.end();
  });
}

module.exports = {
  OWNER, SENSITIVE, NOTE_TEXT,
  makeTmpDir, makeJpeg, makePng, createFixtureArchive, zipDir, listFiles,
};
