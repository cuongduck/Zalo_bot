'use strict';

// --- Tabs ---
document.querySelectorAll('.tabs button[data-tab]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    var pane = document.getElementById('tab-' + btn.dataset.tab);
    if (pane) pane.classList.add('active');
    if (btn.dataset.tab === 'logs' && window.__botId) loadLogs(window.__botId);
  });
});

// --- Copy on click ---
document.querySelectorAll('.copy').forEach(function (el) {
  el.addEventListener('click', function () {
    var val = el.value !== undefined ? el.value : el.textContent;
    navigator.clipboard.writeText(val).then(function () {
      var prev = el.style.borderColor;
      el.style.borderColor = '#29c779';
      setTimeout(() => (el.style.borderColor = prev), 700);
    });
  });
});

function show(id, data) {
  var el = document.getElementById(id);
  if (!el) return;
  el.style.display = 'block';
  el.textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return res.json();
}

// --- Test send ---
async function testSend(botId) {
  const chat_id = document.getElementById('test-chat').value.trim();
  const text = document.getElementById('test-text').value;
  show('test-result', 'Đang gửi...');
  try {
    const r = await postJSON('/bots/' + botId + '/test-send', { chat_id, text });
    show('test-result', r.ok ? '✅ Đã gửi!\n' + JSON.stringify(r.result, null, 2) : '❌ ' + r.message);
  } catch (e) {
    show('test-result', '❌ ' + e.message);
  }
}

// --- Webhook info ---
async function webhookInfo(botId) {
  show('webhook-info', 'Đang kiểm tra...');
  try {
    const res = await fetch('/bots/' + botId + '/webhook-info');
    const r = await res.json();
    show('webhook-info', r.ok ? r.info : '❌ ' + r.message);
  } catch (e) {
    show('webhook-info', '❌ ' + e.message);
  }
}

// --- Logs refresh ---
async function loadLogs(botId) {
  try {
    const res = await fetch('/bots/' + botId + '/logs?limit=100');
    const r = await res.json();
    const box = document.getElementById('logbox');
    if (!box) return;
    if (!r.logs.length) {
      box.innerHTML = '<div class="muted">Chưa có log nào.</div>';
      return;
    }
    box.innerHTML = r.logs
      .map(function (l) {
        const cls = l.direction === 'in' ? 'blue' : l.direction === 'out' ? 'green' : l.direction === 'error' ? 'red' : 'grey';
        const t = new Date(l.created_at).toLocaleString('vi-VN');
        return (
          '<div class="log-line log-' + l.direction + '">' +
          '<span class="muted">' + t + '</span>' +
          '<span class="tag ' + cls + '">' + l.direction + '</span>' +
          '<span>' + esc(l.event_type || '') + (l.chat_id ? ' · chat:' + esc(l.chat_id) : '') + (l.from_name ? ' · ' + esc(l.from_name) : '') + '</span>' +
          '<span>' + esc(l.content || '') + '</span>' +
          '</div>'
        );
      })
      .join('');
  } catch (e) {
    /* ignore */
  }
}

// --- Datasource test ---
async function dsTest(id) {
  show('ds-result', 'Đang kết nối...');
  try {
    const r = await postJSON('/datasources/' + id + '/test', {});
    show('ds-result', r.ok ? '✅ ' + r.message + '\n' + JSON.stringify(r.sample, null, 2) : '❌ ' + r.message);
  } catch (e) {
    show('ds-result', '❌ ' + e.message);
  }
}

function dsPort(sel) {
  const p = document.getElementById('ds-port');
  if (p && !p.value) p.value = sel.value === 'mssql' ? '1433' : '3306';
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}
