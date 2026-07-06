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
- Yayo NEVER sets shipping prices — agencies set their own real rates. Yayo only estimates customs duty (government formula), always labeled "estimation".
- Page separation is strict: dealer subscription pricing lives ONLY on vendre page; agency subscription pricing lives ONLY on expedier page. Never mix the two. Each page shows only its own audience's information.
- Language: French first. Full FR/EN/AR support. All UI strings go in js/i18n.js — never hardcode user-facing text.

## Design system (locked — do not change without founder approval)
- Palette "Navy Trust": deep navy #0A2540 (headers/hero/footer, dark surfaces #071B33 → #0F3358), turquoise accent #1FD8C9 (interactive elements, matches logo), body bg #F4F7FB, cards #FFFFFF, lines #DFE6EE, text #0A2540 / #3F5473 / #7A8CA5, gold #B7791F for stars/badges only.
- Fonts: DM Sans (Google Fonts). Logo: assets/logo-teal.png (original turquoise, use on dark surfaces only). Favicon: assets/favicon.png.
- Style: clean marketplace like Cars24/Dubizzle but calmer. Cards with soft shadows, rounded 14px, generous spacing. Mobile-first — most buyers are on phones.
- Signature feature: destination selector (Kinshasa/Douala/Abidjan/Dakar/Dubai) — every car price recalculates to full landed cost for the selected city. IMPORTANT: shipping cost comes from a REAL verified agency's price (never invented by Yayo); customs duty + port fees are an ESTIMATE from published formulas. Each landed-cost line must be labeled by source ("prix agence" vs "estimation douane"). On the landing page, before any agency exists, use a clearly-labeled estimate as fallback. Config default lives in js/config.js DESTINATIONS.

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
- vendre page — DEALERS only. Dealer benefits (African buyers, Assistant Yayo, auto-translation, dashboard, Vérifié badge, qualified leads) + dealer subscription pricing ($49–$299/mo) with monthly/yearly toggle + dealer registration. No agency/shipping pricing here.
- expedier page — SHIPPING AGENCIES only. Agency benefits + agency subscription pricing ($79–$149/mo) with monthly/yearly toggle + agency registration. No dealer pricing here.
- comment page — the 4-step buyer journey as its own page.
- Registration trust ladder (dealers AND agencies): sign up with Google or email (Supabase Auth) in 30 seconds → basic access immediately → upload trade license later → admin approves → earn "Vérifié" badge (dealers: Vérifié Yayo; agencies: Verified Shipping Partner).
- dashboard page — role-based: dealer (stats, leads inbox, inventory, chat with Assistant Yayo), AGENCY (see Shipping Agency dashboard spec below), admin (verify/activate dealers & agencies, users, limits, stats).
- connexion page — login (Google + email via Supabase Auth).
- css/style.css, js/config.js, js/app.js, js/i18n.js, js/auth.js, js/marketplace.js, js/chat.js, js/dashboard.js — split logic as pages are built.

## Build roadmap (in order — current position marked)
1. ✅ Landing page (index.html) — done (navy design, honest trust section, real logo)
2. → NEXT BATCH (build 2+3+4+5 together if the window allows): acheter.html (browse + filters + WORKING search button and Enter key + WORKING apply/reset filter buttons, Supabase-connected) + make landing search/chips/"Voir tout" link to it
3. voiture.html (car detail + landed cost + contact button)
4. Auth (Google/email via Supabase Auth) + connexion.html
5. In-app chat (buyer↔dealer, conversations/messages tables)
6. Separate pages: vendre (dealers + dealer pricing w/ monthly-yearly toggle), expedier (agencies + agency pricing w/ monthly-yearly toggle), comment (buyer journey). Strict separation — no mixed pricing. + dealer & agency registration (trust ladder).
7. Dealer dashboard, then Agency dashboard Phase 1 (profile + routes + one price per route), then Admin.
8. Buyer "Choisir le transport" — compare multiple agencies (price/transit/rating/badge); landed cost from chosen agency's real price + labeled duty estimate.
9. i18n — full FR/EN/AR coverage, language switcher.
10. Netlify Functions for Groq (hide API key) + AI features: price verdict badges, price estimate tool, Assistant Yayo Suggested mode (Mode 2) with dealer on/off + style controls.
11. Photo upload to Supabase Storage + AI condition report.
12. PWA (manifest, service worker, installable).
Later phases: Assistant Yayo Autonomous mode (Mode 3) with dealer rule limits; full agency dashboard (methods, cargo, locations/maps, bookings, tracking, reviews, full pricing matrix); Yayo Sécurisé (deposits via Flutterwave/mobile money); shipment tracking; diaspora mode ("Acheter pour un proche"); SEO landing pages per route/country.
DATA FIX (do early): car make/model must display correctly — a Ferrari must not show as "Toyota". The car_name/make field is mislabeled somewhere; read the real value from the listing and render it correctly on cards and detail pages.

## Shipping agencies — how it works (spec)
Agencies are first-class businesses on Yayo, like dealers. They manage their own services, routes, pricing, and communication. Yayo connects them to buyers; Yayo never sets their prices.
- Registration: create account → company info → upload trade license/docs → admin reviews → approved → "Verified Shipping Partner" badge → dashboard access.
- Agency dashboard (build progressively, not all at once): company profile (logo, description, years in business, languages, contact, verification); routes (Dubai→Kinshasa/Douala/Dakar/Abidjan…); shipping methods (Container, RoRo, Air, Sea); cargo types (cars, SUVs, trucks, motorcycles, parts…); transit times per route; PRICING MATRIX (route × vehicle type × method → agency's own price); optional services (insurance, customs assistance, door-to-door, port-to-port, inspection, packaging, storage, consolidation); pickup locations in Dubai + delivery locations in destination countries (address, map, hours, contact); business management (quotes, bookings, shipment tracking, conversations, reviews, stats).
- Buyer experience: on a car, buyer clicks "Choisir le transport" → sees MULTIPLE verified agencies to compare (like comparing airlines/hotels): price, transit time, rating, insurance, verification badge, extra services. Buyer picks the agency matching their priorities. This creates transparency and competition.
- Landed cost is dynamic: built from the chosen agency's REAL shipping price + import duty (ESTIMATE, labeled) + port fees + documentation + inspection. Every line labeled by source. When an agency updates pricing in its dashboard, landed cost + car pages update automatically — no developer needed.
- PHASED BUILD (do not build the whole dashboard at once): Phase 1 = agency registration + basic dashboard (profile + a few routes + one price per route) + buyer "Choisir le transport" showing existing agencies with real price/transit/badge + landed cost from that price (duty = simple labeled estimate). Later phases add methods, cargo types, locations/maps, bookings, tracking, reviews, full matrix.

## Assistant Yayo — dealer's digital employee (spec)
Assistant Yayo is not a public chatbot. It is a configurable tool representing the dealer; the dealer owns and is responsible for every response it produces. To the buyer it is simply "the dealership" replying — never presented as a separate AI. This is not deception: the dealer controls it and approves its behavior.
Three modes the dealer chooses:
- Mode 1 — Manual: Assistant off. Dealer handles every message personally.
- Mode 2 — Suggested replies (DEFAULT, build first): Assistant drafts a reply → dealer reviews → dealer clicks Send. Full human control. This is the honest baseline and what "answer in 2 clicks, even at night" means.
- Mode 3 — Autonomous (build LATER, after Suggested is proven): Assistant replies directly within dealer-defined rules (max discount, working hours, languages, allowed topics). Anything beyond the limits pauses and notifies the dealer.
Dealer controls (in dashboard): enable/disable Assistant; enable/disable auto-replies; languages (FR/EN/AR); topics Assistant may handle (availability, specs, shipping info, scheduling, basic negotiation); topics requiring dealer approval (large discounts, final pricing beyond limits, deposits, refunds, custom offers, contracts); communication style (professional / friendly / luxury / fast). Assistant always follows the chosen style.
Same concept extends later to agencies (Assistant Yayo for Logistics: explains options, transit times, insurance, docs, routes, pricing, booking) and future partners (inspection, insurance, customs, finance). This is the concrete form of the North Star below — build it as reliable Suggested-mode features first, add autonomy last.

## North Star — the agentic corridor (long-term vision)
Yayo's endgame: every participant in cross-border trade has an intelligent digital representative that collaborates with the others to complete a transaction. Buyer agent, Dealer agent (Assistant Yayo), Shipping agent, Inspection agent, Customs agent, Finance agent — each does real work, and eventually they coordinate with each other (e.g. buyer asks "Prado before Christmas" → agents check inventory, shipping dates, customs cost, financing → one complete answer, no human coordinating).
BUT: never market this as "agentic AI." Customers buy outcomes: find the right car, import it safely, best price, on time, no fraud. The agents are the invisible engine; the felt experience is "importing from Dubai suddenly became simple." Buyers must never sense they're dealing with a bot.
BUILD ORDER (critical): build each capability first as a reliable, human-triggered FEATURE — Customs agent = landed-cost calculator; Inspection agent = AI photo condition report; Dealer agent = Assistant Yayo reply suggestions; Buyer agent = price/budget tools. Only after each feature is proven and there's real transaction volume do we remove the human trigger and let it act autonomously, then let agents talk to each other. Autonomy and agent-to-agent orchestration are the LAST 10%, not the start. Every feature should be built so it CAN later become an agent, without attempting the full network now (too complex, too costly in tokens, too risky with real money pre-revenue).

## Honesty rule (pre-launch)
Yayo has not completed real buyer transactions yet. NEVER use fake testimonials, invented customer names, or claims of completed deliveries/payments. Use honest framing: "how Yayo protects you," Yayo's promises, or clearly illustrative scenarios. Replace with real reviews only once real buyers exist.

## Working rules for Claude Code — BUILD FAST, DON'T STALL
- SPEED MATTERS: the founder is on a time-limited Fable 5 window. Do NOT stop to ask permission before each step. Do NOT ask "should I proceed?" — just build. Only pause if something is genuinely destructive to production or ambiguous enough to waste work.
- BATCH THE WORK: build 3–4 roadmap phases in ONE session when possible, not one page at a time. E.g. do acheter.html + voiture.html + auth + connexion.html together, then show one preview covering all of it.
- TEST BEFORE SHOWING: before presenting any preview, test the user experience yourself — every button has a working handler, search runs (button + Enter key), all filters apply and reset, destination selector recalculates prices, links go somewhere real, no console errors, works at 380px mobile width. Report a short checklist of what you tested + result. Never show a preview with dead buttons (e.g. a search bar with no search button — this already happened, don't repeat it).
- Never break production (yayo.digital). Work in this repo only; PRs + deploy previews for review.
- Keep every page consistent with the design system above. Reuse css/style.css. Every page shares the same navy topbar, footer, logo, fonts.
- Founder is non-technical: when you DO explain, use simple words, no jargon — but explain AFTER building, not before. Show working results, not questions.
- Commit messages in English, short and clear. Use PRs so Netlify makes deploy previews.
- Every interactive element must work end to end before you call a page done.
