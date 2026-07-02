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

// --- No-code field toggles (rules: text/ai/code ; triggers: template/code) ---
function toggleAction(sel) {
  var form = sel.closest('form');
  if (!form) return;
  var isCode = sel.value === 'code';
  var t = form.querySelector('.field-text');
  var c = form.querySelector('.field-code');
  var d = form.querySelector('.field-ai-data');
  if (t) t.style.display = isCode ? 'none' : 'block';
  if (c) c.style.display = isCode ? 'block' : 'none';
  if (d) d.style.display = sel.value === 'ai' ? 'block' : 'none';
}
function toggleData(sel) {
  var box = sel.closest('.field-ai-data');
  if (!box) return;
  var db = box.querySelector('.field-data-db');
  var sh = box.querySelector('.field-data-sheet');
  if (db) db.style.display = sel.value === 'db' ? 'block' : 'none';
  if (sh) sh.style.display = sel.value === 'sheet' ? 'block' : 'none';
}
function toggleTrigger(sel) {
  var form = sel.closest('form');
  if (!form) return;
  var isCode = sel.value === 'code';
  var t = form.querySelector('.field-template');
  var c = form.querySelector('.field-code');
  if (t) t.style.display = isCode ? 'none' : 'block';
  if (c) c.style.display = isCode ? 'block' : 'none';
}
document.querySelectorAll('.action-select').forEach(toggleAction);
document.querySelectorAll('.mode-select').forEach(toggleTrigger);
document.querySelectorAll('.data-select').forEach(toggleData);

// --- No-code payload field picker for external webhooks ---
function flattenPayload(obj, prefix, out) {
  out = out || [];
  if (Array.isArray(obj)) obj = obj[0]; // n8n wraps payloads in an array
  if (obj === null || typeof obj !== 'object') {
    if (prefix) out.push({ path: prefix, value: obj });
    return out;
  }
  for (var k in obj) {
    var p = prefix ? prefix + '.' + k : k;
    var v = obj[k];
    if (v !== null && typeof v === 'object') flattenPayload(v, p, out);
    else out.push({ path: p, value: v });
  }
  return out;
}

async function loadPayloadFields(botId, triggerId, btn) {
  var card = btn.closest('form');
  var box = card.querySelector('.payload-fields');
  var ta = card.querySelector('.tpl-textarea');
  var photoInput = card.querySelector('input[name="photo_field"]');
  // Remember which target the user focused last, so chips fill the right box.
  if (!card.dataset.focusTracked) {
    card.dataset.focusTracked = '1';
    card.addEventListener('focusin', function (e) {
      if (e.target === ta || e.target === photoInput) card.__fillTarget = e.target;
    });
  }
  box.style.display = 'block';
  box.innerHTML = '<span class="muted">Đang tải...</span>';
  try {
    var res = await fetch('/bots/' + botId + '/triggers/' + triggerId + '/last-payload');
    var r = await res.json();
    if (!r.ok || !r.payload) {
      box.innerHTML = '<span class="muted">Chưa nhận được webhook nào. Hãy gửi thử 1 webhook tới địa chỉ trên rồi bấm lại.</span>';
      return;
    }
    var fields = flattenPayload(r.payload, '', []);
    if (!fields.length) {
      box.innerHTML = '<span class="muted">Payload không có trường dữ liệu nào.</span>';
      return;
    }
    box.innerHTML =
      '<p class="hint" style="margin:4px 0">Đây là toàn bộ ' + fields.length + ' trường webhook gần nhất gửi đến. Click để chèn vào mẫu tin — hoặc bấm vào ô "Trường chứa URL ảnh" trước rồi click trường để tự điền vào đó. (Giá trị hiển thị được cắt ngắn, dữ liệu thật vẫn đầy đủ):</p>' +
      fields.map(function (f) {
        var full = f.value === null || f.value === undefined ? '' : String(f.value);
        var preview = full.length > 28 ? full.slice(0, 28) + '…' : full;
        return '<button type="button" class="btn sm" style="margin:3px" data-path="' + esc(f.path) + '" title="' + esc(full.slice(0, 300)) + '">' +
          esc(f.path) + ' <span class="muted">= ' + esc(preview) + '</span></button>';
      }).join('') +
      '<details style="margin-top:8px"><summary class="muted" style="cursor:pointer">Xem JSON đầy đủ webhook nhận được</summary>' +
      '<pre class="logbox" style="margin-top:6px">' + esc(JSON.stringify(r.payload, null, 2)) + '</pre></details>';
    box.querySelectorAll('button[data-path]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (card.__fillTarget === photoInput && photoInput) {
          // Photo field expects a bare payload path (no {{ }}).
          photoInput.value = b.dataset.path;
          photoInput.focus();
        } else {
          insertAtCursor(ta, '{{' + b.dataset.path + '}}');
        }
      });
    });
  } catch (e) {
    box.innerHTML = '<span class="muted">Lỗi: ' + esc(e.message) + '</span>';
  }
}

function insertAtCursor(ta, text) {
  if (!ta) return;
  var start = ta.selectionStart || 0;
  var end = ta.selectionEnd || 0;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.focus();
}

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
  const photo = (document.getElementById('test-photo') || {}).value || '';
  const caption = (document.getElementById('test-caption') || {}).value || '';
  show('test-result', 'Đang gửi...');
  try {
    const r = await postJSON('/bots/' + botId + '/test-send', { chat_id, text, photo, caption });
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
          '<span>' + esc(l.event_type || '') + (l.chat_id ? ' · chat:' + esc(l.chat_id) : '') + (l.from_id ? ' · user:' + esc(l.from_id) : '') + (l.from_name ? ' · ' + esc(l.from_name) : '') + '</span>' +
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
