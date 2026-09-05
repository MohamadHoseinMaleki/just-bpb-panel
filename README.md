# just bpb panel

ابزارهای **secureVpn** برای BPB — **بدون تغییر Worker پنل**.

## وضعیت پروژه

| خواسته | وضعیت |
|--------|--------|
| پینگ بهتر / تعداد کانفیگ کمتر | انجام (تنظیمات پنل) |
| اسم secureVpn روی ساب/کانفیگ | انجام (Worker استاتیک + اسکریپت) |
| پرچم و کشور | انجام در اسکریپت (برای IP؛ دامنه CF = Cloudflare) |
| بسته گیگ + انقضا | کد کامل (`package-worker`) — باید Deploy کنی |
| ربات تلگرام | عمداً انجام نشده (گفتی بعداً) |
| دست نزن به پنل BPB v5 | رعایت شده |

ریپو: https://github.com/MohamadHoseinMaleki/just-bpb-panel  
پنل: https://rcnf9ofm8yrbsdx1.instagram-monitor-bot.workers.dev/4g3vkGn6-0kuc/panel

## مسیر کامل اسم + پرچم

```powershell
git clone https://github.com/MohamadHoseinMaleki/just-bpb-panel.git
cd just-bpb-panel

powershell -ExecutionPolicy Bypass -File .\scripts\rewrite-sub.ps1 -SubUrl "https://rcnf9ofm8yrbsdx1.instagram-monitor-bot.workers.dev/4g3vkGn6-0kuc/sub/raw?app=xray"

powershell -ExecutionPolicy Bypass -File .\scripts\generate-static-worker.ps1
```

فایل `output\static-worker.js` را در Worker `autumn-waterfall-dce9` Paste و Deploy کن.

لینک مشتری:
https://autumn-waterfall-dce9.instagram-monitor-bot.workers.dev/

## مسیر بسته فروش

راهنما: [docs/PACKAGES.md](docs/PACKAGES.md)
