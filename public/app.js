const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The server issues a signed device id; we keep it so votes stay tied to this browser.
const TOKEN_KEY = 'terpbites-token';
let clientId = null;
try { clientId = localStorage.getItem(TOKEN_KEY); } catch {}

async function newClientId() {
  const res = await fetch('/api/session', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not start a session');
  clientId = data.clientId;
  try { localStorage.setItem(TOKEN_KEY, clientId); } catch {}
}

async function api(url, opts = {}, retried = false) {
  let res;
  try {
    if (!clientId) await newClientId();
    res = await fetch(url, { ...opts, headers: { 'X-Client-Id': clientId, ...(opts.headers || {}) } });
  } catch (e) {
    if (e instanceof TypeError) throw new Error("Can't reach the TerpBites server. Is it running? (npm start)");
    throw e;
  }
  if (res.status === 401 && !retried) {
    clientId = null;
    return api(url, opts, true);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

const state = { halls: [], hall: null, meal: null, data: null };

const starsText = (avg) => (avg ? '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg)) : '');
const isVeg = (t) => /vegan|vegetarian/i.test(t);
const shortTag = (t) => t.replace(/^Contains /i, '');

async function init() {
  try { localStorage.removeItem('terpbites-id'); } catch {} // old unsigned id
  state.halls = await api('/api/halls');
  state.hall = localStorage.getItem('terpbites-hall') || state.halls[0].id;
  renderHalls();
  loadMenu();
  $('#search').addEventListener('input', renderMenu);
  try { $('#sort').value = localStorage.getItem('terpbites-sort') || 'station'; } catch {}
  $('#sort').addEventListener('change', () => {
    try { localStorage.setItem('terpbites-sort', $('#sort').value); } catch {}
    renderMenu();
  });
}

function renderHalls() {
  $('#halls').innerHTML = state.halls.map((h) =>
    `<button role="tab" aria-selected="${h.id === state.hall}" data-id="${h.id}">${esc(h.name)}</button>`).join('');
  $('#halls').querySelectorAll('button').forEach((b) => b.onclick = () => {
    state.hall = b.dataset.id;
    state.meal = null;
    try { localStorage.setItem('terpbites-hall', state.hall); } catch {}
    renderHalls();
    loadMenu();
  });
}

async function loadMenu() {
  $('#menu').innerHTML = '<div class="empty">Loading menu…</div>';
  try {
    const params = new URLSearchParams({ hall: state.hall });
    if (state.meal) params.set('meal', state.meal);
    if (state.data?.date && state.meal) params.set('date', state.data.date);
    state.data = await api('/api/menu?' + params);
    state.meal = state.data.meal;
    renderNow();
    renderMenu();
  } catch (e) {
    $('#menu').innerHTML = `<div class="error">${esc(e.message)}</div>`;
  }
}

function renderNow() {
  const { now, hall, meals, meal, date } = state.data;
  const isNow = now.meal === meal && now.date === date;
  const pill = isNow ? `<span class="pill ${now.status}">${now.status === 'open' ? 'Serving now' : 'Up next'}</span>` : '';
  $('#now-text').innerHTML = `${pill}${esc(meal || 'No menu')} at ${esc(hall.name)} <span class="meta">· ${esc(date)}</span>`;
  $('#meals').innerHTML = meals.map((m) =>
    `<button class="${m === meal ? 'active' : ''}" data-m="${esc(m)}">${esc(m)}</button>`).join('');
  $('#meals').querySelectorAll('button').forEach((b) => b.onclick = () => { state.meal = b.dataset.m; loadMenu(); });
}

// Unrated items always go last, whichever direction ratings are sorted.
function byRating(dir) {
  return (a, b) => {
    if (!a.count || !b.count) return (b.count ? 1 : 0) - (a.count ? 1 : 0);
    return dir * (b.avg - a.avg) || b.count - a.count || a.name.localeCompare(b.name);
  };
}

function renderMenu() {
  if (!state.data) return;
  const term = $('#search').value.trim().toLowerCase();
  const sort = $('#sort').value;
  const match = (i) => !term || i.name.toLowerCase().includes(term);
  let html;

  if (sort.startsWith('rating')) {
    const items = state.data.stations
      .flatMap((st) => st.items.map((i) => ({ ...i, station: st.name })))
      .filter(match)
      .sort(byRating(sort === 'rating-desc' ? 1 : -1));
    html = items.length ? `<section class="station"><h2>All items by rating</h2><div class="items">${items.map(itemCard).join('')}</div></section>` : '';
  } else {
    const stations = sort === 'station-az'
      ? [...state.data.stations].sort((a, b) => a.name.localeCompare(b.name))
      : state.data.stations;
    html = stations.map((st) => {
      const items = st.items.filter(match);
      if (!items.length) return '';
      return `<section class="station"><h2>${esc(st.name)}</h2><div class="items">${items.map(itemCard).join('')}</div></section>`;
    }).join('');
  }
  $('#menu').innerHTML = html || '<div class="empty">Nothing on the menu here right now.</div>';
  $('#menu').querySelectorAll('.item').forEach((b) => b.onclick = () => openFood(b.dataset.id));
}

function itemCard(i) {
  const thumb = i.photo ? `<img class="thumb" src="${esc(i.photo)}" alt="">` : '<div class="thumb">🍽️</div>';
  const rating = i.count ? `<span class="stars-sm">${starsText(i.avg)}</span> ${i.avg} (${i.count})` : 'No ratings yet';
  const comments = i.commentCount ? ` · 💬 ${i.commentCount}` : '';
  const tags = i.tags.map((t) => `<span class="tag ${isVeg(t) ? 'v' : ''}">${esc(shortTag(t))}</span>`).join('');
  return `<button class="item" data-id="${esc(i.id)}">${thumb}<div>
    <div class="name">${esc(i.name)}</div>
    ${i.station ? `<div class="station-name">${esc(i.station)}</div>` : ''}
    <div class="meta">${rating}${comments}</div>
    <div class="tags">${tags}</div></div></button>`;
}

// ---- Food detail dialog ----
async function openFood(id) {
  const dlg = $('#food');
  $('#food-body').innerHTML = 'Loading…';
  if (!dlg.open) dlg.showModal();
  try {
    renderFood(await api(`/api/food/${encodeURIComponent(id)}`));
  } catch (e) {
    $('#food-body').innerHTML = `<p class="msg">${esc(e.message)}</p>`;
  }
}

function renderFood(f) {
  const item = state.data.stations.flatMap((s) => s.items).find((i) => i.id === f.id);
  const tags = (item?.tags || []).map((t) => `<span class="tag ${isVeg(t) ? 'v' : ''}">${esc(shortTag(t))}</span>`).join('');
  $('#food-body').innerHTML = `
    <h3>${esc(f.name)}</h3>
    <div class="tags">${tags}</div>
    ${item ? `<a class="label" href="${esc(item.labelUrl)}" target="_blank" rel="noopener">Nutrition facts ↗</a>` : ''}

    <div class="section-title">Your rating</div>
    <div class="rate">${[1, 2, 3, 4, 5].map((n) =>
      `<button data-n="${n}" class="${n <= (f.myRating || 0) ? 'on' : ''}" aria-label="${n} star">★</button>`).join('')}</div>
    <div class="meta" id="avg">${f.count ? `Average ${f.avg} / 5 from ${f.count} rating${f.count > 1 ? 's' : ''}` : 'Be the first to rate this'}</div>
    <div class="msg" id="rate-msg"></div>

    <div class="section-title">Photos</div>
    <div class="gallery">${f.photos.length
      ? f.photos.map((p) => `<a href="${esc(p.url)}" target="_blank"><img src="${esc(p.url)}" alt="Photo of ${esc(f.name)}"></a>`).join('')
      : '<span class="meta">No photos yet.</span>'}</div>
    <form class="upload" id="photo-form">
      <input type="file" name="photo" accept="image/*" required>
      <button class="btn">Upload</button><span class="msg" id="photo-msg"></span>
    </form>

    <div class="section-title">Comments (${f.comments.length})</div>
    <form class="comment-form" id="comment-form">
      <input name="author" maxlength="40" placeholder="Your name (optional)">
      <textarea name="body" maxlength="500" rows="2" placeholder="How was it?" required></textarea>
      <div><button class="btn">Post comment</button> <span class="msg" id="comment-msg"></span></div>
    </form>
    <div>${f.comments.map((c) => `<div class="comment"><b>${esc(c.author)}</b> <span class="tag" title="Same tag = same device">#${esc(c.tag)}</span><time>${esc(new Date(c.created_at + 'Z').toLocaleString())}</time><p>${esc(c.body)}</p></div>`).join('')}</div>`;

  const body = $('#food-body');
  body.querySelectorAll('.rate button').forEach((b) => b.onclick = async () => {
    try {
      const s = await api(`/api/food/${f.id}/rating`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stars: Number(b.dataset.n) }),
      });
      Object.assign(f, s);
      afterChange(f);
    } catch (err) { $('#rate-msg').textContent = err.message; }
  });

  $('#photo-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      const r = await api(`/api/food/${f.id}/photos`, { method: 'POST', body: new FormData(e.target) });
      f.photos = r.photos;
      f.photo = r.photos[0]?.url;
      afterChange(f);
    } catch (err) { $('#photo-msg').textContent = err.message; btn.disabled = false; }
  };

  $('#comment-form').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const r = await api(`/api/food/${f.id}/comments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author: fd.get('author'), body: fd.get('body') }),
      });
      f.comments = r.comments;
      f.commentCount = r.comments.length;
      afterChange(f);
    } catch (err) { $('#comment-msg').textContent = err.message; }
  };
}

// Re-render the dialog and refresh the matching card(s) in the menu.
function afterChange(f) {
  renderFood(f);
  state.data.stations.forEach((s) => s.items.forEach((i) => {
    if (i.id === f.id) Object.assign(i, { avg: f.avg, count: f.count, myRating: f.myRating, commentCount: f.commentCount, photo: f.photo });
  }));
  renderMenu();
}

init();
