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
    const { comments } = await adminApi('/api/admin/content');
    try { sessionStorage.setItem('terpbites-admin', password); } catch {}
    $('#login').hidden = true;
    $('#content').hidden = false;

    $('#comments').innerHTML = comments.map((c) => `
      <div class="comment"><b>${esc(c.author)}</b> on ${esc(c.food)}<time>${esc(c.created_at)}</time> <span class="meta">▲ ${c.votes}</span>
        ${c.body ? `<p>${esc(c.body)}</p>` : ''}
        ${c.photo ? `<a href="${esc(c.photo)}" target="_blank"><img class="comment-photo" src="${esc(c.photo)}" alt=""></a>` : ''}
        <button class="btn" data-comment="${c.id}">Delete${c.photo ? ' comment + photo' : ''}</button></div>`).join('') || '<p class="meta">No comments.</p>';

    document.querySelectorAll('[data-comment]').forEach((b) => b.onclick = async () => {
      if (!confirm('Delete this permanently?')) return;
      await adminApi(`/api/admin/comments/${b.dataset.comment}`, { method: 'DELETE' });
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
