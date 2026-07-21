import { Router } from "express";
import clickPostWebhookRoute from "./webhooks.js";

const clickpostRoutes = Router();

clickpostRoutes.use("/webhooks", clickPostWebhookRoute);

export default clickpostRoutes;
