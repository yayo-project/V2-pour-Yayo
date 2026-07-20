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
- LOGIN must be low-friction for the African market: offer phone-number login with an SMS one-time code (no password) as a primary option, plus Google and email. True WhatsApp-code delivery is a later upgrade (needs WhatsApp Business API); phone+SMS OTP is the practical now-version that feels the same. Always include a show/hide password toggle on password fields.
- Auth emails (reset, confirm, magic link) MUST look like they come from Yayo — customize Supabase email templates + sender name to "Yayo", not "Supabase". Connect proper SMTP so emails actually deliver (Supabase's built-in email is rate-limited and often fails). This is required before launch — Mukoma's reset email never arrived.
- Notifications: when a buyer messages a dealer/agency (or vice versa), an unread message indicator/badge must show for BOTH sides — buyer sees dealer replies, dealer/agency sees new buyer messages. Message icon in the header with unread count.
- Old Yayo users who registered via WhatsApp/phone number must still be findable and able to log in — verify where phone-only accounts live in Supabase and that admin can see them.
- Reviews build trust: dealers AND agencies have ratings/reviews on their profiles, left by buyers after an interaction/transaction. Show average rating + count. (Real reviews only — no fake ones per the Honesty rule. Build the review system now; it fills with real reviews as buyers use it.)

- VERIFIED BADGE — premium, X/Twitter style: not a plain tick. A filled badge in strong trust-blue (#1D9BF0 style) with a white checkmark, slightly glossy/premium, clearly visible next to dealer/agency names. "Vérifié Yayo" / "Verified Shipping Partner". It should look valuable and instantly recognizable — it's the core trust symbol. Make it beautiful, not minimal.
- LANDED PRICE CLARITY (critical — prevents scaring buyers): the "landed price" breakdown must make it OBVIOUS that the buyer does NOT send the whole total to the dealer. Clearly separate: "Prix payé au dealer" (car price — this is what goes to the seller) vs. "Frais payés séparément" (freight to the agency, customs to the government, fees). Reword so a buyer understands the big number is the full journey cost paid to different parties over time, not one payment to the dealer. Label all freight/customs/fees as "estimation". Position and explain it so no buyer thinks the total is what they wire to the dealer. Payments happen off-platform for now.
- ESTIMATES ARE NOT YET REAL: freight and customs figures are currently rough placeholders. Freight must come from the real agency's price once agencies onboard; customs % must match each country's real duty formula. Until then, label clearly as "estimation" and never present as final. This is a known item to make real before heavy buyer use.
- LANGUAGE SWITCHER: the FR/EN/AR switch must be labeled so users understand it — show a globe icon + word "Langue / Language" (or the current language name), not just bare letters.
- ALL DASHBOARDS must look professional: clean data visualizations / charts (signups trend, views over time, leads, revenue-style cards), not just plain tables. Dealer, agency, and admin dashboards each need a polished overview with graphs.

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
- CRITICAL SEPARATION — identity vs. authorization: logging in (Google/email/phone) only proves identity. It must NEVER auto-make someone a verified dealer/agency. Everyone is a BUYER by default. To sell, they submit a separate registration form (business name, city, contact, description, uploaded trade license to the private licenses bucket; agencies also add routes/addresses/coverage). Their status becomes "pending" (En attente de vérification): they get a dashboard and can prepare their profile/listings, BUT listings are NOT visible to buyers, no "Vérifié" badge shows, and buyers cannot contact them until an admin reviews the license and approves. Admin approves → badge + listings go live; or rejects with reason. BUG TO FIX: currently a Google login can land straight on a dealer dashboard showing "✓ Verified" without any admin check — verification must be admin-approved only, never automatic.
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
14. ✅ LOGO + GALLERY uploads (dealers + agencies) — buckets car-photos & agency-photos
15. ✅ Admin control room v2 — roles, verify/reject/suspend, licenses, users, stats, audit log + GA4

NEXT BUILD QUEUE (added 2026-07-11, founder-approved — build in order, batch 3–4 per session):
Claude: the founder is non-technical and trusts your judgment on marketplace UX and AI — you know this domain better than he does. For every item below use your own brain to make it as user-friendly and PREMIUM as possible; don't build the minimal version, build what a top marketplace would ship. Test everything yourself before showing.
1. REAL CUSTOMS FORMULAS — research the published duty structures for DRC / Cameroun / Côte d'Ivoire / Sénégal (import duty + VAT + excise + port/doc fees, age-based rules where they exist) and encode them per country in js/config.js with a per-line breakdown. Every figure stays clearly labeled "estimation" until verified with a real customs broker.
2. LEGACY ACCOUNT RECONNECTION — yayo_claim_legacy security-definer RPC (SQL) + client call after login: the 29 old-Yayo accounts (14 WhatsApp + 15 email, in public.users.identifier) get favorites/conversations re-attached automatically on first login with the same number/email. Email side works immediately; phone side activates when SMS login is live.
3. REAL-TIME CHAT — messages appear instantly without refresh via Supabase Realtime (already in the project, no new account/cost). Both sides: buyer inbox (messages.html), dealer & agency dashboard chat. Unread badge updates live too.
4. EMAIL NOTIFICATION "un acheteur vous a écrit" — when a message arrives and the recipient is away, send a short notification email (NO message content — just "nouveau message sur Yayo" + link) via Brevo through a Netlify Function (BREVO_API_KEY env var). Written in the RECIPIENT's language (FR/EN/AR), never French-only.
5. PHONE-LOGIN SMS VIA BREVO — Brevo also sends transactional SMS: wire Supabase's "Send SMS" auth hook to a Netlify Function that delivers the OTP via Brevo SMS (no Twilio needed). Founder supplies BREVO_API_KEY + enables the hook; Claude supplies the function + exact dashboard steps.
6. LISTING FORM UPGRADE — separate MAKE / MODEL / YEAR fields instead of one free-text "car name" (kills the Ferrari-shows-as-Toyota bug class, enables real brand filters), smart make dropdown. PLUS multi-photo gallery on voiture.html: all photos browsable big (swipe on mobile, thumbnails on desktop) — today only the first photo shows large.
7. TERMS + PRIVACY PAGE — honest FR draft (conditions d'utilisation + confidentialité) in the site design; founder READS AND APPROVES before it's linked publicly. EN/AR via i18n. Covers: buyers free, subscriptions, payments outside platform, Yayo = intermediary not party to the sale, estimates disclaimer, data/privacy, account deletion.
8. YAYO EMAIL TEMPLATES — beautiful navy/turquoise HTML emails (signup confirmation, password reset, magic link) ready to paste into Supabase → Auth → Email Templates. CRITICAL: Supabase has ONE template per type and doesn't know the user's language — each template must stack all three languages in one email: FR first, then EN, then AR (RTL block). Never French-only.
9. "SIGNALER UN PROBLÈME" — discreet report link on every page (footer + car page + chat) → reports table (RLS: anyone insert, admin read) → "Signalements" tab in admin dashboard with status workflow (nouveau → en cours → résolu) + link to the reported item.
10. STRIPE PAYMENT LINKS — dealer subscription checkout: founder creates the Stripe account + payment links per tier; Claude builds the flow (vendre pricing buttons → Stripe link → success → admin marks subscription active). Build when a dealer is ready to pay.
11. END-TO-END PENDING→APPROVAL TEST — Claude self-tests the full trust ladder on the deploy preview with a temporary account (register dealer → pending, invisible to buyers → admin approves → badge + listings live → reject/suspend paths) and reports a checklist.
Later phases: Assistant Yayo Autonomous mode (Mode 3) with dealer rule limits; full agency dashboard (methods, cargo, locations/maps, bookings, tracking, reviews, full pricing matrix); Yayo Sécurisé (deposits via Flutterwave/mobile money); shipment tracking; diaspora mode ("Acheter pour un proche"); SEO landing pages per route/country; LEGACY ACCOUNT RECONNECTION — the 29 old-Yayo accounts (14 WhatsApp + 15 email) live only in public.users (identifier column), visible in admin with the 📱 tag but unable to log in; when one returns via phone-OTP or email login with the same number/email, automatically re-attach their old favorites/conversations via a security-definer RPC (e.g. yayo_claim_legacy) that matches the identifier to the new auth account and migrates user_id references.
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

## Website Import + Listing Limits

### Purpose
Two connected features:
1. Website Import — a dealer pastes his website link and all his cars appear in his dashboard, exactly as if added manually.
2. Data-driven listing limits — how many listings each dealer can publish, changeable in the future by editing data (no code deploy). Launches as UNLIMITED for the first dealers, controllable later.

### Locked decisions (do not violate)
- Buyers are always free. Unchanged.
- Login never auto-verifies dealer status. The Vérifié badge still requires registration + license upload + admin review. Import publishes THROUGH this existing flow, never around it.
- Human-triggered first, autonomy later: ship manual import + review gate first; auto-sync is a later upgrade.
- Reuse existing systems: multi-photo gallery, Vérifié flow, auth roles, Supabase schema. Do not rebuild them.
- Always produce complete deployable files; list all changes and get approval before building.

### Website Import — behaviour
- Dealer flow: paste link (+ "I own this site" checkbox) → Yayo reads site → review screen (all cars pre-ticked, cover photo + photo count) → "Confirmer tout" → cars appear in dashboard like manual listings.
- Extraction: try structured data (JSON-LD / schema.org) first; fall back to Groq (LLaMA) on raw HTML. Crawl paginated inventory pages automatically.
- Photos: collect ALL photos per car, grouped under one listing. First photo = cover; rest = gallery. Download and re-host into Supabase storage — never hotlink. Also check Open Graph, lazy-load attrs (data-src/data-lazy), and <noscript> to catch JS-hidden photos.
- Quantity: up to ~50 cars import in one shot; 50+ use a background function with a progress bar, listings appearing in batches. Photos are the main time cost.
- Duplicate prevention: each car gets a fingerprint = its own source_url + dealer id (fallback: make+model+year+price+first-photo-hash). Before writing, check if the dealer already has that fingerprint. Match → skip (optionally update price/photos). No match → import. Same URL pasted twice → "Everything's already imported."
- Re-import (ship first): dealer clicks import again → Yayo shows ONLY new cars; existing listings untouched.
- Deferred: auto-sync (nightly cron re-read → pending tray), and headless browser for SPA sites. For SPA sites now, detect and tell the dealer to add manually.

### Listing limits — data-driven control
- Principle: the limit is DATA, not code. It lives on each dealer's record and is edited from the admin panel — never a code deploy.
- Dealer fields: plan (starter/pro/elite), normal_limit (Starter 10 / Pro 50 / Elite unlimited), promo_limit (a number or unlimited), promo_until (date).
- The single rule: if today < promo_until → use promo_limit; else → use normal_limit. This handles number promos, unlimited promos, VIP deals, and campaigns with one rule.
- Unlimited is a sentinel value (e.g. -1 / unlimited:true), handled by the same rule — nothing special to build.
- Launch: first dealers get promo_limit = unlimited with a promo_until date.
- Graceful downgrade: when a promo ends, dealer drops to normal_limit. Extra listings become status = dormant (hidden, NOT deleted), with an upgrade prompt. Dormant listings auto-reactivate when the dealer makes room (upgrade or frees a slot).
- Import respects the effective limit: always READ all cars; PUBLISH up to the limit; overflow cars show as locked with an upgrade prompt. During the unlimited promo, nothing is locked.

### Schema additions
- listings: source_url, import_method (jsonld/llm/manual), imported_at, status (active/dormant)
- dealers: plan, normal_limit, promo_limit, promo_until

### Build order (each step tested before the next)
1. Schema fields + migration.
2. Limit rule + admin control; set first dealers to unlimited.
3. Import function (JSON-LD first → Groq fallback → pagination → fingerprint dedupe → re-host photos). Returns candidates, does not publish.
4. Dashboard button + review screen; publish through existing Vérifié flow; respect effective limit.
5. Graceful downgrade + dormant listings.
6. (Later) auto-sync; headless browser for SPA sites.

### Open decisions to confirm with Yayo
- Promo timing: per-dealer 3 months from signup (recommended) vs one global window.
- Fallback limit after promo ends (Starter 10, or a softer step).
- Is import available on Starter, or Pro+ only.
- Exact length of the launch unlimited promo, and how many "first" dealers qualify.