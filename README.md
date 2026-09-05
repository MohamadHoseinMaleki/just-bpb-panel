# just bpb panel

ابزارهای **secureVpn** روی BPB — **بدون دست زدن به Worker پنل**.

پنل تو (دست‌نخورده بماند):
https://rcnf9ofm8yrbsdx1.instagram-monitor-bot.workers.dev/4g3vkGn6-0kuc/panel

## چرا ریپوی جدا؟

ریپوی `secureVpn-BPB` شلوغ و آزمایشی شد.  
این ریپو فقط فایل‌های لازم و تمیز است.

## بخش‌ها

| پوشه | کار |
|------|-----|
| `scripts/rewrite-sub.ps1` | دانلود ساب BPB → اسم `secureVpn` + **پرچم و کشور** |
| `package-worker/` | ساب بسته‌ای: **تاریخ انقضا + سقف حجم (soft)** |
| `docs/` | راهنما |

## محدودیت مهم BPB

BPB یک UUID مشترک دارد. ترافیک واقعی هر کاربر روی کلودفلر جداگانه قابل‌اندازه‌گیری دقیق نیست.  
بستهٔ «گیگ» اینجا یعنی **سقف تقریبی بایت سرو‌شده از لینک ساب** + **تاریخ انقضا**.  
برای گیگ واقعی per-user بعداً پنل چندکاربره (مثل Hiddify/Marzban) لازم است.

## شروع سریع

### ۱) اسم کانفیگ با پرچم

```powershell
cd path\to\just-bpb-panel
powershell -ExecutionPolicy Bypass -File .\scripts\rewrite-sub.ps1 `
  -SubUrl "https://rcnf9ofm8yrbsdx1.instagram-monitor-bot.workers.dev/4g3vkGn6-0kuc/sub/raw?app=xray"
```

خروجی: `output\securevpn-sub.txt` → داخل Worker استاتیک `autumn-waterfall-dce9` بگذار.

### ۲) بسته فروش

ببین: [docs/PACKAGES.md](docs/PACKAGES.md)
