/* ════════════════════════════════════════════════════════
   twitter-archive.marcomaroni.it — App JavaScript
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

  USERNAME:      'marcomaroni',
  ACCOUNT_ID:    '15570883',
};

// ═══════════════════════════════════════════════════════
// DOM REFS (populated in init)
// ═══════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
async function init() {
  try {
    let manifest = window.ARCHIVE_MANIFEST;
    if (!manifest) {
      manifest = await fetchJSON('data/manifest.json');
    }
    App.profile     = manifest.profile;
    App.years       = manifest.years;       // already newest-first from script
    App.tweetCounts = manifest.tweetCounts;
    App.totalTweets = manifest.totalTweets;
    App.USERNAME    = manifest.profile.username || 'marcomaroni';

    renderProfile();
    renderYearNav();
    bindEvents();

    // Load the most recent year by default
    const latestYear = App.years[0];
    await selectYear(latestYear);

  } catch (err) {
    console.error('Init failed:', err);
    $('tweet-list').innerHTML = `
      <div class="loading-placeholder">
        <p style="color:#e0245e">Errore nel caricamento dell'archivio.<br>
        Controlla che i file in <code>docs/data/</code> esistano.</p>
      </div>`;
  }
}

// ═══════════════════════════════════════════════════════
// FETCH HELPERS
// ═══════════════════════════════════════════════════════
async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${url}`);
  return resp.json();
}

// ═══════════════════════════════════════════════════════
// PROFILE RENDERING
// ═══════════════════════════════════════════════════════
function renderProfile() {
  const p = App.profile;

  // Name & username
  $('profile-name').textContent     = p.displayName || 'Marco Maroni';
  $('profile-username').textContent = '@' + (p.username || 'marcomaroni');

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
    sinceEl.innerHTML = `📅 Membro dal ${formatMonthYear(d)}`;
  }

  // Avatar
  const avatarEl = $('profile-avatar');
  if (p.avatarLocal) {
    avatarEl.src = p.avatarLocal;
    avatarEl.onerror = () => {
      avatarEl.src = p.avatarUrl || 'assets/images/defaultAvatar.svg';
      avatarEl.onerror = () => { avatarEl.src = 'assets/images/defaultAvatar.svg'; };
    };
  } else if (p.avatarUrl) {
    avatarEl.src = p.avatarUrl;
    avatarEl.onerror = () => { avatarEl.src = 'assets/images/defaultAvatar.svg'; };
  }

  // Header banner — use local file if available
  const headerEl = $('profile-header');
  // The header image is the one NOT containing 'edpovFA7' (which is the avatar)
  // Local header: assets/images/15570883-1702049469.jpg
  const headerLocal = 'assets/images/15570883-1702049469.jpg';
  headerEl.src = headerLocal;
  headerEl.onerror = () => { headerEl.style.display = 'none'; };


  // Stats
  $('stat-tweets').textContent = App.totalTweets.toLocaleString('it-IT');
}

// ═══════════════════════════════════════════════════════
// YEAR NAVIGATION
// ═══════════════════════════════════════════════════════
function renderYearNav() {
  const nav = $('year-nav');
  nav.innerHTML = '';

  // "All years" item
  const totalCount = App.totalTweets;
  nav.appendChild(makeYearItem('Tutti gli anni', totalCount, 'all'));

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
    <span class="year-count">${count.toLocaleString('it-IT')}</span>
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
  showStatus('Caricamento…');

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

  // Try loading via script tag first (works seamlessly on file:// without CORS issues)
  try {
    await loadScript(`data/tweets-${key}.js`);
    const tweets = (window.ARCHIVE_TWEETS && window.ARCHIVE_TWEETS[key]) || [];
    App.loadedYears.set(key, tweets);
    return;
  } catch (scriptErr) {
    // Fallback to fetch (for pure HTTP environments if .json exists)
    try {
      const tweets = await fetchJSON(`data/tweets-${key}.json`);
      App.loadedYears.set(key, tweets);
    } catch (err) {
      console.warn(`Could not load tweets for ${key}:`, err);
      App.loadedYears.set(key, []); // empty to avoid retry
    }
  }
}

async function loadAllYears() {
  showStatus('Caricamento tutti gli anni…');
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
    showStatus('Ricerca in corso…');
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
      ? `Nessun tweet trovato per "${App.searchQuery}"`
      : 'Nessun tweet disponibile.';
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
  if (App.searchQuery) {
    showStatus(`${filtered.length.toLocaleString('it-IT')} risultat${filtered.length === 1 ? 'o' : 'i'} per "${App.searchQuery}"`);
  } else {
    const yearLabel = App.currentYear === 'all' ? 'in tutti gli anni' : `nel ${App.currentYear}`;
    showStatus(`${filtered.length.toLocaleString('it-IT')} tweet ${yearLabel}`);
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
  const isSelfReply  = tweet.in_reply_to_screen_name &&
                       tweet.in_reply_to_screen_name.toLowerCase() === App.USERNAME.toLowerCase();

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
  const avatarSrc = App.profile?.avatarLocal
    ? App.profile.avatarLocal
    : (App.profile?.avatarUrl || 'assets/images/defaultAvatar.svg');

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
            <span>Retweet di @${escHtml(rtAuthor || '')}</span>
          </div>` : ''}
        ${isSelfReply ? `
          <div class="tweet-thread-label">
            🧵 Risposta nel thread
          </div>` : ''}
        <div class="tweet-header">
          <span class="tweet-display-name">${escHtml(App.profile?.displayName || 'Marco Maroni')}</span>
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
        <div class="tweet-text">${renderText(tweetText, tweet.urls, tweet.hashtags)}</div>
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
function renderText(rawText, urls, hashtags) {
  // 1. Escape HTML first (rawText was already html.unescape'd in Node script)
  let text = escHtml(rawText);

  // 2. Replace t.co URLs with display links
  if (urls && urls.length) {
    for (const u of urls) {
      if (!u.url) continue;
      const escapedTco  = escHtml(u.url);
      const expandedUrl = escAttr(u.expanded_url || u.url);
      const displayUrl  = escHtml(u.display_url || u.url);
      // Replace all occurrences (some tweets link same URL twice)
      text = text.split(escapedTco).join(
        `<a href="${expandedUrl}" target="_blank" rel="noopener noreferrer">${displayUrl}</a>`
      );
    }
  }

  // 3. Remove remaining t.co URLs (they're media attachment links)
  text = text.replace(/https:\/\/t\.co\/\w{6,}/g, '').trim();

  // 4. Convert @mentions to links (not inside existing href attributes)
  text = text.replace(/(?<![="])@(\w+)/g, (_, name) =>
    `<a href="https://twitter.com/${name}" target="_blank" rel="noopener noreferrer" class="mention">@${name}</a>`
  );

  // 5. Convert #hashtags to in-site search links
  text = text.replace(/(?<![=&\w])#(\w+)/g, (_, tag) =>
    `<a href="javascript:void(0)" onclick="searchTag('${tag.replace(/'/g, "\\'")}')" class="hashtag">#${tag}</a>`
  );

  return text;
}

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
      <img src="${escAttr(src)}" alt="Foto del tweet" loading="lazy"
           onerror="this.parentNode.innerHTML='<div class=\'media-fallback-icon\'>🖼️ Immagine non disponibile</div>'">
    </div>`;
  }

  if (m.type === 'video' || m.type === 'animated_gif') {
    const videoSrc = m.local || m.video_url || '';
    const loop     = m.type === 'animated_gif' ? 'loop muted autoplay' : 'controls';
    if (videoSrc) {
      return `<div class="${itemClass}">
        <video ${loop} preload="none" playsinline
               onerror="this.parentNode.innerHTML='<div class=\'media-fallback-icon\'>🎬 Video non disponibile</div>'">
          <source src="${escAttr(videoSrc)}">
        </video>
      </div>`;
    }
    // Video without local file — show placeholder
    return `<div class="${itemClass}">
      <div class="media-fallback-icon">🎬 Video (non disponibile localmente)</div>
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
      <span class="tweet-stat tweet-stat-rt${rt > 0 ? ' has-count' : ''}" title="${rt.toLocaleString('it-IT')} Retweet">
        ${svgRetweet()}
        <span class="stat-num">${rt.toLocaleString('it-IT')}</span>
      </span>
      <span class="tweet-stat tweet-stat-fav${fav > 0 ? ' has-count' : ''}" title="${fav.toLocaleString('it-IT')} Like">
        ${svgHeart()}
        <span class="stat-num">${fav.toLocaleString('it-IT')}</span>
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
  const d   = new Date(isoStr);
  const now = new Date();
  const diffMs  = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffH   = Math.floor(diffMs / 3600000);
  const diffD   = Math.floor(diffMs / 86400000);

  // For an archive that's 2+ years old, always show the date
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateFull(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString('it-IT', {
    weekday: 'long', year: 'numeric', month: 'long',
    day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function formatMonthYear(d) {
  return d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
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
