import { Router } from "express";
import { passEventToSqs } from "../controllers/sqs.js";

const clickPostWebhookRoute = Router();

clickPostWebhookRoute.post("/rtoOrder", async (req, res) => {
  console.log("Click post webhook hit");
  try {
    const payload = req.body;
    const shop =
      process.env.NODE_ENV == "dev"
        ? "swiss-local-dev.myshopify.com"
        : "swiss-beauty-dev.myshopify.com";
    await passEventToSqs(shop, payload);
    res.status(200).json({
      ok: true,
    });
  } catch (err) {
    res.status(420).json({
      ok: false,
    });
  }
});

export default clickPostWebhookRoute;
