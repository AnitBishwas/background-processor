import { Router } from "express";
import apiKeysRoutes from "./apiKeys.js";

const adminRoutes = Router();

adminRoutes.use("/api-keys", apiKeysRoutes);

export default adminRoutes;
