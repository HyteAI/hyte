import {
  adminClient,
  checkDb,
  handleError,
  httpError,
  requireMethod,
  requireOwner,
  schedulerConfigured,
  send,
} from "./_lib/shared.js";
import { jobsFromState } from "./_lib/schedule.js";

export default async function handler(req, res) {
  try {
    requireMethod(req, res, ["POST"]);
    const { db, user } = await requireOwner(req);
    if (!schedulerConfigured())
      throw httpError(
        503,
        "Scheduled background alerts are not connected yet. Set up the notification sender and minute scheduler first.",
      );
    const state = checkDb(
      await db
        .from("hyte_state")
        .select("data,revision")
        .eq("user_id", user.id)
        .maybeSingle(),
    );
    if (!state)
      throw httpError(
        409,
        "Save your data to the cloud before scheduling alerts.",
      );
    const jobs = jobsFromState(state.data, user.id, state.revision);
    const count = checkDb(
      await adminClient().rpc("hyte_replace_notification_jobs", {
        target_user: user.id,
        expected_revision: state.revision,
        desired_jobs: jobs,
      }),
    );
    if (count === -1)
      throw httpError(
        409,
        "Your plans changed during scheduling. Save again to schedule the latest version.",
      );
    return send(res, 200, { scheduled: count, revision: state.revision });
  } catch (error) {
    return handleError(res, error);
  }
}
