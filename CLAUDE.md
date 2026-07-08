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
- Car photos: dealers UPLOAD images from their device to Supabase Storage. NEVER ask for a "photo URL / photo link" — dealers photograph cars on a phone and have no URL. Require at least one uploaded photo per listing.
- Profile images (dealers AND agencies): both must upload a LOGO (profile picture) and a GALLERY of photos (dealer = showroom/lot; agency = trucks, warehouse, loading, office). These build buyer trust. Upload to Supabase Storage. Storage buckets that already exist: "car-photos" and "agency-photos" (both public read, authenticated upload). Dealer logo shows next to the dealer name + Vérifié badge on car cards and the car detail page (clean placeholder if none). Agency logo + gallery show on the agence.html public profile. Columns logo_url and photos may need adding to the dealers and shipping_agencies tables — add via SQL when building.
- Two-way translation (core feature, must actually work): each person reads in THEIR chosen language. Buyer writes French → dealer/agency reads it in THEIR language (e.g. English) → they reply in their language → buyer receives it in French. Applies to dealer chat AND agency chat. Translate via Groq through a Netlify Function (key hidden). The buyer must never see any "Assistant"/AI label — from the buyer's side it is simply the dealer/agency replying.
- NO phone/WhatsApp numbers visible anywhere to buyers (dealers OR agencies). All contact happens through in-app chat only. Numbers may exist in the backend for admin, never shown to buyers.
- Favorites: logged-in buyers can save cars (heart icon) and return to a "Mes favoris" page to find them again. Saved to the favorites table in Supabase.
- Budget search: buyers can type a budget (e.g. "$18 000, Kinshasa") and get matching cars whose LANDED cost fits, not just Dubai price. This is a core buyer entry point.
- Reviews build trust: dealers AND agencies have ratings/reviews on their profiles, left by buyers after an interaction/transaction. Show average rating + count. (Real reviews only — no fake ones per the Honesty rule. Build the review system now; it fills with real reviews as buyers use it.)

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
- Images: dealer-uploaded photos → Supabase Storage. Unsplash only as fallback/demo. Buckets already created: car-photos, agency-photos (public read, authenticated upload). Reviews table created (subject_type dealer/agency, subject_id, user_id, author, rating 1-5, comment, created_at) with RLS: public read, authenticated insert. conversations.agency_id column added (dealer_id now optional) for buyer↔agency chat.
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

## Build roadmap (✅ = done as of this session)
1. ✅ Landing page — navy design, honest trust section, real logo
2. ✅ acheter.html — browse + filters + working search (button + Enter) + budget search (landed-cost match)
3. ✅ voiture.html — car detail + landed cost + contact button
4. ✅ Auth (Google/email via Supabase Auth) + connexion.html
5. ✅ In-app chat (buyer↔dealer) — rewritten to real DB schema
6. ✅ Separate pages: vendre / expedier / comment, strict pricing separation, dealer & agency registration
7. ✅ Dashboards: dealer + agency (profile, addresses, coverage, routes, transit promises). Admin dashboard = NEXT.
8. ✅ Buyer "Choisir le transport" — Fiverr-style agency compare, only agencies serving buyer's city, profile + in-app contact
9. ✅ i18n FR/EN/AR + language switcher + Arabic RTL
10. ✅ Netlify Function for Groq + AI: real price verdict badges, price estimate tool, Assistant Yayo Suggested mode (on/off, style, draft reply), photo condition report. (Needs GROQ_API_KEY in Netlify to activate.)
11. ✅ Photo upload to Supabase Storage (car photos) + AI condition report
12. ✅ PWA — installable, service worker, icons
13. ✅ Favorites (heart + Mes favoris) + Reviews system (honest empty state, real reviews only)
NEXT: (a) LOGO + GALLERY uploads for dealers AND agencies (buckets car-photos & agency-photos ready; add logo_url/photos columns via SQL). (b) Admin dashboard — approve/verify dealers & agencies, manage users, set limits, see stats.
Later phases: Assistant Yayo Autonomous mode (Mode 3) with dealer rule limits; full agency dashboard (methods, cargo, locations/maps, bookings, tracking, reviews, full pricing matrix); Yayo Sécurisé (deposits via Flutterwave/mobile money); shipment tracking; diaspora mode ("Acheter pour un proche"); SEO landing pages per route/country.
DATA FIX (verify done): car make/model must display correctly — a Ferrari must NOT show as "Toyota". Read the real make from the listing everywhere.

## Shipping agencies — how it works (spec)
Agencies are first-class businesses on Yayo, like dealers — each has a PUBLIC PROFILE buyers can visit and CONTACT (think Fiverr seller page), not just a dropdown to select. They compete on price, speed, service, and trust. Yayo connects them to buyers; Yayo never sets their prices.
- Registration: create account → company info → upload trade license/docs → admin reviews → approved → "Verified Shipping Partner" badge → dashboard access.
- Agency PUBLIC PROFILE (what buyers see): agency name, logo, description ("about us"), years in business, number of shipments completed, rating/reviews, languages spoken, verification badge, services offered, a Fiverr-style promise per route ("Je livre votre voiture à Kinshasa en 32 jours"), and — critical for trust — a real PICKUP ADDRESS in Dubai and a real DESTINATION OFFICE ADDRESS in each country served (e.g. Kinshasa, Lubumbashi). Addresses let a worried buyer verify the agency physically exists. Buyer can MESSAGE the agency in-app (same two-way translation as dealer chat) to ask questions or request a custom quote BEFORE choosing.
- COVERAGE (prevents wrong matches): each agency declares exactly which destination cities it serves (not just countries — Kinshasa ≠ Lubumbashi). Yayo shows a buyer ONLY the agencies that serve THAT buyer's city. Never suggest an agency that doesn't serve the buyer's destination.
- Agency dashboard (build progressively, not all at once): company profile (logo, description, years, languages, verification, Dubai pickup address, destination office addresses); coverage (which cities served); routes (Dubai→served cities); shipping methods (Container, RoRo, Air, Sea); cargo types; transit time + Fiverr-style promise per route; PRICING MATRIX (route × vehicle type × method → agency's own price); optional services (insurance, customs assistance, door-to-door, port-to-port, inspection, packaging, storage, consolidation); business management (quotes, bookings, shipment tracking, conversations, reviews, stats).
- Buyer experience on a car: click "Choisir le transport" → see MULTIPLE verified agencies THAT SERVE THEIR CITY, compare like Fiverr/airlines (price, transit promise, rating, shipments done, insurance, badge, services). Buyer can open an agency's profile, message them, request a quote, then choose. Choosing sets the landed cost from that agency's REAL price.
- Landed cost is dynamic: chosen agency's REAL shipping price + import duty (ESTIMATE, labeled) + port fees + documentation. Every line labeled by source. When an agency updates pricing, landed cost + car pages update automatically.
- PHASED BUILD (do not build the whole thing at once): Phase 1 = agency registration + dashboard with profile (description, Dubai pickup address, destination office addresses, coverage cities) + one price + transit promise per served route + buyer sees only agencies serving their city, can view profile + contact/message the agency + choose → landed cost from that price (duty = simple labeled estimate). Later phases: methods, cargo types, full pricing matrix, quotes/bookings, tracking, reviews, ratings.

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

## Admin dashboard — the control room (spec)
The admin dashboard is the founder's command center to run the whole platform. Current version is too basic (only verify/unverify). It must be professional and complete. Sections needed:
- DEALERS: list all, search/filter (verified/pending/suspended), view full profile, VIEW UPLOADED LICENSE/DOCUMENTS to verify, approve → grant Vérifié badge, reject with reason, suspend/unsuspend, remove/delete, see their listings count & activity, edit if needed. Show subscription tier & status.
- AGENCIES: same as dealers — list, view documents, verify → Verified Shipping Partner, reject, suspend, remove, view routes/pricing/coverage.
- LISTINGS: see all cars, flag/hide inappropriate or fake listings, remove a listing, see which dealer owns it.
- USERS (buyers): list, search, see activity, ban/suspend abusive users, delete on request (privacy).
- DOCUMENT VERIFICATION: when a dealer/agency uploads a trade license, admin must be able to OPEN and view that file (stored in Supabase Storage) to check it before approving. This is the core trust gate.
- ADMIN TEAM & ROLES: founder is super-admin. Must be able to ADD other admins by email and give them LIMITED permissions (e.g. an admin who can only verify dealers, or only view stats, not delete users). Roles: super_admin (everything), admin_dealers (dealers+agencies only), admin_support (users+listings), admin_stats (view only). Store role in the user record.
- STATISTICS & ANALYTICS: two kinds.
  (A) In-app metrics from Supabase (build now): total registered users, new signups (today/7d/30d, with a simple trend), active users (signed in last 7/30 days), active dealers/agencies, total & new listings, messages sent, favorites, conversations started, most-viewed cars (add a views counter on listings if missing), top destinations chosen. Show as clean stat cards + simple charts.
  (B) Website traffic analytics (visitors, sources, pages, bounce, real-time) — Supabase CANNOT provide this; it needs a visitor-analytics tool. Integrate Google Analytics 4 (free) OR Plausible (simpler, privacy-friendly) across all pages, and link to it from the admin dashboard. Track: visitors, traffic sources (Google/WhatsApp/social/direct), page views, top pages, conversion funnel (landing → car view → contact/register). Founder will need to create the analytics account and paste a tracking ID.
- SAFETY/AUDIT: log of admin actions (who verified/removed what, when) so nothing is untraceable. Confirmation dialogs before destructive actions (remove/ban/delete) — never one-click delete without confirm.
- TECHNICAL ISSUES: a simple way to see reported problems / flagged content, and a fallback so if something breaks, admin can suspend a listing/dealer fast.
Design: same navy/turquoise system, clean tables, clear action buttons, works on mobile. Every action confirmed before it runs. Only users with an admin role can access — non-admins are redirected.

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
