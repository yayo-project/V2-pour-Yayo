# Yayo

The Dubai → Africa car marketplace. Verified dealers, transparent landed
cost, tracked delivery. Always free for buyers.

Public landing page for [yayo.digital](https://yayo.digital).

## Project structure

```
index.html      Landing page markup
css/style.css   Styles
js/config.js    Public config (Supabase URL + publishable key, destinations)
js/app.js       Listing loader, landed-cost calculator, UI wiring
assets/         Logos and favicon
```

## Run locally

It's a static site — open `index.html` directly, or serve the folder:

```
python -m http.server 8000
# then visit http://localhost:8000
```

A local server is recommended so the Supabase client can make requests
without `file://` CORS quirks.

## Configuration

`js/config.js` holds only client-safe values:

- `SUPABASE_URL` and `SUPABASE_KEY` — publishable key, safe in the browser.
- `DESTINATIONS` — per-city shipping cost, duty factor, and fixed fees
  used by the landed-cost estimator.

Secret keys (AI providers, service-role keys) live in Netlify Functions,
never in this repo.
