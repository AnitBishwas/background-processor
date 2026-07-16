import { Router } from "express";
import { handleClickPostWebhook } from "../controllers/webhook.js";

const clickpostRoutes = Router();

// Simple shared-secret check. ClickPost lets you send back a static
// token as a query param or header when it calls your webhook - we
// accept either:
//   ...?secret=<CLICKPOST_RTO_WEBHOOK_SECRET>
//   header:  x-webhook-secret: <CLICKPOST_RTO_WEBHOOK_SECRET>
const verifyClickPostSecret = (req, res, next) => {
  const expected = process.env.CLICKPOST_RTO_WEBHOOK_SECRET;

  if (!expected) {
    console.error(
      "[clickpost-webhook] CLICKPOST_RTO_WEBHOOK_SECRET not set in env"
    );
    return res.status(500).json({ ok: false, error: "Server misconfigured" });
  }

  const provided = req.query.secret || req.headers["x-webhook-secret"];

  if (!provided || provided !== expected) {
    return res
      .status(401)
      .json({ ok: false, error: "Invalid or missing secret" });
  }

  return next();
};

// This is the endpoint ClickPost will POST tracking updates to.
// Full public URL (once mounted, see public_routes/index.js):
//   https://<your-app-domain>/api/public/clickpost/webhook?secret=<CLICKPOST_RTO_WEBHOOK_SECRET>
clickpostRoutes.post("/webhook", verifyClickPostSecret, handleClickPostWebhook);

// Simple GET so you (or ClickPost support) can sanity check the URL
// resolves before wiring it into the dashboard.
clickpostRoutes.get("/webhook", (req, res) => {
  res.status(200).json({ ok: true, message: "clickpost webhook endpoint" });
});

export default clickpostRoutes;
