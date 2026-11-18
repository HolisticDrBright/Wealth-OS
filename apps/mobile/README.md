# Wealth OS — mobile (Simple mode)

A four-tab beginner app — **Home, Goals, Activity, Explore** — plus two
modals (**Approve a change**, **Pause everything**). Plain English, money in
dollars, no jargon. It always runs on practice money (paper mode); the app
cannot enable live trading.

Expo SDK 52 · expo-router 4 · NativeWind 4 · Supabase.

## How it works

The phone holds **no trading logic**. Every screen reads from the web app's
`/api/mobile/*` endpoints, sending the signed-in user's Supabase token as
`Authorization: Bearer …`. The server runs every query as that user under
Supabase row-level security and owns all rules: sizing, risk limits, the kill
switch, the Explore limit, approvals, and the 30-day practice run.

| Screen | Reads | Writes |
|---|---|---|
| Home | `GET /api/mobile/home` | `POST /api/mobile/resume` (after a confirm step) |
| Goals | `GET /api/mobile/goal` | `POST /api/mobile/goal` (monthly deposit) |
| Activity | `GET /api/mobile/activity` | — |
| Approve | `GET /api/mobile/approve` | `POST /api/mobile/approve` (recorded approval, then the web's guarded rebalance path) |
| Explore | `GET /api/mobile/explore` | `POST /api/mobile/follow` (recorded approval; auto-copy can't be turned on from the phone) |
| Pause | `GET /api/mobile/pause` | `POST /api/mobile/pause` (same code as the web's Flatten & Halt) |

## Run it

1. Start the web app (it serves the API), from the repo root:

   ```bash
   npm install
   npm run dev          # http://localhost:3120
   ```

2. Configure and start the phone app:

   ```bash
   cd apps/mobile
   cp .env.example .env
   # EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY: same project as the web
   # EXPO_PUBLIC_API_BASE_URL: the web app's URL. On a real phone use your
   #   computer's LAN address (e.g. http://192.168.1.20:3120), not localhost.
   npm install
   npx expo start       # press i (iOS simulator), a (Android), or scan the QR in Expo Go
   ```

3. Sign in with the same account you use on the web. A new account must finish
   onboarding (goal + risk profile) on the web first; the phone shows honest
   empty states until it has.

The web migrations `20260704j_ui_mode.sql` and `20260704k_automation_approvals.sql`
must be applied (Supabase SQL editor) for approvals to record.

## Checks

```bash
npm run typecheck       # tsc --noEmit
npm run lint            # eslint
npm run a11y:contrast   # every text/background token pair must reach 4.5:1
```

## Build

```bash
npm install -g eas-cli
eas login
eas build:configure     # creates eas.json the first time
eas build --platform ios      # or android
```

Before the first store build, add the icons `app.json` references —
`assets/icon.png` (1024×1024) and `assets/adaptive-icon.png` (Android
foreground) — they are not in the repo yet.

## Design tokens

Defined once in `tailwind.config.js` (NativeWind classes) and mirrored in
`src/theme.ts` for the few props that need raw values. Shared components live
in `src/ui/` — use them instead of styling from scratch:

- `Money` renders every dollar figure in JetBrains Mono.
- `Delta` always pairs ▲/▼ with colour — never colour alone.
- `StateView` gives every screen its loading / empty / error state.
- Buttons and filters are at least 44pt tall; text is at least 13pt (tab labels 11pt).
