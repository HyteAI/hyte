import webpush from "web-push";
import { httpError, pushConfigured } from "./shared.js";

export function sender() {
  if (!pushConfigured())
    throw httpError(
      503,
      "Background notifications have not been connected yet.",
    );
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
  return webpush;
}

export function pushPayload(job) {
  return JSON.stringify({
    title: job.payload?.title || "Hyte reminder",
    body: job.payload?.body || "Something you planned is coming up.",
    tag: `hyte-${job.id}`,
    url: job.payload?.url || "/?tab=calendar",
    icon: "/icon-192.png",
  });
}

export function safeEndpoint(value) {
  try {
    const url = new URL(value);
    // Restrict server-side requests to known public push services, not arbitrary URLs.
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === "443") &&
      (host === "web.push.apple.com" ||
        host.endsWith(".push.apple.com") ||
        host === "fcm.googleapis.com" ||
        host === "updates.push.services.mozilla.com" ||
        host.endsWith(".notify.windows.com") ||
        host === "wns2-db5p.notify.windows.com")
    );
  } catch {
    return false;
  }
}
