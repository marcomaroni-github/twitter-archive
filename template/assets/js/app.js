/* ════════════════════════════════════════════════════════
   Twitter Archive Site — App JavaScript
   ════════════════════════════════════════════════════════ */

'use strict';

// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
const App = {
  profile:       null,     // from manifest
  years:         [],       // ['2024','2023',...] newest first
  tweetCounts:   {},       // { '2024': 1234, ... }
  totalTweets:   0,

  loadedYears:   new Map(),    // year string → tweet array (cache)
  currentYear:   null,         // 'all' | '2024' | ...
  displayTweets: [],           // tweets to display (after year/search filter)

  page:          0,
  pageSize:      50,
  searchQuery:   '',
  searchTimer:   null,

  USERNAME:      '',
  I18N:          window.ARCHIVE_I18N || {},
  LOCALE:        (window.ARCHIVE_I18N && window.ARCHIVE_I18N.locale) || 'en-US',
};

// ═══════════════════════════════════════════════════════
// I18N HELPERS
// ═══════════════════════════════════════════════════════
function tr(key, params) {
  let s = App.I18N[key] || key;
  for (const [k, v] of Object.entries(params || {})) s = s.split(`{${k}}`).join(String(v));
  return s;
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString(App.LOCALE);
}

// ═══════════════════════════════════════════════════════
// DOM REFS (populated in init)
// ═══════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
async function init() {
  try {
    const manifest = window.ARCHIVE_MANIFEST;
    if (!manifest) throw new Error('data/manifest.js not loaded');
    App.profile     = manifest.profile;
    App.years       = manifest.years;       // already newest-first from the build
    App.tweetCounts = manifest.tweetCounts;
    App.totalTweets = manifest.totalTweets;
    App.USERNAME    = manifest.profile.username || '';

    renderProfile();
    renderYearNav();
    bindEvents();

    if (App.years.length === 0) {
      App.displayTweets = [];
      renderTweetList();
      return;
    }

    // Load the most recent year by default
    await selectYear(App.years[0]);

  } catch (err) {
    console.error('Init failed:', err);
    $('tweet-list').innerHTML = `
      <div class="loading-placeholder">
        <p style="color:#e0245e">${escHtml(tr('loadError'))}</p>
      </div>`;
  }
}

// ═══════════════════════════════════════════════════════
// PROFILE RENDERING
// ═══════════════════════════════════════════════════════
function renderProfile() {
  const p = App.profile;

  // Name & username
  $('profile-name').textContent     = p.displayName || p.username || '';
  $('profile-username').textContent = '@' + (p.username || '');

  // Bio
  const bioEl = $('profile-bio');
  if (p.bio) { bioEl.textContent = p.bio; } else { bioEl.style.display = 'none'; }

  // Website
  const webEl = $('profile-website');
  if (p.website) {
    const display = p.website.replace(/^https?:\/\//, '').replace(/\/$/, '');
    webEl.innerHTML = `🔗 <a href="${escAttr(p.website)}" target="_blank" rel="noopener noreferrer">${escHtml(display)}</a>`;
  } else {
    webEl.style.display = 'none';
  }

  // "Member since"
  const sinceEl = $('profile-since');
  if (p.createdAt) {
    const d = new Date(p.createdAt);
    sinceEl.textContent = tr('memberSince', { date: formatMonthYear(d) });
  }

  // Avatar
  const avatarEl = $('profile-avatar');
  if (p.avatarLocal) {
    avatarEl.src = p.avatarLocal;
    avatarEl.onerror = () => { avatarEl.src = 'assets/images/defaultAvatar.svg'; };
  }

  // Header banner
  const headerEl = $('profile-header');
  if (p.headerLocal) {
    headerEl.src = p.headerLocal;
    headerEl.style.display = '';
    headerEl.onerror = () => { headerEl.style.display = 'none'; };
  }

  // Stats
  $('stat-tweets').textContent = fmtNum(App.totalTweets);
}

// ═══════════════════════════════════════════════════════
// YEAR NAVIGATION
// ═══════════════════════════════════════════════════════
function renderYearNav() {
  const nav = $('year-nav');
  nav.innerHTML = '';

  // "All years" item
  const totalCount = App.totalTweets;
  nav.appendChild(makeYearItem(tr('allYears'), totalCount, 'all'));

  // Per-year items
  for (const year of App.years) {
    const count = App.tweetCounts[year] || 0;
    nav.appendChild(makeYearItem(year, count, year));
  }
}

function makeYearItem(label, count, value) {
  const li = document.createElement('li');
  li.className = 'year-item';
  li.dataset.year = value;
  li.innerHTML = `
    <span class="year-label">${escHtml(String(label))}</span>
    <span class="year-count">${fmtNum(count)}</span>
  `;
  li.addEventListener('click', () => selectYear(value));
  return li;
}

function setActiveYear(value) {
  document.querySelectorAll('.year-item').forEach(el => {
    el.classList.toggle('active', el.dataset.year === String(value));
  });
}

// ═══════════════════════════════════════════════════════
// YEAR SELECTION & DATA LOADING
// ═══════════════════════════════════════════════════════
async function selectYear(year) {
  App.currentYear  = year;
  App.searchQuery  = '';
  App.page         = 0;

  const searchInput = $('search-input');
  if (searchInput) { searchInput.value = ''; }
  $('search-clear').style.display = 'none';

  setActiveYear(year);
  showStatus(tr('loading'));

  if (year === 'all') {
    await loadAllYears();
    // Merge all years sorted newest-first
    let all = [];
    for (const y of App.years) {
      const tweets = App.loadedYears.get(y) || [];
      all = all.concat(tweets);
    }
    // Already sorted within years (newest-first from script), merge is correct
    App.displayTweets = all;
  } else {
    await loadYear(year);
    App.displayTweets = App.loadedYears.get(String(year)) || [];
  }

  renderTweetList();
  window.scrollTo(0, 0);

  // Close mobile sidebar if open
  closeSidebar();
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      return resolve();
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = (e) => reject(e);
    document.head.appendChild(s);
  });
}

async function loadYear(year) {
  const key = String(year);
  if (App.loadedYears.has(key)) return; // cached

  if (window.ARCHIVE_TWEETS && window.ARCHIVE_TWEETS[key]) {
    App.loadedYears.set(key, window.ARCHIVE_TWEETS[key]);
    return;
  }

  // Script tags work both on file:// and over HTTP, without CORS issues
  try {
    await loadScript(`data/tweets-${key}.js`);
    const tweets = (window.ARCHIVE_TWEETS && window.ARCHIVE_TWEETS[key]) || [];
    App.loadedYears.set(key, tweets);
  } catch (err) {
    console.warn(`Could not load tweets for ${key}:`, err);
    App.loadedYears.set(key, []); // empty to avoid retry
  }
}

async function loadAllYears() {
  showStatus(tr('loadingAllYears'));
  await Promise.all(App.years.map(y => loadYear(y)));
}

// ═══════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════
function onSearchInput(e) {
  clearTimeout(App.searchTimer);
  const q = e.target.value.trim();
  $('search-clear').style.display = q ? 'block' : 'none';

  App.searchTimer = setTimeout(() => runSearch(q), 300);
}

async function runSearch(query) {
  App.searchQuery = query;
  App.page        = 0;

  if (query) {
    // If searching, ensure all years are loaded
    showStatus(tr('searching'));
    await loadAllYears();

    // Collect all tweets
    let all = [];
    for (const y of App.years) {
      all = all.concat(App.loadedYears.get(y) || []);
    }
    App.displayTweets = all;
    setActiveYear('all');
  } else {
    // Reset to current year (or all)
    await selectYear(App.currentYear || App.years[0]);
    return;
  }

  renderTweetList();
}

function searchTag(tag) {
  const input = $('search-input');
  input.value = '#' + tag;
  $('search-clear').style.display = 'block';
  runSearch('#' + tag);
}

function getFilteredTweets() {
  if (!App.searchQuery) return App.displayTweets;

  const q = App.searchQuery.toLowerCase();
  return App.displayTweets.filter(t => {
    const text     = (t.text || '').toLowerCase();
    const hashtags = (t.hashtags || []).join(' ').toLowerCase();
    const mentions = (t.mentions || []).map(m => m.screen_name).join(' ').toLowerCase();
    return text.includes(q) || hashtags.includes(q.replace('#','')) || mentions.includes(q.replace('@',''));
  });
}

// ═══════════════════════════════════════════════════════
// TWEET LIST RENDERING
// ═══════════════════════════════════════════════════════
function renderTweetList() {
  const filtered = getFilteredTweets();
  const end      = (App.page + 1) * App.pageSize;
  const slice    = filtered.slice(0, end);

  const list     = $('tweet-list');
  const noRes    = $('no-results');
  const lmWrap   = $('load-more-wrap');

  list.innerHTML = '';

  if (filtered.length === 0) {
    noRes.style.display = 'flex';
    $('no-results-msg').textContent = App.searchQuery
      ? tr('noResultsFor', { q: App.searchQuery })
      : tr('noTweets');
    lmWrap.style.display = 'none';
    clearStatus();
    return;
  }

  noRes.style.display = 'none';

  const frag = document.createDocumentFragment();
  for (const tweet of slice) {
    frag.appendChild(buildTweetCard(tweet));
  }
  list.appendChild(frag);

  // Load more button
  if (end < filtered.length) {
    lmWrap.style.display = 'block';
  } else {
    lmWrap.style.display = 'none';
  }

  // Status
  const n = fmtNum(filtered.length);
  if (App.searchQuery) {
    showStatus(tr(filtered.length === 1 ? 'resultsOne' : 'resultsMany', { n, q: App.searchQuery }));
  } else if (App.currentYear === 'all') {
    showStatus(tr('countAll', { n }));
  } else {
    showStatus(tr('countYear', { n, year: App.currentYear }));
  }
}

function loadMore() {
  App.page++;
  const filtered = getFilteredTweets();
  const end      = (App.page + 1) * App.pageSize;
  const slice    = filtered.slice(App.page * App.pageSize, end);
  const list     = $('tweet-list');
  const lmWrap   = $('load-more-wrap');

  const frag = document.createDocumentFragment();
  for (const tweet of slice) {
    frag.appendChild(buildTweetCard(tweet));
  }
  list.appendChild(frag);

  lmWrap.style.display = end < filtered.length ? 'block' : 'none';
}

// ═══════════════════════════════════════════════════════
// TWEET CARD BUILDER
// ═══════════════════════════════════════════════════════
function buildTweetCard(tweet) {
  const article = document.createElement('article');
  article.className = 'tweet';
  article.dataset.id = tweet.id;

  const isRT         = tweet.text && tweet.text.startsWith('RT @');
  // The build keeps in_reply_to_status_id only for replies to the owner's own tweets (threads)
  // and in_reply_to_screen_name only for replies to other users.
  const isSelfReply  = Boolean(tweet.in_reply_to_status_id);
  const replyToOther = tweet.in_reply_to_screen_name || null;

  if (isSelfReply) article.classList.add('is-thread-reply');

  let rtAuthor   = null;
  let tweetText  = tweet.text || '';

  // Extract RT author
  if (isRT) {
    const m = tweetText.match(/^RT @(\w+): ([\s\S]*)$/);
    if (m) { rtAuthor = m[1]; tweetText = m[2]; }
    else    { tweetText = tweetText.replace(/^RT @\w+: /, ''); }
  }

  // Avatar
  const avatarSrc = App.profile?.avatarLocal || 'assets/images/defaultAvatar.svg';

  // Build HTML
  article.innerHTML = `
    <div class="tweet-inner">
      <div class="tweet-avatar">
        <img src="${escAttr(avatarSrc)}" alt="Avatar" loading="lazy"
             onerror="this.src='assets/images/defaultAvatar.svg'">
      </div>
      <div class="tweet-body">
        ${isRT ? `
          <div class="tweet-rt-label">
            ${svgRetweet()}
            <span>${escHtml(tr('retweetOf', { user: rtAuthor || '' }))}</span>
          </div>` : ''}
        ${isSelfReply ? `
          <div class="tweet-thread-label">
            ${escHtml(tr('threadReply'))}
          </div>` : ''}
        ${replyToOther ? `
          <div class="tweet-thread-label">
            ${escHtml(tr('replyTo', { user: replyToOther }))}
          </div>` : ''}
        <div class="tweet-header">
          <span class="tweet-display-name">${escHtml(App.profile?.displayName || App.USERNAME)}</span>
          <span class="tweet-username">@${escHtml(App.USERNAME)}</span>
          <span class="tweet-date-sep">·</span>
          <span class="tweet-date">
            <a href="https://twitter.com/${escAttr(App.USERNAME)}/status/${escAttr(tweet.id)}"
               target="_blank" rel="noopener noreferrer"
               title="${escAttr(formatDateFull(tweet.created_at))}">
              ${escHtml(formatDateShort(tweet.created_at))}
            </a>
          </span>
        </div>
        <div class="tweet-text">${renderText(tweetText, tweet.urls)}</div>
        ${buildMediaHtml(tweet)}
        ${buildStatsHtml(tweet)}
      </div>
    </div>
  `;

  return article;
}

// ═══════════════════════════════════════════════════════
// TEXT RENDERING
// ═══════════════════════════════════════════════════════
const escRegExp = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SAFE_HREF = /^https?:\/\//i;

/**
 * Split plain tweet text (already entity-decoded by the build) into tokens, in one pass:
 *   { type: 'text', value }             plain text
 *   { type: 'url', href, display }      a t.co link with known target
 *   { type: 'mention', name }           @name
 *   { type: 'hashtag', tag }            #tag (Unicode letters, digits, underscore)
 * Unknown t.co links (media attachments) are dropped. Nothing here is HTML yet.
 */
function tokenizeText(rawText, urls) {
  const text = String(rawText || '');
  const known = new Map();
  for (const u of urls || []) if (u && u.url) known.set(u.url, u);

  const alternatives = [...known.keys()].sort((a, b) => b.length - a.length).map(escRegExp);
  alternatives.push('https:\\/\\/t\\.co\\/\\w{6,}');
  const re = new RegExp(
    `(${alternatives.join('|')})` +
      '|(?<![\\p{L}\\p{N}_&/])@(\\w+)' +
      '|(?<![\\p{L}\\p{N}_&/])#([\\p{L}\\p{N}_]+)',
    'gu'
  );

  const tokens = [];
  const pushText = value => { if (value) tokens.push({ type: 'text', value }); };
  let last = 0;
  for (const m of text.matchAll(re)) {
    pushText(text.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) {
      const u = known.get(m[1]);
      if (!u) continue; // unknown t.co link: dropped
      const href = SAFE_HREF.test(u.expanded_url || '') ? u.expanded_url : u.url;
      const display = u.display_url || u.url;
      if (SAFE_HREF.test(href)) tokens.push({ type: 'url', href, display });
      else pushText(display);
    } else if (m[2]) {
      tokens.push({ type: 'mention', name: m[2] });
    } else {
      tokens.push({ type: 'hashtag', tag: m[3] });
    }
  }
  pushText(text.slice(last));
  return tokens;
}

/** Tweet text as HTML: every piece is escaped, links only point to http(s). */
function renderText(rawText, urls) {
  return tokenizeText(rawText, urls).map(t => {
    switch (t.type) {
      case 'url':
        return `<a href="${escAttr(t.href)}" target="_blank" rel="noopener noreferrer">${escHtml(t.display)}</a>`;
      case 'mention':
        return `<a href="https://twitter.com/${escAttr(t.name)}" target="_blank" rel="noopener noreferrer" class="mention">@${escHtml(t.name)}</a>`;
      case 'hashtag':
        // Handled by the delegated click listener in bindEvents (in-site search).
        return `<a href="#" class="hashtag" data-tag="${escAttr(t.tag)}">#${escHtml(t.tag)}</a>`;
      default:
        return escHtml(t.value);
    }
  }).join('').trim();
}

// Pure text helpers, exposed for the tests (no effect on the page).
window.ArchiveText = { tokenizeText, renderText };

// ═══════════════════════════════════════════════════════
// MEDIA RENDERING
// ═══════════════════════════════════════════════════════
function buildMediaHtml(tweet) {
  const media = tweet.media;
  if (!media || media.length === 0) return '';

  const gridClass = media.length === 1 ? '' :
                    media.length === 2 ? ' media-grid-2' :
                    media.length === 3 ? ' media-grid-3' : ' media-grid-4';

  const itemClass = media.length === 1 ? 'media-item single' : 'media-item';

  const items = media.map(m => buildMediaItem(m, itemClass)).join('');

  return `<div class="tweet-media${gridClass}">${items}</div>`;
}

function buildMediaItem(m, itemClass) {
  const src = m.local || m.url || '';
  if (!src) return '';

  if (m.type === 'photo') {
    return `<div class="${itemClass}">
      <img src="${escAttr(src)}" alt="${escAttr(tr('photoAlt'))}" loading="lazy"
           onerror="this.parentNode.innerHTML='<div class=\'media-fallback-icon\'>${escAttr(tr('imageUnavailable'))}</div>'">
    </div>`;
  }

  if (m.type === 'video' || m.type === 'animated_gif') {
    const videoSrc = m.local || m.video_url || '';
    const loop     = m.type === 'animated_gif' ? 'loop muted autoplay' : 'controls';
    if (videoSrc) {
      return `<div class="${itemClass}">
        <video ${loop} preload="none" playsinline
               onerror="this.parentNode.innerHTML='<div class=\'media-fallback-icon\'>${escAttr(tr('videoUnavailable'))}</div>'">
          <source src="${escAttr(videoSrc)}">
        </video>
      </div>`;
    }
    // Video without local file — show placeholder
    return `<div class="${itemClass}">
      <div class="media-fallback-icon">${escHtml(tr('videoNotLocal'))}</div>
    </div>`;
  }

  return '';
}

// ═══════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════
function buildStatsHtml(tweet) {
  const rt  = tweet.retweet_count  || 0;
  const fav = tweet.favorite_count || 0;

  return `
    <div class="tweet-stats">
      <span class="tweet-stat tweet-stat-rt${rt > 0 ? ' has-count' : ''}" title="${fmtNum(rt)} ${escAttr(tr('retweets'))}">
        ${svgRetweet()}
        <span class="stat-num">${fmtNum(rt)}</span>
      </span>
      <span class="tweet-stat tweet-stat-fav${fav > 0 ? ' has-count' : ''}" title="${fmtNum(fav)} ${escAttr(tr('likes'))}">
        ${svgHeart()}
        <span class="stat-num">${fmtNum(fav)}</span>
      </span>
    </div>
  `;
}

// ═══════════════════════════════════════════════════════
// SVG ICONS
// ═══════════════════════════════════════════════════════
function svgRetweet() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">
    <g><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"/></g>
  </svg>`;
}

function svgHeart() {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">
    <g><path d="M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z"/></g>
  </svg>`;
}

// ═══════════════════════════════════════════════════════
// DATE HELPERS
// ═══════════════════════════════════════════════════════
function formatDateShort(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleDateString(App.LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateFull(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleString(App.LOCALE, {
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function formatMonthYear(d) {
  return d.toLocaleDateString(App.LOCALE, { month: 'long', year: 'numeric' });
}

// ═══════════════════════════════════════════════════════
// ESCAPING HELPERS
// ═══════════════════════════════════════════════════════
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ═══════════════════════════════════════════════════════
// STATUS BAR
// ═══════════════════════════════════════════════════════
function showStatus(msg) {
  const el = $('status-bar');
  if (el) el.textContent = msg;
}

function clearStatus() {
  const el = $('status-bar');
  if (el) el.textContent = '';
}

// ═══════════════════════════════════════════════════════
// MOBILE SIDEBAR
// ═══════════════════════════════════════════════════════
let overlay = null;

function openSidebar() {
  const sidebar = document.querySelector('.sidebar');
  sidebar.classList.add('open');

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', closeSidebar);
  }
  overlay.classList.add('active');
}

function closeSidebar() {
  const sidebar = document.querySelector('.sidebar');
  sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('active');
}

// ═══════════════════════════════════════════════════════
// EVENT BINDING
// ═══════════════════════════════════════════════════════
function bindEvents() {
  // Search
  const searchInput = $('search-input');
  if (searchInput) searchInput.addEventListener('input', onSearchInput);

  // Search clear
  const clearBtn = $('search-clear');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    $('search-input').value = '';
    $('search-clear').style.display = 'none';
    runSearch('');
  });

  // Hashtag links: in-site search (the tag is read from data-tag, never run as code)
  document.addEventListener('click', e => {
    const link = e.target.closest && e.target.closest('a.hashtag[data-tag]');
    if (!link) return;
    e.preventDefault();
    searchTag(link.dataset.tag);
  });

  // Load more
  const lmBtn = $('load-more');
  if (lmBtn) lmBtn.addEventListener('click', loadMore);

  // Mobile toggle
  const toggle = $('sidebar-toggle');
  if (toggle) toggle.addEventListener('click', openSidebar);
}

// ═══════════════════════════════════════════════════════
// BOOTSTRAP
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);
