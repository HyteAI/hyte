import { createHash } from "node:crypto";
import { z } from "zod";
import {
  adminClient,
  body,
  checkDb,
  handleError,
  httpError,
  pushConfigured,
  requireMethod,
  requireOwner,
  schedulerConfigured,
  send,
} from "./_lib/shared.js";
import { safeEndpoint, sender } from "./_lib/push.js";

const subscriptionSchema = z.object({
  endpoint: z.string().max(3000).refine(safeEndpoint),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z
      .string()
      .regex(/^[A-Za-z0-9_=-]+$/)
      .max(256),
    auth: z
      .string()
      .regex(/^[A-Za-z0-9_=-]+$/)
      .max(128),
  }),
});

export default async function handler(req, res) {
  try {
    requireMethod(req, res, ["GET", "POST"]);
    const { user } = await requireOwner(req);
    if (req.method === "GET") {
      return send(res, 200, {
        configured: pushConfigured(),
        publicKey: process.env.VAPID_PUBLIC_KEY || null,
        schedulerConfigured: schedulerConfigured(),
        extractionConfigured: Boolean(process.env.OPENAI_API_KEY),
      });
    }
    const input = body(req);
    const db = adminClient();
    if (input.action === "subscribe") {
      if (!pushConfigured())
        throw httpError(
          503,
          "Background notifications have not been connected yet.",
        );
      const subscription = subscriptionSchema.parse(input.subscription);
      const id = createHash("sha256")
        .update(subscription.endpoint)
        .digest("hex");
      checkDb(
        await db
          .from("hyte_push_subscriptions")
          .upsert({
            id,
            user_id: user.id,
            subscription,
            updated_at: new Date().toISOString(),
          }),
      );
      return send(res, 200, {
        saved: true,
        schedulerConfigured: schedulerConfigured(),
      });
    }
    if (input.action === "unsubscribe") {
      const endpoint = z.string().max(3000).parse(input.endpoint);
      checkDb(
        await db
          .from("hyte_push_subscriptions")
          .delete()
          .eq("user_id", user.id)
          .eq("id", createHash("sha256").update(endpoint).digest("hex")),
      );
      return send(res, 200, { removed: true });
    }
    if (input.action === "test") {
      const push = sender();
      const subscriptions = checkDb(
        await db
          .from("hyte_push_subscriptions")
          .select("id,subscription")
          .eq("user_id", user.id),
      );
      if (!subscriptions.length)
        throw httpError(409, "Enable notifications on this device first.");
      let sent = 0;
      for (const row of subscriptions.slice(0, 20)) {
        if (!safeEndpoint(row.subscription.endpoint)) continue;
        try {
          await push.sendNotification(
            row.subscription,
            JSON.stringify({
              title: "Hyte is ready",
              body: "Your test notification arrived. Scheduled reminders also need the background scheduler.",
              tag: "hyte-test",
              url: "/",
            }),
            { TTL: 60, timeout: 8000 },
          );
          sent++;
        } catch (error) {
          if ([404, 410].includes(error.statusCode))
            checkDb(
              await db
                .from("hyte_push_subscriptions")
                .delete()
                .eq("id", row.id)
                .eq("user_id", user.id),
            );
        }
      }
      if (!sent)
        throw httpError(
          502,
          "No test notification could be delivered. Re-enable notifications and try again.",
        );
      return send(res, 200, {
        sent,
        schedulerConfigured: schedulerConfigured(),
      });
    }
    throw httpError(400, "Choose subscribe, unsubscribe, or test.");
  } catch (error) {
    return handleError(res, error);
  }
}
