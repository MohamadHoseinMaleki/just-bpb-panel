# پرچم و کشور روی اسم کانفیگ

اسکریپت `rewrite-sub.ps1`:

1. اگر آدرس کانفیگ **IP** باشد → با `ip-api.com` کشور می‌گیرد (پرچم + اسم)
2. اگر `workers.dev` / `pages.dev` باشد → `☁️ Cloudflare`
3. اگر Clean IP دامنه باشد → سعی می‌کند از hostname حدس بزند
4. وگرنه از remark پنل (Domain / IPv4 / Best Ping / ...)

فرمت نهایی:

```text
secureVpn | 🇩🇪 Germany
secureVpn | ☁️ Cloudflare
secureVpn | ✨ Clean IP
```

توجه: بیشتر کانفیگ‌های BPB روی لبه Cloudflare هستند و «کشور واقعی مسیر» ممکن است با IP نمایشی یکی نباشد.
