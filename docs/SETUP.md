# Hyte cloud setup

The app's local features do not require accounts or keys. Cloud sync, image reading, and background alerts are optional services and are **not connected simply by building or deploying the app**. The server code and SQL in this project are preparation for those connections.

Do not put real secrets in a GitHub issue, chat message, browser field, or a `VITE_` variable. Use your local ignored `.env.local` for development and Vercel's Environment Variables for deployment. The frontend's Supabase publishable key is intentionally public; a service-role key is not.

## 1. Private database and sign-in

1. Create a Supabase project you own. Use a dedicated project for this personal app where practical.
2. In the SQL editor, review and run [`supabase/schema.sql`](../supabase/schema.sql). This creates the private state, owner allowlist, push subscriptions, queued alerts, extraction quota, and a private optional media bucket. This script has not been executed on your account.
3. Create or invite your own user under Authentication. Disable unrestricted new sign-ups for this personal app. Disable anonymous sign-ins. Configure your sign-in email provider/SMTP as appropriate.
4. Copy that user's UUID and run, replacing the placeholder:

   ```sql
   insert into public.hyte_owners(user_id) values ('YOUR_AUTH_USER_UUID');
   ```

5. Set the Auth site URL to the actual deployed Hyte URL. Add only the intended development and production redirect URLs. The browser's magic-link call should set `shouldCreateUser: false` so it does not silently create extra accounts.
6. Expose the `public` schema through the Data API if it is not already exposed. Explicit table grants are included in the setup script; do not disable row-level security to solve an access error. Current Supabase projects no longer automatically grant Data API access to every newly created table.
7. Add the environment variables below and redeploy. Restart local development after changing frontend variables.

For the installed iPhone app, accept your invitation in the browser, then set your own password under Settings → Storage & account → Set or change password. Choose Password when signing in from the Home Screen app. Safari and installed web apps keep separate storage; the password option allows sign-in inside the installed app. Hyte sends password updates directly to Supabase Auth and does not include passwords in planning backups.

| Variable                        | Where         | Purpose                                                                         |
| ------------------------------- | ------------- | ------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | Browser build | Your Supabase project URL                                                       |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser build | Project publishable key; never use the service role here                        |
| `SUPABASE_URL`                  | Server        | Same project URL; falls back to the browser URL when present                    |
| `SUPABASE_PUBLISHABLE_KEY`      | Server        | Publishable key used to validate bearer sessions; falls back to the browser key |
| `SUPABASE_SERVICE_ROLE_KEY`     | Server secret | Privileged queue/subscription operations; never expose to browsers              |
| `HYTE_OWNER_ID`                 | Server        | The same Auth user UUID inserted in `hyte_owners`                               |

Only the allowlisted owner can read/write `hyte_state`. Every row also checks its `user_id` against the authenticated user. The browser cannot directly create queue jobs or push subscriptions. Server endpoints validate the session with `auth.getUser(token)`, require `HYTE_OWNER_ID`, and verify the database owner row. User-editable metadata is not used for authorization.

### State persistence contract

`public.hyte_state` contains `{ user_id, data, revision, updated_at }`. `data` is the application's versioned JSON document. Start with revision `1` on the initial insert. To save a subsequent edit, increment the revision and update with both `.eq('user_id', user.id)` and `.eq('revision', previousRevision)`, followed by `.select()`. An empty result means another device saved first. Fetch/reconcile explicitly rather than silently overwriting that device's data.

Use the browser session's access token only as an `Authorization: Bearer …` request header for server endpoints. Never include it in a URL or log it. No personal state is bundled into the public app build.

After a successful cloud save, call `POST /api/schedule` if scheduled alerts are configured. Also call it after first enabling alerts or adding a new push subscription. The scheduler rebuilds future alerts from the latest persisted state, not from untrusted client-supplied notification jobs. State changes must be synced for the server to know about them.

### Source images and wallpaper

The `hyte-media` bucket is private and accepts PNG/JPEG/WebP files up to 10 MB. If cloud media upload is implemented, paths must be `<owner UUID>/<unique filename>`; use authenticated downloads or short-lived signed URLs, never a public bucket. Local IndexedDB files do not automatically become cloud files. The UI must distinguish device-local images from synced images. Deleting an import should not delete unrelated records, and deleting a user's data should also remove that user's stored objects deliberately.

## 2. Optional timetable image reading

Add server-only `OPENAI_API_KEY` and optionally `OPENAI_VISION_MODEL`. The implemented default is `gpt-4.1-mini`, a documented image-input model with structured outputs. API access/billing is separate from the app and must be configured in your own account. Do not send an image until the UI has explained that it will be processed by the external image service.

`POST /api/extract` requires the owner's bearer token and this JSON body:

```json
{
  "image": "data:image/jpeg;base64,...",
  "month": "User-confirmed Hijri month/year or an empty string",
  "anchorDate": "2026-11-05",
  "city": "Muscat"
}
```

The date above is an example of the expected format, not a timetable entry. `anchorDate` can be empty if unknown; the model must then omit rows that cannot be dated and return warnings. The anchor must actually correspond to an identifiable date in the image; supplying today's date arbitrarily is not sufficient.

The JSON body must be smaller than 4 MB, and the decoded image smaller than 2.9 MB. Crop/compress before sending. PNG/JPEG/WebP signatures are checked. The server limits image reads to 20 attempts per owner per UTC database day, validates output dates/times, and never saves the model's output directly.

Response shape:

```json
{
  "days": [
    {
      "date": "YYYY-MM-DD",
      "hijriLabel": "",
      "entries": [{ "name": "الفجر", "time": "HH:mm", "kind": "prayer" }]
    }
  ],
  "events": [
    {
      "title": "",
      "date": "YYYY-MM-DD",
      "start": "",
      "end": "",
      "allDay": true,
      "notes": ""
    }
  ],
  "warnings": []
}
```

This schema example uses placeholders, not valid user records. `kind` is `prayer` or `sunrise`. Timed events require a legible start and end; a printed time without an end is preserved as a note on an all-day review candidate with a warning. Blank/uncertain prayer times are omitted rather than fabricated. The client must show an editable review, resolve duplicates, and require confirmation before adding timetable rows or events. Image instructions are explicitly treated as untrusted data. The Responses request sets `store: false`; this does not replace reviewing the provider's applicable data-handling terms.

## 3. Optional background Web Push

On supported iPhones, install Hyte to the Home Screen before enabling notifications. Permission must follow an explicit tap. Permission alone does not connect the server sender or scheduling service.

1. Generate a VAPID key pair once using the installed `web-push` package in a private local session. Keep the same pair across deployments; changing keys can require resubscribing devices.
2. Configure server `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (a real contact `mailto:` or HTTPS URL).
3. Set a long random server-only `CRON_SECRET`.
4. Register a scheduler you control to call `GET` or `POST https://YOUR-HYTE-DOMAIN/api/cron/notify` approximately every minute with the header `Authorization: Bearer YOUR_CRON_SECRET`. Do not put the secret in a query string. Verify the scheduler can send custom authenticated headers.
5. Only after registering that trigger, set `HYTE_SCHEDULER_ENABLED=true` and redeploy. This flag attests setup; it is not proof of an actual successful run. Confirm scheduler logs and an actual timed alert before relying on reminders.
6. Install Hyte, subscribe this device, send a test notification, create a timed event/reminder, sync it, and check a real scheduled notification with Hyte closed.

The repository deliberately does not register an every-minute Vercel Hobby Cron job; that plan's daily frequency limit is unsuitable for minute-level reminders. Use an appropriate external minute scheduler, configured Supabase scheduler, or a suitable hosting plan. Provider timing and OS notification delivery remain best effort.

### Notification API

All routes below, except the cron route, require the owner's bearer session.

| Request                                                                                                 | Behavior                                                                                                     |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /api/notifications`                                                                                | `{ configured, publicKey, schedulerConfigured, extractionConfigured }`; no secret keys                       |
| `POST /api/notifications` with `{ "action": "subscribe", "subscription": <PushSubscription.toJSON()> }` | Saves this device's subscription                                                                             |
| `POST /api/notifications` with `{ "action": "unsubscribe", "endpoint": "..." }`                         | Removes the matching owner's subscription; unsubscribe the browser subscription too                          |
| `POST /api/notifications` with `{ "action": "test" }`                                                   | Sends a test to registered devices; API success means accepted by a push gateway, not proof the owner saw it |
| `POST /api/schedule`                                                                                    | Replaces future queued alerts from the latest cloud state; returns count and state revision                  |
| `GET` or `POST /api/cron/notify`                                                                        | Cron-secret authentication only; leases due jobs and dispatches notifications                                |

The service worker receives `{title, body, tag, url, icon}`. It must always display a notification on a push event and open/focus the app at the same-origin target when tapped. Use `tag` so ordinary retries replace the same notification rather than creating multiple visible copies. Do not navigate to untrusted off-origin URLs from notification data.

Scheduler behavior:

- Timed events use `date` + `start`; incomplete tasks use `date` + `time`. An alert requires a non-null `reminderMinutes` (zero means at start time).
- All-day items do not get a guessed alert time. The UI should require an explicit timed reminder or explain this limit.
- The selected IANA time zone is used; Muscat is the initial default. Nonexistent daylight-saving wall times are not guessed.
- Only future alerts are scheduled. A reminder created after its due time is not delivered retroactively.
- Edits/deletions are reconciled after a successful cloud save and schedule rebuild. Dispatch verifies the source revision; unscheduled outdated jobs are skipped. Offline edits cannot reach the scheduler until synced.
- Transactional leases prevent ordinary concurrent cron runs from claiming the same job. Successful device endpoints are recorded. Failed transient sends can retry up to four attempts; 404/410 subscriptions are removed.
- Jobs more than 30 minutes late expire rather than delivering an old backlog. Failed jobs/old subscription rows are visible for investigation in the database; add a retention cleanup job for long-term operation.
- No implementation can guarantee exactly-once visibility across a crash between gateway acceptance and the database write, or retract a push already accepted by the OS. These narrow races are best effort; do not claim perfect delivery or cancellation.
- Notification previews currently include the item title. Keep private lock-screen previews disabled at the iOS level if needed; a future app-level redacted-preview control must also be reflected in the queued payload.

## 4. Development and deployment

`npm run dev` serves the Vite frontend. Standalone Vite does not run Vercel API functions; local-only planning remains usable, but connected API actions need `vercel dev` with your account/environment or an actual Vercel deployment. Do not interpret a Vite HTML fallback as a successful API result.

Use a supported Node runtime (22 or newer) for Vercel functions. Allow enough execution time for image reading (the upstream request has a 55-second timeout) and queued notification batches. The project owner should verify the deployment plan's duration and scheduling limits before enabling these services.

No cloud project, paid service, or production deployment was provisioned by these files. Keys are intentionally blank in `.env.example`. The SQL needs execution and verification on your own database.

## 5. Required verification before trusting cloud features

- Run schema setup on a test/new Supabase project; inspect database advisors and verify all tables have RLS and intended grants.
- Confirm an unauthenticated client and an unrelated authenticated user cannot read the owner's state, subscriptions, queue rows, or private images. Confirm only the allowlisted owner can write their state.
- Verify owner server calls work, expired/wrong-owner tokens fail, and extraction without a server key returns a setup message.
- Save on two devices from the same revision and verify a conflict is surfaced instead of overwriting changes silently.
- Upload an actual monthly timetable; review Arabic text, dates, missing values, month mappings, duplicate handling, and undo behavior before saving it.
- Verify a real closed-app push on the physical iPhone, edited/cancelled reminders, time-zone boundaries, and revoked notification permissions.
- Verify sign-out and data deletion handle device caches and stored files appropriately.

Pure server scheduling assertions and JavaScript syntax were checked during development. Live authentication, SQL/RLS/storage execution, provider image reading, scheduler invocation, and iPhone delivery require your connected accounts/device and have not been verified by those checks.

## Official implementation references

- [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser) documents server validation of the access token.
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security) explains ownership policies and SELECT requirements for UPDATE.
- [Supabase changelog](https://supabase.com/changelog) records Data API exposure/grant changes and runtime support changes relevant to this setup.
- [OpenAI image inputs](https://developers.openai.com/api/docs/guides/images-vision) and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) define the image/JSON extraction request.
- [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini) lists image-input and structured-output support for the configurable default.
- [Apple Web Push documentation](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers) describes iPhone Home Screen requirements.
- [Vercel Cron usage limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) describes plan frequency limits; verify current limits for the chosen plan.
- [web-push](https://github.com/web-push-libs/web-push) documents VAPID setup and send options.
