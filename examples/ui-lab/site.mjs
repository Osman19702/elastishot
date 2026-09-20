/**
 * "Lumen", a small product page rendered in ten builds. Build 1 is the
 * approved baseline; every later build changes the page in one family of
 * ways (new elements, text, shifts, expansions, images, columns that grow
 * on their own) or mixes them like a real release. `BUILDS` is the ground
 * truth the lab checks Elastishot against: every entry names the element
 * (by data-testid) and the kind of change a tester would expect to see
 * reported.
 *
 * A build is compared with build 1 unless it says `before`. Build 10 changes
 * a card that build 9 introduced, so build 9 is what it is compared with,
 * and builds 1 to 8 stay the pages they were: a region's score is relative
 * to the page's area, and a taller page 1 would move every number the lab
 * has reported so far.
 */

export const BUILDS = [
  { n: 1, name: 'baseline', title: 'Build 1 — baseline', summary: 'The approved page.', expected: [] },
  {
    n: 2,
    name: 'new-elements',
    title: 'Build 2 — new elements',
    summary: 'A promo banner above the navigation, a fifth feature card, a new nav link and an Enterprise plan.',
    expected: [
      { testid: 'promo', kind: 'added', what: 'promo banner above the nav' },
      { testid: 'nav-community', kind: 'added', what: 'new "Community" nav link' },
      { testid: 'feature-5', kind: 'added', what: 'fifth feature card in the grid' },
      { testid: 'plan-enterprise', kind: 'added', what: 'Enterprise plan card' },
    ],
  },
  {
    n: 3,
    name: 'text-changes',
    title: 'Build 3 — characters',
    summary: 'One digit in the version badge, a price, a renamed button, an appended sentence, a fixed typo and a stat.',
    expected: [
      { testid: 'version', kind: 'changed', what: 'v2.4.1 → v2.4.2' },
      { testid: 'plan-team-price', kind: 'changed', what: '$29 → $39' },
      { testid: 'cta', kind: 'changed', what: '"Start free" → "Start free trial"' },
      { testid: 'hero-copy', kind: 'changed', what: 'sentence appended' },
      { testid: 'feature-2-text', kind: 'changed', what: 'typo fixed: recieve → receive' },
      { testid: 'stat-uptime', kind: 'changed', what: '99.95% → 99.99%' },
    ],
  },
  {
    n: 4,
    name: 'shifts',
    title: 'Build 4 — shifts and moves',
    summary: 'The hero illustration moves to the left, two feature cards swap places, the pricing section moves above the features and the stat cards spread out.',
    expected: [
      { testid: 'hero-image', kind: 'moved', what: 'illustration now on the left' },
      { testid: 'feature-1', kind: 'moved', what: 'swapped with feature 3' },
      { testid: 'feature-3', kind: 'moved', what: 'swapped with feature 1' },
      { testid: 'pricing', kind: 'moved', what: 'section moved above the features' },
      { testid: 'stat-latency', kind: 'moved', what: 'stat cards spread out by 48 px' },
    ],
  },
  {
    n: 5,
    name: 'expansions',
    title: 'Build 5 — expansions',
    summary: 'Every FAQ answer is open, the changelog has three more rows, the hero is taller and one feature text wraps to another line.',
    expected: [
      { testid: 'faq-2', kind: 'changed', what: 'FAQ item opened, answer visible' },
      { testid: 'faq-3', kind: 'changed', what: 'FAQ item opened, answer visible' },
      { testid: 'faq-4', kind: 'changed', what: 'FAQ item opened, answer visible' },
      { testid: 'changelog-row-5', kind: 'added', what: 'changelog row' },
      { testid: 'changelog-row-6', kind: 'added', what: 'changelog row' },
      { testid: 'changelog-row-7', kind: 'added', what: 'changelog row' },
      { testid: 'feature-4-text', kind: 'changed', what: 'longer text, one more line' },
    ],
  },
  {
    n: 6,
    name: 'images',
    title: 'Build 6 — images',
    summary: 'The hero illustration changes colour and gains a shape, a feature icon is swapped and the sparkline chart shows new data.',
    expected: [
      { testid: 'hero-image', kind: 'changed', what: 'illustration recoloured with a new shape' },
      { testid: 'feature-3-icon', kind: 'changed', what: 'icon swapped' },
      { testid: 'spark', kind: 'changed', what: 'sparkline data changed' },
    ],
  },
  {
    n: 7,
    name: 'release',
    title: 'Build 7 — a realistic release',
    summary: 'A promo banner, a bumped version, one FAQ answer opened, a new sparkline and a renamed button, all at once.',
    expected: [
      { testid: 'promo', kind: 'added', what: 'promo banner' },
      { testid: 'version', kind: 'changed', what: 'v2.4.1 → v2.5.0' },
      { testid: 'faq-2', kind: 'changed', what: 'FAQ item opened, answer visible' },
      { testid: 'spark', kind: 'changed', what: 'sparkline data changed' },
      { testid: 'cta', kind: 'changed', what: '"Start free" → "Get started"' },
    ],
  },
  {
    n: 8,
    name: 'columns',
    title: 'Build 8 — one column grows',
    summary: 'The hero copy gains a sentence and wraps to one more line; the illustration beside it stays. Everything below the hero moves down, the buttons under the copy move within their column.',
    expected: [{ testid: 'hero-copy', kind: 'changed', what: 'sentence appended, one more line' }],
  },
  {
    n: 9,
    name: 'card-added',
    title: 'Build 9 — a release card',
    summary: 'A "Latest release" section appears between the pricing and the questions: a card with a picture across it and two columns of text below the picture.',
    expected: [{ testid: 'release', kind: 'added', what: 'release section with its card' }],
  },
  {
    n: 10,
    name: 'card-columns',
    before: 9,
    title: 'Build 10 — two columns under a redrawn picture',
    summary: 'Against build 9: the picture of the release card is redrawn in place at the same size; below it the notes gain a list item and a second note, and the details gain a line while a date and a checksum are edited in place. The two columns grow by different amounts.',
    expected: [
      { testid: 'release-shot', kind: 'changed', what: 'picture redrawn in place, same size' },
      { testid: 'release-item-export', kind: 'added', what: 'list item in the middle of the left column' },
      { testid: 'release-note-lock', kind: 'added', what: 'second note at the foot of the left column' },
      { testid: 'release-mirror', kind: 'added', what: 'new line in the right column' },
      { testid: 'release-date', kind: 'changed', what: '2 September → 9 September, in place above the new line' },
      { testid: 'release-hash', kind: 'changed', what: 'checksum edited in place below the new line' },
    ],
  },
]

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function heroSvg(variant) {
  const [sky, hill, sun, extra] = variant === 'b' ? ['#fde7c8', '#e2701a', '#b91c1c', true] : ['#dbe7ff', '#2f5bd8', '#f5b301', false]
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320" width="480" height="320">
<rect width="480" height="320" rx="16" fill="${sky}"/>
<circle cx="380" cy="80" r="36" fill="${sun}"/>
<path d="M0 250 C 120 170, 200 290, 320 210 S 440 230, 480 190 L480 320 L0 320 Z" fill="${hill}"/>
<rect x="60" y="110" width="150" height="90" rx="10" fill="#fff" opacity="0.9"/>
<rect x="76" y="126" width="118" height="10" rx="5" fill="${hill}"/>
<rect x="76" y="146" width="90" height="10" rx="5" fill="${hill}" opacity="0.6"/>
<rect x="76" y="166" width="104" height="10" rx="5" fill="${hill}" opacity="0.4"/>
${extra ? '<polygon points="250,60 290,130 210,130" fill="#0f766e"/>' : ''}
</svg>`
}

function sparkSvg(variant) {
  const pts = variant === 'b' ? '0,60 40,50 80,58 120,30 160,34 200,18 240,26 280,8' : '0,40 40,44 80,30 120,36 160,22 200,28 240,14 280,20'
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 70" width="280" height="70">
<polyline points="${pts}" fill="none" stroke="${variant === 'b' ? '#e2701a' : '#2f5bd8'}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>
</svg>`
}

// The release card's picture: a drawing of a Lumen board as wide as the
// card, so it lies across the gutter of the two columns below it, and dense
// there: the heat map has an edge every few pixels in most of its rows, the
// way the text of a real screenshot has. A picture that is flat where the
// gutter runs would leave the gutter blank over the whole page and hide what
// build 10 is for. Variant b is the same board captured again: the sidebar is
// open, another item is active, the tiles, the bars and the heat map show new
// numbers. No row of it is left as it was.
function boardSvg(variant) {
  const b = variant === 'b'
  const side = b ? 176 : 150
  const bars = b ? [96, 150, 118, 188, 140, 204] : [120, 104, 156, 96, 172, 134]
  const tiles = b ? [148, 96, 172] : [120, 164, 110]
  const shades = ['#22364d', '#2b4a73', '#2f5bd8', '#5f86ee', '#9db8ff']
  const menu = [0, 1, 2, 3, 4, 5].map((i) => `<rect x="20" y="${70 + i * 30}" width="${side - 60 - (i % 3) * 14}" height="8" rx="4" fill="${i === (b ? 3 : 1) ? '#7aa2ff' : '#3a4757'}"/>`).join('')
  const tileRects = tiles.map((w, i) => `<rect x="${200 + i * 256}" y="64" width="240" height="72" rx="8" fill="#1a2633"/><rect x="${216 + i * 256}" y="80" width="80" height="8" rx="4" fill="#5b6675"/><rect x="${216 + i * 256}" y="102" width="${w}" height="16" rx="4" fill="#e6ecfb"/>`).join('')
  const barRects = bars.map((h, i) => `<rect x="${216 + i * 34}" y="${388 - h}" width="22" height="${h}" rx="3" fill="${b && i === 5 ? '#f5b301' : '#2f5bd8'}"/>`).join('')
  const cells = []
  for (let row = 0; row < 18; row++) for (let col = 0; col < 44; col++) cells.push(`<rect x="${456 + col * 11}" y="${192 + row * 11}" width="9" height="9" fill="${shades[b ? (row * 3 + col * 4 + ((row * col) % 4) + 1) % 5 : (row * 7 + col * 3) % 5]}"/>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 982 420" width="982" height="420">
<rect width="982" height="420" rx="10" fill="#111a24"/>
<path d="M10 0H${side}V420H10A10 10 0 0 1 0 410V10A10 10 0 0 1 10 0Z" fill="#0a1017"/>
<circle cx="30" cy="30" r="10" fill="#2f5bd8"/><circle cx="30" cy="30" r="4" fill="#fff"/>
${menu}
<rect x="200" y="20" width="${b ? 210 : 160}" height="12" rx="6" fill="#e6ecfb"/>
<rect x="870" y="14" width="88" height="24" rx="6" fill="#2f5bd8"/>
${tileRects}
<rect x="200" y="152" width="224" height="252" rx="8" fill="#1a2633"/>
<rect x="216" y="168" width="96" height="8" rx="4" fill="#5b6675"/>
${barRects}
<rect x="440" y="152" width="518" height="252" rx="8" fill="#1a2633"/>
<rect x="456" y="168" width="${b ? 150 : 120}" height="8" rx="4" fill="#5b6675"/>
${cells.join('')}
</svg>`
}

const ICONS = {
  bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  shield: '<path d="M12 2 4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5z"/>',
  chart: '<path d="M4 20V10h3v10zm6 0V4h3v16zm6 0v-7h3v7z"/>',
  clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5h-2v6l5 3 1-1.7-4-2.3z"/>',
  globe: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm7.9 9h-3a15 15 0 0 0-1.3-5.4A8 8 0 0 1 19.9 11zM12 4c.9 1.2 1.9 3.6 2.3 7H9.7C10.1 7.6 11.1 5.2 12 4zM4.1 13h3a15 15 0 0 0 1.3 5.4A8 8 0 0 1 4.1 13zm3-2h-3a8 8 0 0 1 4.3-5.4A15 15 0 0 0 7.1 11zM12 20c-.9-1.2-1.9-3.6-2.3-7h4.6c-.4 3.4-1.4 5.8-2.3 7zm3.6-1.6a15 15 0 0 0 1.3-5.4h3a8 8 0 0 1-4.3 5.4z"/>',
  star: '<path d="m12 2 3 6.5 7 .8-5.2 4.8 1.4 7L12 17.5 5.8 21l1.4-7L2 9.3l7-.8z"/>',
}
const icon = (name, testid) => `<svg class="icon" ${testid ? `data-testid="${testid}"` : ''} viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">${ICONS[name]}</svg>`

/** The page for build `n`. Everything that differs between builds is decided here. */
export function render(n) {
  const promo = n === 2 || n === 7
  const text = n === 3
  const shifts = n === 4
  const expand = n === 5
  const images = n === 6
  const release = n === 7
  const columns = n === 8
  const hasCard = n >= 9
  const card = n === 10

  const version = text ? 'v2.4.2' : release ? 'v2.5.0' : 'v2.4.1'
  const cta = text ? 'Start free trial' : release ? 'Get started' : 'Start free'
  const heroCopy = `Lumen turns raw product events into answers your team can act on before the stand-up.${text ? ' Now with SSO.' : ''}${columns ? ' Every dashboard is shareable with a link that respects your access rules.' : ''}`
  const teamPrice = text ? 39 : 29
  const uptime = text ? '99.99%' : '99.95%'
  const heroVariant = images ? 'b' : 'a'
  const sparkVariant = images || release ? 'b' : 'a'
  const featureThreeIcon = images ? 'star' : 'chart'

  const features = [
    { id: 1, icon: 'bolt', title: 'Fast queries', text: 'Ad-hoc questions answer in under a second on a year of events.' },
    { id: 2, icon: 'shield', title: 'Private by default', text: `Events are pseudonymised on ingest and you ${text ? 'receive' : 'recieve'} a deletion receipt for every request.` },
    { id: 3, icon: featureThreeIcon, title: 'Live dashboards', text: 'Boards refresh as events arrive, no scheduled rebuilds.' },
    {
      id: 4,
      icon: 'clock',
      title: 'Retention rules',
      text: expand ? 'Keep what you need, drop the rest on a schedule you set per project, and audit every purge from the activity log.' : 'Keep what you need, drop the rest on a schedule you set per project.',
    },
  ]
  if (n === 2) features.push({ id: 5, icon: 'globe', title: 'Regions', text: 'Store data in the EU, the UK or the US and route each project separately.' })
  const order = shifts ? [features[2], features[1], features[0], ...features.slice(3)] : features
  const featureCards = order
    .map(
      (f) => `<article class="card feature" data-testid="feature-${f.id}">${icon(f.icon, `feature-${f.id}-icon`)}<h3>${esc(f.title)}</h3><p data-testid="feature-${f.id}-text">${esc(f.text)}</p></article>`,
    )
    .join('\n')

  const plans = [
    { id: 'free', name: 'Free', price: 0, note: 'for one project', items: ['100k events a month', '7-day retention', 'Community support'] },
    { id: 'team', name: 'Team', price: teamPrice, note: 'per seat, monthly', items: ['Unlimited projects', '13-month retention', 'SSO and audit log'] },
  ]
  if (n === 2) plans.push({ id: 'enterprise', name: 'Enterprise', price: 249, note: 'per month, billed yearly', items: ['Dedicated region', 'Custom retention', 'Named support engineer'] })
  const pricing = `<section class="section" id="pricing" data-testid="pricing">
<h2>Pricing</h2>
<div class="plans">
${plans
  .map(
    (p) => `<article class="card plan" data-testid="plan-${p.id}"><h3>${p.name}</h3><p class="price"><span data-testid="plan-${p.id}-price">$${p.price}</span> <small>${p.note}</small></p><ul>${p.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul><a class="btn ghost" href="#">Choose ${p.name}</a></article>`,
  )
  .join('\n')}
</div>
</section>`

  const featuresSection = `<section class="section" id="features">
<h2>Why teams switch</h2>
<div class="grid">
${featureCards}
</div>
</section>`

  const faqs = [
    ['How do you count events?', 'Every call to track() is one event; page views and identify calls are free.'],
    ['Can I export my data?', 'Yes, as Parquet files to your own bucket, nightly or on demand.'],
    ['Where is the data stored?', 'In the region you pick per project; nothing crosses regions.'],
    ['Is there an API?', 'Everything the dashboards show is available through the query API with the same permissions.'],
  ]
  const faq = `<section class="section" id="faq" data-testid="faq">
<h2>Questions</h2>
${faqs
  .map(
    ([q, a], i) =>
      `<details data-testid="faq-${i + 1}"${i === 0 || expand || (release && i === 1) ? ' open' : ''}><summary>${esc(q)}</summary><p data-testid="faq-answer-${i + 1}">${esc(a)}</p></details>`,
  )
  .join('\n')}
</section>`

  const rows = [
    ['2.4.1', '2026-09-02', 'Fixed: retention purge skipped archived projects'],
    ['2.4.0', '2026-08-19', 'New: saved views can be shared by link'],
    ['2.3.2', '2026-08-05', 'Fixed: sparkline tooltips off by one day'],
    ['2.3.1', '2026-07-22', 'Changed: exports default to Parquet'],
  ]
  if (expand) rows.push(['2.3.0', '2026-07-08', 'New: EU region'], ['2.2.4', '2026-06-24', 'Fixed: slow board load with 40+ tiles'], ['2.2.3', '2026-06-10', 'Changed: identify() merges traits'])
  const changelog = `<section class="section" id="changelog">
<h2>Changelog</h2>
<table data-testid="changelog"><thead><tr><th>Version</th><th>Date</th><th>Change</th></tr></thead><tbody>
${rows.map((r, i) => `<tr data-testid="changelog-row-${i + 1}"><td>${r[0]}</td><td>${r[1]}</td><td>${esc(r[2])}</td></tr>`).join('\n')}
</tbody></table>
</section>`

  // A card with a picture across it and two columns below, the columns
  // level at the top and free at the bottom. The heading between the
  // picture and the columns is the same in every build: it is the run of
  // unchanged rows that lets the columns' stretch end below the picture.
  const meta = [
    ['Version', '2.4.1'],
    ['Released', `<span data-testid="release-date">${card ? '9' : '2'} September 2026</span>`],
    ...(card ? [['Mirror', 'eu-west-1 and us-east-2', 'release-mirror']] : []),
    ['Size', '4.2 MB'],
    ['Checksum', `<code data-testid="release-hash">sha256 ${card ? 'c41d07e2b95a' : '8f3a90b16c7e'}</code>`],
    ['Requires', 'Agent 1.9 or newer'],
    ['Supported until', 'September 2027'],
  ]
  const releaseCard = `<section class="section" id="release" data-testid="release">
<h2>Latest release</h2>
<article class="card release-card">
<img class="release-shot" data-testid="release-shot" src="img/board.svg" width="982" height="420" alt="A Lumen board with three tiles, a bar chart and a heat map">
<h3>Lumen 2.4: saved views</h3>
<p class="release-sub">A board's filters, grouping and time range, kept under one name.</p>
<div class="release-cols">
<div class="release-notes" data-testid="release-notes">
<p>Open a board, set it up the way you read it and save it as a view. The next person starts where you stopped.</p>
<ul>
<li data-testid="release-item-share">Share a view by link; the link respects project roles.</li>
<li data-testid="release-item-pin">Pin up to five views to the project sidebar.</li>
${card ? '<li data-testid="release-item-export">Export the rows of a view as CSV or Parquet.</li>' : ''}
<li data-testid="release-item-default">Set a default view for each board.</li>
</ul>
<p class="note" data-testid="release-note">Views are stored with the project and count against no quota.</p>
${card ? '<p class="note" data-testid="release-note-lock">An admin can lock a view so that only admins change it.</p>' : ''}
</div>
<dl class="release-meta" data-testid="release-meta">
${meta.map(([k, v, testid]) => `<div${testid ? ` data-testid="${testid}"` : ''}><dt>${k}</dt><dd>${v}</dd></div>`).join('\n')}
</dl>
</div>
</article>
</section>`

  const hero = `<section class="hero${shifts ? ' hero-flip' : ''}${expand ? ' hero-tall' : ''}">
<div class="hero-text">
<span class="badge" data-testid="version">${version}</span>
<h1>Product analytics that explains itself</h1>
<p class="lead" data-testid="hero-copy">${esc(heroCopy)}</p>
<div class="actions"><a class="btn" href="#" data-testid="cta">${esc(cta)}</a><a class="btn ghost" href="#" data-testid="demo">Book a demo</a></div>
</div>
<img class="hero-img" data-testid="hero-image" src="img/hero.svg" width="480" height="320" alt="Illustration of a report card in front of hills">
</section>`

  const stats = `<section class="stats${shifts ? ' stats-wide' : ''}">
<div class="card stat" data-testid="stat-users"><span class="num">12,480</span><span class="label">teams on Lumen</span></div>
<div class="card stat" data-testid="stat-latency"><span class="num">640 ms</span><span class="label">median query</span></div>
<div class="card stat" data-testid="stat-uptime"><span class="num">${uptime}</span><span class="label">uptime, last 90 days</span></div>
<div class="card stat spark-card"><img data-testid="spark" src="img/spark.svg" width="280" height="70" alt="Weekly active teams, last eight weeks"><span class="label">weekly active teams</span></div>
</section>`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lumen — ${esc(BUILDS[n - 1].title)}</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
${promo ? '<div class="promo" data-testid="promo"><strong>Lumen Conf, 14 October</strong> · Early tickets are live until Friday. <a href="#">Get yours</a></div>' : ''}
<header class="nav">
<a class="logo" href="#" aria-label="Lumen home"><svg viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><circle cx="16" cy="16" r="14" fill="#2f5bd8"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg> Lumen</a>
<nav aria-label="Main"><a href="#features">Product</a><a href="#pricing">Pricing</a><a href="#faq">Docs</a><a href="#changelog">Changelog</a>${n === 2 ? '<a href="#" data-testid="nav-community">Community</a>' : ''}</nav>
<a class="btn small" href="#" data-testid="nav-cta">Sign in</a>
</header>
<main>
${hero}
${stats}
${shifts ? pricing + '\n' + featuresSection : featuresSection + '\n' + pricing}
${hasCard ? `${releaseCard}
` : ''}${faq}
${changelog}
</main>
<footer class="footer"><span>© 2026 Lumen, a fictional product for this lab</span><nav aria-label="Footer"><a href="#">Privacy</a><a href="#">Terms</a><a href="#">Status</a></nav></footer>
</body>
</html>
`
}

export const assets = (n) => ({
  'img/hero.svg': heroSvg(n === 6 ? 'b' : 'a'),
  'img/spark.svg': sparkSvg(n === 6 || n === 7 ? 'b' : 'a'),
  ...(n >= 9 ? { 'img/board.svg': boardSvg(n === 10 ? 'b' : 'a') } : {}),
})

export const STYLES = `
:root { --ink: #16202b; --muted: #5b6675; --line: #d9dee6; --accent: #2f5bd8; --accent-ink: #ffffff; --card: #ffffff; --ground: #f4f6fa; }
* { box-sizing: border-box; }
html { scroll-behavior: auto; }
body { margin: 0; background: var(--ground); color: var(--ink); font: 16px/1.5 "Segoe UI", Arial, sans-serif; }
a { color: var(--accent); text-decoration: none; }
.promo { background: #16202b; color: #fff; text-align: center; padding: 10px 16px; font-size: 14px; }
.promo a { color: #ffd166; font-weight: 600; }
.nav { display: flex; align-items: center; gap: 32px; padding: 16px 48px; background: var(--card); border-bottom: 1px solid var(--line); }
.nav nav { display: flex; gap: 24px; flex: 1; }
.nav nav a { color: var(--ink); font-weight: 500; }
.logo { display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 20px; color: var(--ink); }
.btn { display: inline-block; background: var(--accent); color: var(--accent-ink); padding: 12px 22px; border-radius: 8px; font-weight: 600; }
.btn.small { padding: 8px 16px; font-size: 14px; }
.btn.ghost { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
main { max-width: 1120px; margin: 0 auto; padding: 0 48px 64px; }
.hero { display: grid; grid-template-columns: 1fr 480px; gap: 48px; align-items: center; padding: 40px 0; }
.hero-flip .hero-img { order: -1; }
.hero-tall { padding: 96px 0; }
.hero h1 { font-size: 44px; line-height: 1.1; margin: 12px 0 16px; letter-spacing: -0.01em; }
.lead { font-size: 19px; color: var(--muted); margin: 0 0 24px; max-width: 34em; }
.actions { display: flex; gap: 12px; }
.badge { display: inline-block; background: #e6ecfb; color: var(--accent); font-size: 13px; font-weight: 600; padding: 4px 10px; border-radius: 999px; }
.hero-img { width: 480px; height: 320px; display: block; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 8px 0 48px; }
.stats-wide { gap: 64px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 20px; }
.stat { display: flex; flex-direction: column; gap: 4px; }
.stat .num { font-size: 28px; font-weight: 700; letter-spacing: -0.01em; }
.stat .label { color: var(--muted); font-size: 14px; }
.spark-card img { display: block; width: 100%; height: auto; }
.section { padding: 32px 0; }
.section h2 { font-size: 28px; margin: 0 0 20px; }
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
.feature h3 { margin: 12px 0 6px; font-size: 18px; }
.feature p { margin: 0; color: var(--muted); }
.icon { fill: var(--accent); }
.plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
.plan h3 { margin: 0 0 8px; }
.price { font-size: 32px; font-weight: 700; margin: 0 0 12px; }
.price small { font-size: 13px; font-weight: 400; color: var(--muted); }
.plan ul { margin: 0 0 16px; padding-left: 18px; color: var(--muted); }
.release-shot { display: block; width: 100%; height: auto; }
.release-card h3 { margin: 20px 0 4px; font-size: 20px; }
.release-sub { margin: 0 0 20px; color: var(--muted); }
.release-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: start; }
.release-notes p { margin: 0 0 12px; }
.release-notes ul { margin: 0 0 12px; padding-left: 18px; color: var(--muted); }
.release-notes .note { margin: 0 0 8px; font-size: 14px; color: var(--muted); }
.release-meta { margin: 0; }
.release-meta div { display: flex; justify-content: space-between; gap: 16px; padding: 6px 0; border-bottom: 1px solid var(--line); }
.release-meta dt { color: var(--muted); }
.release-meta dd { margin: 0; }
.release-meta code { font: 14px/24px Consolas, "Courier New", monospace; }
details { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px; margin-bottom: 10px; }
summary { font-weight: 600; cursor: pointer; }
details p { margin: 10px 0 0; color: var(--muted); }
table { width: 100%; border-collapse: collapse; background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--line); }
th { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
tr:last-child td { border-bottom: 0; }
.footer { display: flex; justify-content: space-between; padding: 24px 48px; border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; }
.footer nav { display: flex; gap: 16px; }
@media (max-width: 700px) { .nav { padding: 12px 16px; gap: 16px; } .nav nav { display: none; } main { padding: 0 16px 48px; } .hero { grid-template-columns: 1fr; padding: 24px 0; } .hero h1 { font-size: 32px; } .hero-img { width: 100%; height: auto; } .stats { grid-template-columns: 1fr 1fr; } .grid { grid-template-columns: 1fr; } .release-cols { grid-template-columns: 1fr; gap: 16px; } }
`
