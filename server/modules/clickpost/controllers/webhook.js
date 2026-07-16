/**
 * ClickPost -> our server webhook consumer.
 *
 * This is STEP 1 of the RTO Refund Automation Flow:
 *   "Create a webhook consumer endpoint to receive RTO status updates."
 *
 * Right now this controller only:
 *   1. Accepts the payload ClickPost sends (POST).
 *   2. Logs it so we can see real payloads while ClickPost/QA test the URL.
 *   3. Responds 200 immediately (ClickPost retries on non-200, and per their
 *      docs the endpoint should be idempotent, so we ack fast and do the
 *      heavy lifting - Mongo check, refund, Shopify cancel, tags, MoEngage
 *      event - in later steps once this URL is confirmed working).
 *
 * Sample payload shape (from ClickPost docs):
 * {
 *   "waybill": "SF49245NER",
 *   "cp_id": 9,
 *   "status": "OFD",
 *   "clickpost_status_code": 6,
 *   "clickpost_status_description": "OutForDelivery",
 *   "remark": "Shipment is Out for Delivery",
 *   "location": "DEL_GeetaColony",
 *   "timestamp": "2019-05-06T10:04:20Z",
 *   "additional": {
 *     "latest_status": { ... },
 *     "is_rvp": false,
 *     "order_id": "...",
 *     "notification_event_id": 123 // only present for "Selected Status" webhooks
 *   }
 * }
 */

import { processRtoWebhookEvent } from "./rtoRefund.js";

export const handleClickPostWebhook = async (req, res) => {
  try {
    const payload = req.body || {};

    const {
      waybill,
      cp_id,
      status,
      clickpost_status_code,
      clickpost_status_description,
      timestamp,
      additional = {},
    } = payload;

    console.log("[clickpost-webhook] received", {
      waybill,
      cp_id,
      status,
      clickpost_status_code,
      clickpost_status_description,
      timestamp,
      order_id: additional?.order_id,
      is_rvp: additional?.is_rvp,
      notification_event_id: additional?.notification_event_id,
    });

    // Step 2-5: map status, check Mongo, refund + cancel + tag, MoEngage push.
    // This never throws - it always resolves so we can ack ClickPost fast.
    const result = await processRtoWebhookEvent(payload);
    console.log("[clickpost-webhook] processing result:", result);

    // Always ack fast with 200 so ClickPost does not retry.
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[clickpost-webhook] error handling payload:", err);
    // Still return 200 so ClickPost doesn't hammer retries while we debug -
    // change to 500 only once we're confident about payload validation.
    return res.status(200).json({ ok: false, error: err.message });
  }
};
