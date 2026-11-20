# AI4PE Explorer community counter

The public GitHub Pages site cannot store shared counts by itself. This standalone Cloudflare Worker provides the explorer's visits and likes through `/ai4pe/v1/`, with separate tables in the existing `xinzelee-counter` D1 database. It does not change the workshop or personal-site counters, routes, or Worker.

With an authenticated Cloudflare account and Wrangler, run from this directory:

```powershell
npx wrangler d1 execute xinzelee-counter --remote --file=./schema.sql
npx wrangler deploy
```

The schema is additive and can be applied again without resetting totals. Deploying creates a separate Worker, `ai4pe-counter`, expected at `https://ai4pe-counter.xinzelee.workers.dev/ai4pe/v1/`. If your Workers subdomain is different, update the URL in the frontend. The Worker accepts requests from `https://xinzelee.github.io` and local HTTP previews on localhost or 127.0.0.1. Action records store an anonymous token, action and timestamp; token uniqueness makes retries idempotent. Browser storage provides one like per browser and one visit per tab session, but is not a protection against deliberate manipulation.
