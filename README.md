# 🤖 Zalo Bot Platform (Self-hosted)

Nền tảng **tự host (self-host)** để quản lý nhiều **Zalo Bot** trên server của bạn:
đăng ký & phê duyệt thành viên, quản lý token/bot, nhận webhook, tích hợp **AI Gemini**,
viết **code xử lý tin nhắn tuỳ biến**, kết nối **MariaDB/MySQL/SQL Server**, lấy ID
user/nhóm và test gửi tin.

> API sử dụng: [Zalo Bot API](https://bot.zapps.me/docs) — `https://bot-api.zapps.me/bot<TOKEN>/<method>`
> (kiểu Telegram Bot API: `getMe`, `getUpdates`, `setWebhook`, `sendMessage`, ...).

---

## ✨ Tính năng

| # | Tính năng | Mô tả |
|---|-----------|-------|
| 1 | **Đăng ký & phê duyệt thành viên** | Người dùng tự đăng ký, **admin phê duyệt** mới được dùng. Phân quyền `admin`/`user`. |
| 2 | **Quản lý bot** | Thêm token, thêm/sửa/xoá bot, xem log, bật/tắt, đổi chế độ. |
| 3 | **Webhook** | Nhận sự kiện từ Zalo và **chuyển tiếp** sang URL ngoài (n8n, hệ thống khác); gửi tin tới nhóm. |
| 4 | **AI Gemini** | Bật chatbot tự trả lời bằng Google Gemini (key chung hoặc riêng từng bot). |
| 5 | **Code xử lý tuỳ biến** | Viết JavaScript chạy trong sandbox để xử lý/ biến đổi tin nhắn trước khi gửi. |
| 6 | **Kết nối dữ liệu** | Kết nối MariaDB/MySQL/SQL Server, truy vấn ngay trong code xử lý qua `ctx.db()`. |
| 7 | **Lấy ID** | Gửi `/id` trong chat để bot trả về **Chat ID** và **User ID**; log luôn hiển thị ID. |
| 8 | **Test gửi tin** | Form gửi thử tin nhắn tới bất kỳ Chat ID nào. |

---

## 🚀 Cài đặt nhanh (Docker — khuyên dùng)

```bash
git clone <repo> zalo-bot && cd zalo-bot
cp .env.example .env

# Sinh ENCRYPTION_KEY rồi dán vào .env:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Sửa .env: APP_BASE_URL, SESSION_SECRET, ADMIN_*, GEMINI_API_KEY, ENCRYPTION_KEY ...
docker compose up -d --build
```

Truy cập `http://<server>:3000`, đăng nhập bằng `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

> ⚠️ Webhook của Zalo yêu cầu HTTPS công khai. Hãy đặt nền tảng sau reverse proxy
> (Nginx/Caddy/Cloudflare) và set `APP_BASE_URL=https://your-domain.com`.

---

## 🛠️ Cài đặt thủ công (không Docker)

Yêu cầu: **Node.js ≥ 18** và **MariaDB/MySQL**.

```bash
npm install
cp .env.example .env        # chỉnh thông tin DB, admin, key...
npm run migrate             # tạo bảng + tài khoản admin
npm start                   # chạy ở http://localhost:3000
```

---

## ⚙️ Biến môi trường (.env)

| Biến | Ý nghĩa |
|------|---------|
| `PORT` | Cổng web (mặc định 3000) |
| `APP_BASE_URL` | URL công khai của app — dùng để tạo webhook URL |
| `SESSION_SECRET` | Chuỗi bí mật ký session |
| `DB_*` | Kết nối CSDL ứng dụng (MySQL/MariaDB) |
| `ADMIN_*` | Tài khoản admin tạo lần đầu khi `migrate` |
| `ZALO_API_BASE` | Base URL Zalo Bot API (`https://bot-api.zapps.me/bot`) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Key Gemini chung (có thể đặt riêng từng bot) |
| `ENCRYPTION_KEY` | Khoá 32 byte (hex 64 ký tự) để mã hoá token/mật khẩu khi lưu |

---

## 📖 Cách dùng

### 1. Phê duyệt thành viên
Đăng ký tại `/register` → admin vào **Thành viên** (`/admin/users`) → **Duyệt**.

### 2. Thêm bot
Tạo bot tại [bot.zapps.me](https://bot.zapps.me), lấy **token**, vào **Bot → Thêm bot**, dán token.
Hệ thống tự gọi `getMe` để xác thực.

### 3. Đăng ký webhook
Mở bot → tab **Webhook** → **Đăng ký webhook**. App đăng ký URL
`https://your-domain.com/webhook/<botId>` kèm `secret_token` với Zalo.

### 4. Bật AI hoặc viết code
- **AI (Gemini):** tab AI → bật, nhập key/model/system prompt.
- **Code xử lý:** tab Code — nếu bật, code được ưu tiên hơn AI tự động.

### 5. Lấy ID & test gửi tin
- Gửi `/id` trong chat/nhóm → bot trả về Chat ID, User ID.
- Tab **Test gửi tin** để gửi thử.

---

## 🧩 Đối tượng `ctx` trong Code xử lý

```js
// ctx.message: { text, chatId, chatType, fromId, fromName, messageId, date, raw }
// ctx.bot:     { id, name, zaloId }

const text = (ctx.message.text || '').trim();

// Trả lời nhanh
if (text === 'ping') return 'pong';

// Lấy dữ liệu từ kết nối tên "main" (cấu hình ở mục Dữ liệu)
const rows = await ctx.db('main', 'SELECT name, price FROM products WHERE sku = ?', [text]);
if (rows.length) return `${rows[0].name}: ${rows[0].price}đ`;

// Gọi AI
const answer = await ctx.ai('Tóm tắt: ' + text);

// Gọi API ngoài
const r = await ctx.fetch('https://api.example.com/x').then(r => r.json());

await ctx.reply(answer);           // trả lời vào chat hiện tại
await ctx.send('OTHER_CHAT_ID', 'hi');
ctx.log('debug info');             // ghi log (tab Nhật ký)
return null;                        // không tự gửi gì thêm
```

Hàm chạy trong **sandbox** (module `vm`) với timeout ~8s; không truy cập được `require`,
hệ thống file hay biến môi trường của server.

---

## 🔗 Webhook chuyển tiếp (tích hợp)

Tab **Chuyển tiếp** cho phép POST mỗi tin nhắn đến tới URL ngoài (vd n8n) dạng JSON:

```json
{
  "bot_id": 1, "bot_name": "...", "event": "message.text",
  "message": { "text": "...", "chat_id": "...", "chat_type": "group|user",
               "from_id": "...", "from_name": "...", "message_id": "...", "date": 0 },
  "raw": { ... }
}
```

Gửi kèm header `X-Webhook-Secret` nếu bạn đặt secret.

---

## 🗄️ Kiến trúc

```
src/
├── server.js            # Express app, session, mount routes
├── config/              # cấu hình + pool MySQL
├── db/                  # schema.sql + migrate.js
├── models/              # users, bots, logs, webhooks, datasources
├── services/
│   ├── zaloApi.js       # client Zalo Bot API
│   ├── botManager.js    # chuẩn hoá update, AI, custom code, gửi tin
│   ├── poller.js        # long-polling cho bot chế độ polling
│   ├── gemini.js        # Google Gemini
│   ├── customHandler.js # sandbox chạy code người dùng
│   └── externalDb.js    # connector MySQL/MariaDB/SQL Server
├── routes/              # auth, dashboard, bots, datasources, admin, inbound
└── views/               # giao diện EJS
```

Token bot, key AI và mật khẩu DB ngoài được **mã hoá AES-256-GCM** trước khi lưu.

---

## 🔒 Bảo mật khi self-host
- Đổi `ADMIN_PASSWORD`, `SESSION_SECRET`, sinh `ENCRYPTION_KEY` riêng.
- Chạy sau HTTPS reverse proxy; bật `NODE_ENV=production`.
- Code xử lý tuỳ biến chạy trong sandbox nhưng vẫn nên chỉ cấp quyền cho người tin cậy.

## Giấy phép
MIT.
