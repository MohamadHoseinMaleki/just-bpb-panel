# بسته‌بندی: گیگ + تاریخ انقضا

## مدل درست روی BPB

```text
مشتری → لینک یکتا (token) → package-worker → ساب بازنویسی‌شده
                              ↓
                         KV: expiry + bytes
```

1. ادمین با `ADMIN_KEY` بسته می‌سازد: مثلاً ۳۰ روز، ۱۰ گیگ (soft)
2. مشتری فقط لینک `/?t=TOKEN` را می‌گیرد
3. بعد از انقضا یا رد شدن از سقف → لینک قطع می‌شود

### واقعیت گیگ

روی BPB (یک UUID مشترک) **حجم واقعی مصرف اینترنت کاربر** را Worker نمی‌بیند.  
سقف `maxBytes` یعنی تقریباً چقدر از **پاسخ ساب** سرو شده (هر بار آپدیت ساب).  
برای فروش جدی با گیگ واقعی → پنل چندکاربره جدا لازم است.

انقضا زمانی دقیق کار می‌کند و برای فروش فعلی بهترین گزینه است.

## نصب package-worker

1. Cloudflare → Create Worker → اسم مثلاً `securevpn-pkg`
2. کد `package-worker/worker.js` را Paste کن → Deploy
3. Settings → Variables:
   - `ADMIN_KEY` = یک رمز قوی (Secret)
   - `BASE_SUB_URL` = لینک ساب پنل (همان raw)
4. Settings → Bindings → KV Namespace بساز → bind با نام `KV`

## ساخت بسته (ادمین)

```http
POST https://securevpn-pkg.xxx.workers.dev/admin/create
Header: X-Admin-Key: YOUR_ADMIN_KEY
Body JSON:
{
  "days": 30,
  "maxGB": 10,
  "note": "customer-ali"
}
```

پاسخ:
```json
{
  "token": "abc...",
  "url": "https://securevpn-pkg.xxx.workers.dev/?t=abc...",
  "expiresAt": "2026-10-05T...",
  "maxBytes": 10737418210
}
```

همین `url` را به مشتری بده.

## لیست / حذف

```http
GET  /admin/list   Header X-Admin-Key
POST /admin/revoke Body {"token":"..."} Header X-Admin-Key
```
