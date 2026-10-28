const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let password = '';
try { password = sessionStorage.getItem('terpbites-admin') || ''; } catch {}

async function adminApi(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${password}` } });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function load() {
  try {
    const { comments, photos } = await adminApi('/api/admin/content');
    try { sessionStorage.setItem('terpbites-admin', password); } catch {}
    $('#login').hidden = true;
    $('#content').hidden = false;

    $('#photos').innerHTML = photos.map((p) => `
      <figure><a href="${esc(p.url)}" target="_blank"><img src="${esc(p.url)}" alt=""></a>
        <figcaption>${esc(p.food)}<br><span class="meta">${esc(p.created_at)}</span></figcaption>
        <button class="btn" data-photo="${p.id}">Delete</button></figure>`).join('') || '<p class="meta">No photos.</p>';

    $('#comments').innerHTML = comments.map((c) => `
      <div class="comment"><b>${esc(c.author)}</b> on ${esc(c.food)}<time>${esc(c.created_at)}</time>
        <p>${esc(c.body)}</p><button class="btn" data-comment="${c.id}">Delete</button></div>`).join('') || '<p class="meta">No comments.</p>';

    document.querySelectorAll('[data-photo], [data-comment]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this permanently?')) return;
      const kind = b.dataset.photo ? 'photos' : 'comments';
      await adminApi(`/api/admin/${kind}/${b.dataset.photo || b.dataset.comment}`, { method: 'DELETE' });
      load();
    });
  } catch (e) {
    $('#login').hidden = false;
    $('#content').hidden = true;
    $('#login-msg').textContent = password ? e.message : '';
  }
}

$('#login').onsubmit = (e) => {
  e.preventDefault();
  password = $('#password').value;
  load();
};

load();
