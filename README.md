# Logic Lanes

Smart logistics for India's domestic freight, built by **Team Torvalds** for the **AI for Smart Mobility** hackathon.

Trucks in India often drive back empty after a delivery ("deadheading"), routes are planned by phone
calls, and nobody knows where a load is until it arrives. Logic Lanes fixes those three things:

1. **It fills the return trip.** A new load is matched first to a truck that is about to finish a
   delivery in the pickup city, so it drives back loaded and the client pays less.
2. **It guides the trip.** Each driver gets a digital Job Card and a live map with a truck-aware road
   route, weather, next turns and an SOS button.
3. **It keeps everyone informed.** Clients track the truck live, get an arrival time, and are told at
   once when the route changes or something goes wrong.

---

## Contents

- [Tech stack](#tech-stack)
- [Setup](#setup)
- [Logging in](#logging-in)
- [Features: landing page](#features-landing-page)
- [Features: client portal](#features-client-portal)
- [Features: driver portal](#features-driver-portal)
- [Features: admin panel](#features-admin-panel)
- [How the engine works](#how-the-engine-works)
- [APIs used: what, why and where from](#apis-used-what-why-and-where-from)
- [Supabase explained](#supabase-explained)
- [Environment variables](#environment-variables)
- [Project structure](#project-structure)
- [Demo script](#demo-script)
- [What has and has not been tested](#what-has-and-has-not-been-tested)
- [Known limits](#known-limits)
- [Troubleshooting](#troubleshooting)

---

## Tech stack

| Layer | What we use | Why |
| --- | --- | --- |
| Framework | Next.js 15 (App Router), React 19, TypeScript | Server Components fetch data on the server; Server Actions handle every form and button without hand-written API endpoints. |
| Styling | Tailwind CSS 3, Framer Motion | Three-colour palette as Tailwind tokens; small, quick animations. |
| Database, auth, live updates | Supabase (Postgres, Auth, Row Level Security, Realtime) | One hosted service for data, login and push updates. |
| Map | Leaflet + OpenStreetMap tiles | Free, needs no API key. |
| Road routing | OpenRouteService | Free tier, and it has a heavy-goods-vehicle routing profile. |
| AI text | Google Gemini → Groq → built-in writer | Three engines in a failover chain, so the demo never breaks. |
| Weather | WeatherAPI.com → OpenWeatherMap → Open-Meteo | Same idea: the last one needs no key. |
| Payments | UPI deep link rendered as a QR (`qrcode.react`) | The standard way to pay in India; no payment gateway account needed. |
| Hosting | Vercel (AI and routing calls run on the Edge runtime) | Edge functions are not cut off by the serverless timeout during slow LLM calls. |

**Design:** Pearl Perfect `#FBF9E4` (surfaces), Midnight `#122C4F` (accents), Noir `#000000` (text),
plus one emergency red `#B42318` used only for SOS. Frosted "glass" cards, 48px minimum touch targets,
large type, visible focus rings, and reduced-motion support.

---

## Setup

### 1. Database (Supabase SQL Editor)

Run these three files **in this order**. Paste each whole file into the SQL Editor and press Run.

| Order | File | What it does |
| --- | --- | --- |
| 1 | [`supabase/schema.sql`](supabase/schema.sql) | Tables, enums, triggers, RLS policies, Realtime, and seed data (32 cities, 15 clients, 6 drivers, 8 shipments). **Drops and recreates the app's tables**, so use a project dedicated to this app. |
| 2 | [`supabase/auth.sql`](supabase/auth.sql) | `profiles` table, the sign-up trigger, and tighter RLS for real logins. |
| 3 | [`supabase/upgrade.sql`](supabase/upgrade.sql) | SOS flag on Job Cards, the Indian per-km rate card, and the payment flag on shipments. |

Files 2 and 3 are additive and safe to re-run. Re-run both whenever you re-run `schema.sql`.

For a demo, also turn off **Authentication → Sign In / Providers → Email → Confirm email** in the
Supabase dashboard. Otherwise a new account must click an email link before its first login.

### 2. Environment

Copy `.env.example` to **`.env.local`** and fill it in. Next.js does not read `.env.example`.
Only the three Supabase values are required. See [Environment variables](#environment-variables).

The Supabase URL must look like `https://<project-ref>.supabase.co`, not the dashboard address.

### 3. Demo logins

The seeded clients and drivers have no passwords until you run this once. It asks you for one
passcode (at least 8 characters) that all demo accounts will share:

```bash
node --env-file=.env.local scripts/seed-demo-users.mjs
```

### 4. Run

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000.

### 5. Deploy to Vercel

Import the repository and add the same environment variables in Project Settings. Set
`ADMIN_PASSCODE` there: without it the admin panel stays locked in production.

---

## Logging in

There are three kinds of user. Clients and drivers use real accounts (Supabase Auth); the admin uses a passcode.

### Clients ("Ship Cargo" card)

- **Log in:** email + passcode.
- **Register:** choose **Individual** or **Company / Business**, then name (or company name), mobile
  number, city, email, passcode. You land on `/client/dashboard`.

### Drivers ("Fleet Partner" card)

- **Log in:** registered driver email + passcode.
- **Register:** name, mobile number, home city, vehicle category, optional vehicle number, and
  **Gig Transporter** (you choose your jobs) or **Full-Time Fleet Employee** (jobs are assigned to
  you first), then email and passcode. You land on `/driver/dashboard`.

### Admin (hidden)

On the landing page, **triple-click the footer logo** or press **Ctrl + Shift + A**, then enter
`ADMIN_PASSCODE`. In local development the panel opens with no passcode if the variable is empty.

### How login works underneath

1. The form calls a **Server Action** (`src/app/actions/auth.ts`), which calls
   `supabase.auth.signUp` or `supabase.auth.signInWithPassword` on the server.
2. On sign-up the app sends metadata: `{ role, client_type | driver_type, full_name, phone, city, vehicle_type, vehicle_number }`.
3. A **database trigger** (`handle_new_user` in `auth.sql`) reads that metadata and, in one
   transaction, creates the row in `public.profiles` and the matching row in `clients` or `drivers`.
   If the trigger fails, the sign-up is rolled back, so an account can never exist without its profile.
4. The session is stored in an **httpOnly cookie**. Each portal has its own cookie
   (`fp-client-auth`, `fp-driver-auth`), so a client and a driver can be signed in side by side in one browser.
5. **`src/middleware.ts`** runs before every `/client/*` and `/driver/*` page. It refreshes the
   session, sends visitors who are not signed in back to the landing page, and checks the role in
   `profiles`. The role is never read from user metadata, because users can edit that themselves.
6. A driver account used on the client card (or the reverse) is rejected with a clear message.

Every field is validated as you leave it and again on the server. Errors are shown in **English and
Hindi**, for example "Invalid credentials / गलत क्रेडेंशियल्स".

### Demo accounts

After running the seed script, log in with these emails and the passcode you chose:

| Portal | Email | Who |
| --- | --- | --- |
| Driver | `ramesh.yadav@fleetpulse.demo` | Full-time, 19-ft truck |
| Driver | `gurpreet.singh@fleetpulse.demo` | Full-time, 14-ft truck |
| Driver | `imran.khan@fleetpulse.demo` | Gig, 14-ft truck |
| Driver | `suresh.patil@fleetpulse.demo`, `murugan.selvam@fleetpulse.demo`, `bikram.das@fleetpulse.demo` | Others |
| Client | `anjali@konkanagro.demo` | Konkan Agro Exports, Premium |
| Client | `vikram@sahyadristeel.demo` | Sahyadri Steel Works, Plus |
| Client | `pooja@yamunaceramics.demo` | Yamuna Ceramics, Standard |

The script prints all 21. The emails still say `fleetpulse` (the project's earlier name); changing
them would break existing logins. For every email the password is - demo@1234

---

## Features: landing page

- **Background video** (`public/landing-bg.mp4`) playing behind the page. The top of the screen is
  blurred like frosted glass and fades to fully clear in the lower half. The video is muted, loops,
  and pauses for people who have asked their device for reduced motion.
- **Split entry:** headline on the left, the two portal cards (Ship Cargo, Fleet Partner) on the
  right. On phones a switch shows one card at a time.
- **Login / Register tabs** on each card, with inline bilingual validation and a loading spinner.
- **"Signed in as…"** shortcut on a card if that portal already has a session.
- **Hidden admin trigger** in the footer logo.

---

## Features: client portal

`/client/dashboard`

### Cargo booking

Enter what you are sending, goods type, weight, pickup and drop-off city, pickup date and deliver-by
date. As you type the weight, the form shows the vehicle class that will be used and its per-km rate
band. Submitting runs the `bookShipment` Server Action, which validates, prices, saves and
**dispatches a truck in the same step**. The result shows the freight, the driver, and why that
driver was chosen.

### Pricing: the Indian rate card

Freight = distance × a per-km rate for the vehicle class the load needs.

| Load | Vehicle | ₹ per km | Suitable cargo |
| --- | --- | ---: | --- |
| 0–750 kg | Tata Ace | 22–30 | Small parcels, FMCG |
| 750 kg–1.5 T | Pickup / Bada Dost | 26–35 | Retail, agricultural goods |
| 1.5–3.5 T | 14-ft truck | 31–40 | Furniture, machinery, cartons |
| 3.5–5 T | 17-ft truck | 34–45 | Industrial / FMCG |
| 5–7 T | 19-ft truck | 37–50 | Bulk goods |
| 6–8 T | 20-ft container | 41–55 | Protected / valuable cargo |
| 7–18 T | 32-ft container | 55–91 | Large commercial loads |
| 15–25 T | Multi-axle / trailer | 65–100 | Heavy industrial cargo |

The app picks the smallest class that fits. Within a class, a load at the bottom of its weight range
pays the bottom of the band and a full truck pays the top. Then discounts apply:

- **Membership discount:** 0%, 5% or 12%.
- **Return-trip discount:** 18% when the load fills a truck's empty return leg.

Example: 6,200 kg, Mumbai → Bengaluru (984 km) uses a 19-ft truck at ₹44.80/km = ₹44,100 before discounts.

The client is billed for the class the load needs, even if a bigger truck ends up carrying it.

### Membership

| Plan | Price | Freight discount | Dispatch priority | Updates | AI briefing |
| --- | --- | --- | --- | --- | --- |
| Standard | Free | 0% | Normal | Every 30 s | No |
| Plus | ₹2,999 / month | 5% | Higher | Instant (Realtime) | No |
| Premium | ₹7,999 / month | 12% | Highest | Instant (Realtime) | Yes |

Switching plans is instant. No payment is taken for membership in this demo.

### Live tracking

When a shipment is on the road its card shows:

- **Estimated arrival** with a live countdown, **distance left**, and **current speed**.
- A **live map** with the route and the moving truck. Press **Follow truck** to zoom in on it.
- A progress bar, the driver's name and vehicle number, and "Rerouted" / "Return-trip match" tags.
- For Premium: the **AI briefing** (goods, route and weather risk in two or three sentences).
- A red **Emergency reported** banner if the driver has raised an SOS.

### Payment after delivery (UPI)

A Payment panel sits at the bottom of each shipment once a driver is confirmed.

- **Before delivery:** trip brief (distance, cargo type, freight) and the notice "Payment will unlock
  after the job is successfully delivered." No QR code is generated.
- **After delivery:** a **UPI QR code** for the exact freight, with the shipment reference as the
  payment note, and a **Mark as Paid** button. On phones there is also "Pay in a UPI app".
- **After marking paid:** a receipt line, and the shipment moves to Order history.

The QR encodes `upi://pay?pa=<UPI_ID>&pn=LogicLanes&am=<amount>&cu=INR&tn=Freight <reference>`.

### Notifications

A live feed: driver assigned, picked up, city milestones (Plus and Premium), delays, route changes,
SOS, delivered. New ones also pop up as a toast. Each notification is clickable and jumps to its shipment.

### Right-hand panel

- **Trucks available:** idle trucks grouped by city, your city first. Counts only, no driver details.
- **Order history:** scrollable list of delivered and paid orders, with a freight total.

---

## Features: driver portal

`/driver/dashboard`

### Live map

- OpenStreetMap, tinted to the palette. The route is a Midnight line; pickup, drop-off, detour and
  incident markers are Noir.
- The route follows **real roads** from OpenRouteService. Heavy trucks are routed with the
  heavy-goods-vehicle profile.
- The truck **drives smoothly along the line** in real time. **Follow truck** zooms to street level
  and keeps it centred; drag the map or press "Whole route" to go back.
- A **weather box** floats over the map: conditions at the truck and at the destination.
- A **return-load prompt** slides up over the map when the truck is 60% of the way there.

### Job Card

One card with everything for the trip, most important first:

- Reference, route, client, and status.
- **Goods:** the exact description, weight, cargo type, vehicle.
- **Live numbers:** arrival time, distance left, **speed now** (a live reading), progress bar.
- **AI briefing** with an "Update briefing" button, and which engine wrote it.
- **Next turns:** the current instruction and the three after it, with distances.
- **Itinerary:** the towns on the route; passed ones are filled in, detours are marked.
- **Pay:** what the driver earns for this trip.
- **Actions:** Accept / Reject (offers), Start trip, Mark delivered.
- **Route changed** alert when the trip has been rerouted, with the reason and expected delay.

### Getting jobs: three ways

| How | Who | What happens |
| --- | --- | --- |
| **Assigned** | Full-time employees | The system assigns the job outright. The driver presses Start trip. |
| **Offered** | Gig drivers | The driver gets an offer with Accept / Reject, on the Job Card and inside the notification. A rejected load is passed to the next best driver. |
| **Orders near you** | Any idle driver | Open loads within 150 km that fit the truck appear as cards showing origin, destination, cargo and payout, with Accept / Reject. Rejecting hides that load from that driver for good. |

**Return-trip loads:** while on a trip, a driver nearing the destination is shown loads leaving that
city, with ones heading towards home ranked first. Taking one queues it to start after the current delivery.

### Earnings drawer

The balance button at the top right opens a drawer with **account balance**, **earned this month**,
**earned all time**, monthly salary (full-time drivers), and a **transaction history** of delivered
trips with date, route and amount. Gig drivers earn 70% of freight; employees earn an 8% trip
incentive on top of salary.

### Emergency / SOS

On the Job Card of a trip that is on the road:

- **Tap-to-call numbers:** 112 (National Emergency), 1033 (NHAI Highway Helpline), 108 (Ambulance).
- **TRIGGER SOS** opens a confirmation dialog first, so a stray touch while driving cannot raise an
  alarm. "Cancel" has the focus.
- **Confirming** alerts the client and the admin in the app, stops the truck's clock, puts a red
  ring and a pulsing "SOS active" badge on the card, and shows the toast "SOS Alert Broadcasted".
- **"I am safe now"** clears it; the admin can also mark it resolved.

**The SOS does not contact the police or an ambulance.** The dialog says so and tells the driver to
call 112.

---

## Features: admin panel

`/admin` (hidden; see [Logging in](#logging-in))

- **Overview:** clients, drivers on trip, active routes, open loads, return-trip matches, and empty
  kilometres avoided.
- **Service status chips:** which of Gemini, Groq, OpenRouteService and the weather provider have a key configured.
- **Active routes**, each with a route map and controls:
  - **Simulate an incident** ahead of the truck: Accident, Heavy traffic, Severe weather, Road
    closure. The route changes, the Job Card shows the alert, and driver and client are notified.
  - **Demo clock:** Pause, Real, 10x, 60x, 300x. Trucks drive in real time by default; use this to
    fast-forward a demo.
  - **AI failover test:** tick "Google Gemini down" and/or "Groq down", then rewrite the briefing or
    simulate an incident. The panel lists each engine tried, whether it answered, and how long it took.
  - **Replay from 50%** to put a delivered trip back on the road.
  - **SOS banner** with the driver's phone as a call link and a "Mark resolved" button.
- **Tables:** all shipments (with "payment due" / "paid"), drivers, and clients.
- **Incident log** and a feed of every notification sent.

---

## How the engine works

### Automated matching (`src/lib/matching.ts`, `src/lib/dispatch.ts`)

Every driver who is not offline and whose truck can carry the load gets a score:

| Signal | Points |
| --- | --- |
| Finishing a delivery in the pickup city (the load fills the return trip) | +100 |
| …and the load is heading to the driver's home city | +30 |
| Already idle in the pickup city | +70 |
| Idle elsewhere | up to +50, less the longer the empty run; skipped beyond 600 km |
| Full-time employee | +15 |
| Driver rating | rating × 2 |
| Premium client and a driver rated 4.7 or more | +8 |
| Truck much bigger than the load | up to −10 |

The best score wins. A full-time driver is assigned; a gig driver is sent an offer. If nobody fits,
the shipment stays open and is shown to drivers nearby and to trucks arriving in that city. A driver
can hold at most one running trip and one queued job.

### Routes

1. On booking, the app builds an **estimated route** through cities from the `cities` table.
2. When a map first shows that Job Card, it calls `/api/route`. The server asks **OpenRouteService**
   for the real road route (`driving-hgv` for trucks that must avoid narrow roads, `driving-car` for
   light ones) and saves the geometry, distance, time and turn-by-turn steps on the Job Card.
3. From then on every screen, and the truck simulation, follows real roads.

### Live rerouting (`/api/ai/reroute`, `src/lib/routing.ts`)

When the admin simulates an incident: the incident is placed about 60 km ahead of the truck, a
detour point is chosen off to one side, and the route rejoins beyond it. The delay is the extra
distance at the truck's speed plus 15 minutes per severity level. The AI chain writes the alert
text, the Job Card is updated, both sides are notified, and OpenRouteService then redraws the detour on real roads.

### AI failover (`src/lib/ai/failover.ts`)

Used for two things: the **goods and route briefing** and the **reroute alert**.

1. Try **Google Gemini** (7-second timeout).
2. If it fails, is rate-limited or times out, try **Groq**.
3. If that fails too, use the **built-in writer**, which builds the sentence from the same facts
   with no network call.

A caller always gets text back. Both API routes run on the **Vercel Edge runtime**.

### Truck simulation (`/api/sim/tick`)

There are no real GPS devices, so trucks are simulated. Every open dashboard calls the tick endpoint
every 5 seconds. It moves each truck by the time elapsed × its speed × the demo clock, so it does not
matter how many dashboards are open. Speed is faster on open highway and slower within 9 km of a
town on the route. Trucks only advance while some dashboard is open.

### Live updates (`src/components/LiveRefresh.tsx`)

Database triggers write a tiny "something changed" row to `live_events` whenever a Job Card,
shipment or notification changes. Browsers listen to that table over **Supabase Realtime** and
re-fetch the page from the server when a ping arrives. If Realtime cannot connect, the page polls on
a timer instead.

---

## APIs used: what, why and where from

| API | What we use it for | Why this one | Where to get the key | Env variable | If the key is missing |
| --- | --- | --- | --- | --- | --- |
| **Supabase** | Database, login, Realtime | One service for all three; generous free tier | supabase.com → your project → Project Settings → API | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | The app shows a setup screen |
| **OpenRouteService** | Real road routes, distance, time, turn-by-turn steps | Free (2,000 routes a day) and has a truck (HGV) routing profile | openrouteservice.org → Dev dashboard → API keys | `ORS_API_KEY` | Map still works; route is a city-to-city estimate |
| **OpenStreetMap tiles** | The map background | Free and needs no key | Nothing to get | none | Not applicable |
| **Google Gemini** | First-choice LLM for the briefing and reroute alert | Fast, good quality, free tier | aistudio.google.com → Get API key | `GEMINI_API_KEY`, `GEMINI_MODEL` | Groq is tried next |
| **Groq** | Second-choice LLM (failover) | Very fast inference on open models; OpenAI-compatible API | console.groq.com → API Keys | `GROQ_API_KEY`, `GROQ_MODEL` | The built-in writer answers |
| **WeatherAPI.com** | Weather at the truck and destination | Simple current-weather endpoint, free tier | weatherapi.com → My Account | `WEATHERAPI_KEY` | OpenWeather, then Open-Meteo |
| **OpenWeatherMap** | Alternative weather provider | Common alternative | home.openweathermap.org → API keys | `OPENWEATHER_API_KEY` | Open-Meteo |
| **Open-Meteo** | Weather fallback | Free and needs no key | Nothing to get | none | Weather box shows "unavailable" |
| **UPI deep link** | Payment QR after delivery | Standard in India; needs only a UPI id, no gateway | Your own UPI id (e.g. `name@okbank`) | `UPI_ID` | A "payment is not set up" note instead of the QR |

Notes:

- **Groq is not Grok.** Groq (groq.com) hosts open models; Grok is xAI's model. This app uses Groq.
- **Google Maps is not used.** An earlier version used it; it was replaced by OpenStreetMap +
  OpenRouteService because no Google key was available. As a result there is **no live traffic layer**.
- **WeatherAPI.com and OpenWeatherMap keys are not interchangeable.** Put each in its own variable.
- OpenRouteService, Gemini, Groq and the weather keys are used **only on the server**. They are
  never sent to the browser.

Where each is called in the code:

| API | File |
| --- | --- |
| OpenRouteService | `src/lib/ors.ts`, called from `src/app/api/route/route.ts` |
| Gemini, Groq | `src/lib/ai/failover.ts`, called from `src/app/api/ai/summary` and `src/app/api/ai/reroute` |
| Weather | `src/lib/weather.ts`, called from `src/app/api/weather` and the briefing route |
| OpenStreetMap | `src/lib/mapStyle.ts`, drawn by `src/components/map/RouteMap.tsx` |
| UPI QR | `src/components/client/ClientPaymentCard.tsx` |

---

## Supabase explained

Supabase is a hosted Postgres database with login and live updates built in. We use four parts of it.

### 1. Postgres: the tables

| Table | What it holds |
| --- | --- |
| `cities` | 32 Indian cities with coordinates. Used for dropdowns, distance estimates and "nearest town" labels. |
| `membership_tiers` | Standard, Plus, Premium: price, discount, priority, update speed, perks. |
| `vehicle_types` | The eight vehicle classes: capacity, per-km rate band, average speed, routing rule. |
| `admins`, `clients`, `drivers` | The three roles. `clients` has a plan and a type (individual / company); `drivers` has gig or full-time, vehicle, home city, live position, rating. Each has `auth_user_id`, linking it to a login. |
| `profiles` | One row per login: role, client or driver type, name, phone. Filled by the sign-up trigger. |
| `shipments` | A booking: goods, weight, cities, dates, vehicle class, status, price, discount, whether it is a return-trip load, and when it was paid. |
| `job_cards` | The driver's side of a shipment: status, route waypoints, road polyline, turn-by-turn steps, live progress, position, speed, ETA, AI briefing, SOS flag. A shipment can have several rejected cards but only one live one. |
| `incidents` | Accidents, traffic, weather and closures raised against a Job Card. |
| `notifications` | Every alert sent to a client, driver or the admin. |
| `live_events` | Content-free "something changed" pings for Realtime. |

Shipment status: `pending → offered → assigned → in_transit → delivered`.

### 2. Auth

Email + password accounts for clients and drivers. See [How login works underneath](#how-login-works-underneath).

### 3. Row Level Security (RLS)

RLS is switched on for every table. It decides which rows each key can see.

- The **anon key** (the one in the browser) can read only the reference tables (`cities`,
  `membership_tiers`, `vehicle_types`) and `live_events`. It cannot read any business data.
- A **signed-in user's own token** can read their own rows (a client their shipments, a driver their
  Job Cards) but cannot write them. Nobody can change their own plan, price or truck position by
  calling the database directly.
- The **service-role key** bypasses RLS. Only the Next.js server uses it, after it has checked who is
  signed in. It never reaches the browser.

So every read and write of business data goes: browser → Next.js server (checks the session) → Supabase.

### 4. Realtime

`live_events` is added to the `supabase_realtime` publication. The browser subscribes to inserts on
it, filtered by its own client or driver id. A ping carries no data; it only tells the page to
re-fetch through the server.

### The three keys

| Key | Where it lives | What it can do |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server | The project address |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser and server | Login calls and Realtime pings; RLS limits everything else |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Full database access. Never expose it. |

---

## Environment variables

All go in `.env.local` locally and in Vercel's Project Settings when deployed.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Supabase service-role key (server only) |
| `ORS_API_KEY` | Recommended | OpenRouteService road routes |
| `GEMINI_API_KEY` | Optional | First-choice LLM |
| `GEMINI_MODEL` | Optional | Defaults to `gemini-flash-latest` |
| `GROQ_API_KEY` | Optional | Failover LLM |
| `GROQ_MODEL` | Optional | Defaults to `llama-3.3-70b-versatile` |
| `WEATHERAPI_KEY` | Optional | WeatherAPI.com |
| `OPENWEATHER_API_KEY` | Optional | OpenWeatherMap (used only if `WEATHERAPI_KEY` is empty or fails) |
| `UPI_ID` | For payments | The UPI id freight is paid to |
| `ADMIN_PASSCODE` | In production | Passcode for the hidden admin panel |
| `SESSION_SECRET` | Optional | Signs the admin cookie; falls back to the service-role key |

After changing `.env.local`, restart `npm run dev`.

---

## Project structure

```
supabase/
  schema.sql            tables, RLS, Realtime, seed data
  auth.sql              profiles table + sign-up trigger
  upgrade.sql           SOS flag, rate card, payment flag
scripts/
  seed-demo-users.mjs   gives the seeded personas real logins
public/
  logo.png              logo
  landing-bg.mp4        landing page background video
src/
  middleware.ts         session refresh + route protection
  app/
    page.tsx            landing page
    client/dashboard/   client portal
    driver/dashboard/   driver portal
    admin/              admin panel
    actions/            Server Actions: auth, client, driver, admin
    api/
      ai/summary/       AI briefing (Edge)
      ai/reroute/       incident + reroute (Edge)
      route/            OpenRouteService road route (Edge)
      weather/          weather (Edge)
      sim/tick/         truck simulation (Edge)
  components/
    auth/               AuthCard, AuthPortals
    client/             BookingForm, ShipmentCard, ClientPaymentCard, Sidebar, MembershipPlans
    driver/             FleetMap, JobCardPanel, OpenLoadCard, ReturnLoadPrompt, SosPanel, WalletButton, WeatherWidget
    map/                RouteMap (Leaflet)
    admin/              AdminGate, RouteConsole
  lib/
    matching.ts         driver scoring
    dispatch.ts         assigning jobs, delivery completion, notifications
    pricing.ts          rate card and quotes
    routing.ts          route estimate, reroute geometry, vehicle profiles
    ors.ts, roadRoute.ts  OpenRouteService call and saving the road route
    ai/                 failover chain and prompts
    weather.ts          weather providers
    sos.ts              SOS raise and clear
    session.ts          who is signed in
    supabase/           server, browser and auth clients
```

---

## Demo script

Keep a driver tab, a client tab and the admin tab open side by side.

1. **Driver:** log in as `gurpreet.singh@fleetpulse.demo` and press **Start trip**. Press **Follow truck**.
2. **Client:** log in as `vikram@sahyadristeel.demo`. The shipment shows the live map, arrival time and speed.
3. **Admin:** Ctrl + Shift + A on the landing page. Set the **Demo clock** to 60x so the truck visibly moves.
4. **Reroute:** in the admin panel press **Accident**. The route changes on both maps, the Job Card
   shows the alert, and the client gets a notification.
5. **AI failover:** tick "Google Gemini down" and "Groq down", press **Rewrite AI briefing**, and
   show the list of engines tried.
6. **Return trips:** as a client, book Mumbai → Ahmedabad, about 12,000 kg. A truck that is in Mumbai
   and based in Ahmedabad gets it as a return-trip load at 18% off.
7. **Open orders:** log in as `ramesh.yadav@fleetpulse.demo` when he is idle and accept one of the
   "Orders near you" cards. Open his **earnings drawer**.
8. **SOS:** on a running trip press **TRIGGER SOS**, confirm, and show the banner on the client and admin screens.
9. **Payment:** set the Demo clock to 300x until the trip is delivered. The client's card swaps the
   "pay after delivery" notice for the UPI QR; press **Mark as Paid**.

---

## What has and has not been tested

Being honest about this matters for a live demo.

**Tested end to end on a local test database** (an in-memory Postgres with stand-ins for the Supabase
API and Auth): the schema and RLS policies, the sign-up trigger, booking and matching, gig
accept / start trip, return loads, incident rerouting, the truck simulation through to delivery, the
AI failover falling through to the built-in writer, sign-up, login, wrong-portal rejection, route
protection, sign-out, and the demo-login script.

**Seen working on the real Supabase project:** reading data, login with the seeded accounts, the
"Live" Realtime indicator, the Leaflet map with an OpenRouteService road route, and the weather box.

**Built and compiled, but not run in a browser by the developer:** the "Orders near you" cards, the
earnings drawer, the client side panel, the client live map, real-time truck movement and Follow
truck, the glass redesign and background video, SOS, the rate-card pricing through the booking form,
and the payment card. The pricing maths and the UPI link / QR generation were checked separately.

**Never called with a real key:** Gemini, Groq and WeatherAPI.com.

---

## Known limits

- **SOS does not contact emergency services.** It alerts the client and the admin in the app and
  shows tap-to-call buttons. The driver must make the call.
- **Payments are not verified.** "Mark as Paid" is the client's own declaration; the admin is
  notified to check the account. There is no payment gateway.
- **No live traffic.** OpenStreetMap and OpenRouteService do not provide it. Reroutes are triggered
  from the admin panel. Arrival time is distance left ÷ truck speed.
- **Trucks are simulated.** There is no GPS hardware; positions come from the simulation.
- **Membership changes take no payment.**
- **No "forgot passcode" flow** and no email-confirmation landing page.
- **The driver's balance is derived** from delivered trips. There is no payout or withdrawal.
- **"Trucks available" refreshes with the page**, not instantly when another driver's status changes.
- **The 20-ft container is chosen by weight only** (7–8 T); the "protected cargo" note does not affect the choice.
- **`job_cards.route_source` stores `'google'`** to mean "real road route". The name is left over
  from the first version.
- **The map tiles are tinted with a CSS filter**; individual map features cannot be recoloured.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| "Connect Supabase to continue" | `.env.local` is missing or the keys are in `.env.example`. Fill in `.env.local` and restart. |
| "The database did not answer" | The Supabase URL is the dashboard address. It must be `https://<project-ref>.supabase.co`. |
| Login or a button does nothing, or "Failed to find Server Action" in the terminal | The page is older than the running app. Refresh it. If it keeps happening and the folder is synced between machines (Syncthing, Dropbox), the `.next` build folder is being overwritten: exclude `.next` from sync on every machine (a `.stignore` is included for Syncthing), stop the server, delete `.next`, and restart. |
| Sign-up says "Your account has no profile yet" | `supabase/auth.sql` has not been run. |
| "Mark as Paid" says payments are not set up, or the SOS banner disappears on refresh | `supabase/upgrade.sql` has not been run. |
| New account cannot log in | "Confirm email" is on in Supabase. Turn it off, or click the link in the email. |
| Route stays a straight line with an "Estimated route" note | `ORS_API_KEY` is missing or wrong, or the free daily quota is used up. |
| Weather box says "unavailable" | No weather provider could be reached. It needs no key by default, so check the internet connection. |
| A colour or style change does not show | Restart `npm run dev`; Tailwind theme changes need it. |
| Truck is not moving | It moves in real time (about 15 m a second). Press **Follow truck**, or raise the Demo clock in the admin panel. |
