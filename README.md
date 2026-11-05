# Hyte

A personal planning PWA for iPhone Safari, built with React and Vite for deployment on Vercel. English uses the device system font; Arabic uses bundled Tajawal fonts.

## Features

- Home, Calendar, My Space, and Prayers navigation with a shared iOS-inspired visual system.
- System, light, and dark appearance modes and device-local Home wallpapers.
- Saved tasks, calendar events, goals, notes, and consecutive 40-day challenges with reset confirmation.
- Month, week, day, and agenda calendar views, category filters, and calendar-file snapshot exports.
- Arabic prayer labels, Hijri date presentation and adjustment, reviewed monthly timetable entries, and source-image history.
- Editable timetable import review with manual entry and optional authenticated server-side image extraction.
- Local persistence, data backup/restore, and optional private Supabase cloud persistence.
- Optional Web Push endpoints and persistent notification scheduling infrastructure.

Prayer times are displayed only after confirmed timetable data is supplied. The app does not infer a prayer convention or fabricate missing times. New installations contain no personal planning records.

## Run locally

Use Node.js 22 or newer.

```sh
npm ci
npm run dev
```

The Vite server runs the frontend. Cloud API functions require Vercel's local runtime or a configured Vercel deployment.

```sh
npm test
npm run build
npm run preview
```

## Cloud setup and deployment

See [the setup guide](docs/SETUP.md) for the database schema, owner authentication, environment variables, optional image extraction, and background notifications. The schema is in [supabase/schema.sql](supabase/schema.sql).

Import this repository into Vercel using the Vite framework preset. The build command is `npm run build` and the output directory is `dist`. Add the relevant environment variables from `.env.example` in Vercel before enabling cloud services. Installing or deploying the frontend does not configure these services automatically.

Never commit real environment files, credentials, timetable images, backups, or personal records. Privileged keys belong only in server-side configuration. Supabase row-level security and the owner allowlist must be configured before storing real data in the cloud.

On iPhone, open the deployed HTTPS URL in Safari, choose Share → Add to Home Screen, then open the installed app. Push requires compatible iOS support, user permission, a registered device subscription, a configured sender, and a working authenticated scheduler.

## Integration limits

- Calendar exports are snapshots, not updating subscriptions or two-way Apple Calendar sync.
- Apple Reminders currently has a manual copy-text handoff. An installed Apple Shortcut is not included.
- Wallpaper and original timetable images remain on the device where they were uploaded; structured cloud sync does not sync those images.
- Notes use an explicit Save action. Recurring events, drag-and-drop rescheduling, a wallpaper crop editor, and cloud media sync are not implemented.
- Real cloud sign-in, database policies, image extraction, and iPhone notification delivery require configuration and live verification.

## Validation

The initial implementation has 32 automated tests covering date/time handling, challenge streaks, prayer selection, import and backup validation, import undo, calendar exports, scheduling, and API boundaries. The production build passes. Physical iPhone and configured-cloud checks remain necessary before relying on the app for daily reminders.

Tajawal is distributed under its included [SIL Open Font License](public/font-license.txt). Hyte branding is supplied by the project owner. This public source snapshot excludes local planning documents, supplied visual references, QA screenshots, and private project identifiers.
