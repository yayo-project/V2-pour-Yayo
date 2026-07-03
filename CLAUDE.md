# YAYO — Project Brief (read this first, every session)

## What Yayo is
AI-powered car marketplace connecting Dubai dealers & shipping agencies with buyers in francophone Africa (Congo DRC, Cameroon, Côte d'Ivoire, Sénégal). Vision: become the #1 platform controlling the Dubai → Africa car corridor.
Solo founder: Yayo (Ciunza), based in Dubai. Production domain: yayo.digital (old version — do NOT touch it until the new version is approved).

## Business rules (never violate)
- Buyers are ALWAYS 100% free. No paywalls, no forced registration to see results.
- Dealers pay monthly subscriptions ($49–$299/mo). Agencies pay $79–$149/mo.
- All buyer↔dealer communication stays INSIDE the platform (in-app chat). Never external WhatsApp links for buyer→dealer contact.
- NEVER expose to buyers that AI answers on behalf of dealers. The dealer-side reply tool is called "Assistant Yayo" — never "AI agent" in any user-facing text.
- Payments happen OUTSIDE the platform for now (buyer and dealer arrange it). Deposit/escrow ("Yayo Sécurisé") is a future phase.
- Language: French first. Full FR/EN/AR support. All UI strings go in js/i18n.js — never hardcode user-facing text.

## Design system (locked — do not change without founder approval)
- Palette "Navy Trust": deep navy #0A2540 (headers/hero/footer, dark surfaces #071B33 → #0F3358), turquoise accent #1FD8C9 (interactive elements, matches logo), body bg #F4F7FB, cards #FFFFFF, lines #DFE6EE, text #0A2540 / #3F5473 / #7A8CA5, gold #B7791F for stars/badges only.
- Fonts: DM Sans (Google Fonts). Logo: assets/logo-teal.png (original turquoise, use on dark surfaces only). Favicon: assets/favicon.png.
- Style: clean marketplace like Cars24/Dubizzle but calmer. Cards with soft shadows, rounded 14px, generous spacing. Mobile-first — most buyers are on phones.
- Signature feature: destination selector (Kinshasa/Douala/Abidjan/Dakar/Dubai) — every car price recalculates to full landed cost (price + shipping + duty + fees) for the selected city. Config lives in js/config.js DESTINATIONS.

## Stack
- Frontend: vanilla HTML/CSS/JS, multi-file structure (no framework for now). PWA later.
- Backend: Supabase (URL + publishable key in js/config.js). Tables: users, dealers, shipping_agencies, listings, leads, conversations, messages, favorites, price_alerts, price_history, usage, price_usage.
- listings schema: dealer_id, car_name, price, year, mileage, condition, color, description, photo_url, city, export_africa, active, sold, created_at.
- AI: Groq (LLaMA) — key must move to Netlify Functions (serverless), NEVER in client code.
- Images: dealer-uploaded photos → Supabase Storage. Unsplash only as fallback/demo.
- Deploy: GitHub repo V2-pour-Yayo → Netlify auto-deploy. PRs get deploy previews. Merge to main = production.

## Site structure (target)
- index.html — landing (DONE: navy hero, search, destination bar, brands row, featured cars from Supabase with demo fallback, how-it-works, landed-cost section, testimonials, discreet dealer link, footer with SEO links)
- acheter.html — marketplace browse: all listings, filters (brand, price, year, body type, destination), search, sort. Connected to Supabase.
- voiture.html?id=X — car detail: photo gallery, specs, AI price verdict, landed cost breakdown per city, dealer card with Vérifié badge, "Contacter le dealer" → in-app chat (login prompt if logged out).
- vendre.html — dealer/agency recruitment page (the ONLY place with dealer benefits: African buyers, Assistant Yayo, auto-translation, dashboard, Vérifié badge, qualified leads) + registration.
- Registration trust ladder: sign up with Google or email (Supabase Auth) in 30 seconds → can list immediately → upload trade license later to earn "Vérifié Yayo" badge.
- dashboard.html — role-based: dealer (stats, leads inbox, inventory, chat with Assistant Yayo reply suggestions), agency (routes, pricing, shipping leads), admin (verify/activate dealers & agencies, users, limits, stats).
- connexion.html — login (Google + email via Supabase Auth).
- css/style.css, js/config.js, js/app.js, js/i18n.js, js/auth.js, js/marketplace.js, js/chat.js, js/dashboard.js — split logic as pages are built.

## Build roadmap (in order — current position marked)
1. ✅ Landing page (index.html) — done, deployed
2. ✅ acheter.html — marketplace browse: filters (brand, price, year, body, fuel), search, sort, URL params, Supabase + demo fallback. Landing fully wired to it.
3. ✅ voiture.html — detail page: specs, landed cost per city, dealer card, similar cars, contact button
4. ✅ Auth — connexion.html + js/auth.js (Google + email via Supabase Auth, ?next= redirect, account chip in topbar)
5. ✅ In-app chat v1 — on voiture.html (conversations/messages tables; demo mode on demo listings). Dealer-side inbox comes with the dashboard.
6. ✅ vendre.html — benefits, trust ladder, pricing, dealer/agency registration form (admin activates accounts)
7. → NEXT: dashboard.html (dealer first: stats, leads inbox, inventory CRUD, chat replies with Assistant Yayo; then agency, then admin)
8. i18n.js — full FR/EN/AR coverage, language switcher
9. Netlify Functions for Groq (hide API key) + AI features: price verdict badges on listings, price estimate tool, Assistant Yayo reply suggestions
10. Photo upload to Supabase Storage + AI condition report
11. PWA (manifest, service worker, installable)
Later phases: Yayo Sécurisé (deposits via Flutterwave/mobile money), shipment tracking, diaspora mode ("Acheter pour un proche"), SEO landing pages per route/country.

## Working rules for Claude Code
- Before building each numbered item, state a short plan and wait for the founder's OK.
- Never break production (yayo.digital). Work in this repo only; PRs + deploy previews for review.
- Keep every page consistent with the design system above. Reuse css/style.css.
- Founder is non-technical: explain in simple words, one step at a time, no jargon.
- Test on mobile width (380px) — buyers are mobile-first.
- Commit messages in English, short and clear.
