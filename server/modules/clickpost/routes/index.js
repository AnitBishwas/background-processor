import { Router } from "express";
import clickPostWebhookRoute from "./webhooks.js";
import { generateRtoReport } from "../controllers/report.js";

const clickpostRoutes = Router();

clickpostRoutes.use("/webhooks", clickPostWebhookRoute);
clickpostRoutes.post("/reports", async (req, res) => {
    try {
        generateRtoReport();
        res.status(200).json({
            ok: true
        })
    } catch (err) {
        res.status(420).json({
            ok: false
        })
    }
})

export default clickpostRoutes;
