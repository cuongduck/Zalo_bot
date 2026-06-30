# Mẫu Code xử lý tin nhắn (`ctx`)

Dán vào tab **Code xử lý** của bot. Mỗi tin nhắn đến sẽ chạy đoạn code này.

## 1. Menu lệnh đơn giản
```js
const t = (ctx.message.text || '').trim().toLowerCase();
if (t === '/start') return 'Xin chào! Gõ /help để xem hướng dẫn.';
if (t === '/help')  return 'Các lệnh: /start, /help, /id, giá <mã sp>';
return null; // không khớp -> không trả lời
```

## 2. Tra cứu giá sản phẩm từ database
```js
const t = (ctx.message.text || '').trim();
const m = t.match(/^giá\s+(.+)$/i);
if (!m) return null;
const rows = await ctx.db('main',
  'SELECT name, price FROM products WHERE sku = ? LIMIT 1', [m[1].trim()]);
if (!rows.length) return 'Không tìm thấy sản phẩm: ' + m[1];
return `${rows[0].name}\nGiá: ${Number(rows[0].price).toLocaleString('vi-VN')}đ`;
```

## 3. Chatbot AI có "lọc" trước khi gửi
```js
const t = (ctx.message.text || '').trim();
if (!t) return null;
let answer = await ctx.ai(t);             // gọi Gemini
answer = answer.replace(/\*\*/g, '');      // bỏ markdown bold
if (answer.length > 1500) answer = answer.slice(0, 1500) + '…';
return answer;
```

## 4. Gọi API ngoài (thời tiết)
```js
const t = (ctx.message.text || '').trim();
const m = t.match(/^thời tiết\s+(.+)$/i);
if (!m) return null;
const data = await ctx.fetch(
  'https://wttr.in/' + encodeURIComponent(m[1]) + '?format=3'
).then(r => r.text());
return data;
```

## 5. Chỉ trả lời trong nhóm khi được nhắc tên
```js
if (ctx.message.chatType === 'group') {
  const t = (ctx.message.text || '');
  if (!/@bot/i.test(t)) return null; // bỏ qua nếu không gọi @bot
  return await ctx.ai(t.replace(/@bot/ig, ''));
}
return await ctx.ai(ctx.message.text);
```
