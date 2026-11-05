import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  adminClient,
  checkDb,
  handleError,
  httpError,
  requireMethod,
  schedulerConfigured,
  send,
} from "../_lib/shared.js";
import { pushPayload, safeEndpoint, sender } from "../_lib/push.js";

function validCron(req) {
  const expected = process.env.CRON_SECRET;
  const provided = /^Bearer\s+(.+)$/i.exec(
    req.headers.authorization || "",
  )?.[1];
  if (
    !expected ||
    !provided ||
    Buffer.byteLength(expected) !== Buffer.byteLength(provided)
  )
    return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

export default async function handler(req, res) {
  try {
    requireMethod(req, res, ["GET", "POST"]);
    if (!validCron(req))
      throw httpError(401, "A valid scheduler credential is required.");
    if (!schedulerConfigured() || !process.env.HYTE_OWNER_ID)
      throw httpError(503, "The notification scheduler has not been enabled.");
    const db = adminClient();
    const push = sender();
    const worker = randomUUID();
    const jobs = checkDb(
      await db.rpc("hyte_claim_notification_jobs", {
        worker_id: worker,
        batch_size: 8,
      }),
    );
    let delivered = 0;
    let superseded = 0;
    for (const job of jobs) {
      const latest = checkDb(
        await db
          .from("hyte_notification_jobs")
          .select("source_revision,status,lease_token")
          .eq("id", job.id)
          .maybeSingle(),
      );
      if (
        !latest ||
        latest.lease_token !== worker ||
        latest.status !== "sending"
      )
        continue;
      job.source_revision = latest.source_revision;
      const current = checkDb(
        await db
          .from("hyte_state")
          .select("revision")
          .eq("user_id", job.user_id)
          .maybeSingle(),
      );
      if (
        !current ||
        current.revision !== job.source_revision ||
        job.user_id !== process.env.HYTE_OWNER_ID
      ) {
        checkDb(
          await db
            .from("hyte_notification_jobs")
            .update({
              status: "superseded",
              lease_until: null,
              lease_token: null,
            })
            .eq("id", job.id)
            .eq("lease_token", worker)
            .eq("source_revision", job.source_revision),
        );
        superseded++;
        continue;
      }
      const subscriptions = checkDb(
        await db
          .from("hyte_push_subscriptions")
          .select("id,subscription")
          .eq("user_id", job.user_id),
      );
      const deliveredTo = new Set(job.delivered_to || []);
      let retry = false;
      let any = false;
      let persist = Promise.resolve();
      await Promise.all(
        subscriptions.slice(0, 20).map(async (row) => {
          if (
            deliveredTo.has(row.id) ||
            !safeEndpoint(row.subscription.endpoint)
          )
            return;
          try {
            await push.sendNotification(row.subscription, pushPayload(job), {
              TTL: 300,
              urgency: "high",
              timeout: 5000,
            });
            deliveredTo.add(row.id);
            any = true;
            // Persist each successful endpoint so ordinary retries do not resend to it.
            // Serialize persistence while sending endpoints concurrently, so an older
            // snapshot cannot overwrite a newer endpoint acknowledgement.
            persist = persist.then(async () =>
              checkDb(
                await db
                  .from("hyte_notification_jobs")
                  .update({ delivered_to: [...deliveredTo] })
                  .eq("id", job.id)
                  .eq("lease_token", worker),
              ),
            );
            await persist;
          } catch (error) {
            if ([404, 410].includes(error.statusCode)) {
              checkDb(
                await db
                  .from("hyte_push_subscriptions")
                  .delete()
                  .eq("id", row.id)
                  .eq("user_id", job.user_id),
              );
            } else {
              retry = true;
            }
          }
        }),
      );
      await persist;
      checkDb(
        await db
          .from("hyte_notification_jobs")
          .update({
            status:
              retry && job.attempts < 4
                ? "pending"
                : deliveredTo.size
                  ? "sent"
                  : "failed",
            delivered_to: [...deliveredTo],
            lease_until: null,
            lease_token: null,
            sent_at: deliveredTo.size ? new Date().toISOString() : null,
          })
          .eq("id", job.id)
          .eq("lease_token", worker),
      );
      if (any) delivered++;
    }
    return send(res, 200, { claimed: jobs.length, delivered, superseded });
  } catch (error) {
    return handleError(res, error);
  }
}
