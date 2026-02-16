import { Router } from "express";
import { generateApiKey, hashApiKey } from "../../../utils/apikey.js";
import ApiKey from "../../../utils/models/ApiKey.js";

const apiKeysRoutes = Router();

apiKeysRoutes.post("/", async (req, res) => {
  const { clientId, name = "", allowedPrefixes } = req.body || {};

  if (!clientId || typeof clientId !== "string") {
    return res.status(400).json({ error: "clientId is required" });
  }
  if (!Array.isArray(allowedPrefixes) || allowedPrefixes.length === 0) {
    return res
      .status(400)
      .json({ error: "allowedPrefixes must be a non-empty array" });
  }

  const normalized = allowedPrefixes
    .map((p) => String(p).trim())
    .filter(Boolean)
    .map((p) => (p.startsWith("/") ? p : `/${p}`))
    .map((p) => p.replace(/\/+$/, ""));

  for (const p of normalized) {
    if (!p.startsWith("/public/") && p !== "/public") {
      return res
        .status(400)
        .json({ error: `Invalid prefix: ${p}. Must start with /public` });
    }
  }

  const { fullKey, prefix } = generateApiKey();
  const keyHash = hashApiKey(fullKey);

  const doc = await ApiKey.create({
    shop: req.shop || null,
    createdByUserId: req.userId || null,
    clientId,
    name,
    allowedPrefixes: normalized,
    keyPrefix: prefix,
    keyHash,
    status: "active",
  });

  return res.json({
    apiKey: fullKey, // SHOW ONCE
    keyId: doc._id,
    keyPrefix: doc.keyPrefix,
  });
});

apiKeysRoutes.get("/", async (req, res) => {
  const { clientId } = req.query;

  const filter = { shop: req.shop || null };
  if (clientId) filter.clientId = String(clientId);

  const keys = await ApiKey.find(filter)
    .select(
      "clientId name allowedPrefixes status lastUsedAt expiresAt createdAt keyPrefix"
    )
    .sort({ createdAt: -1 })
    .lean();

  res.json({ keys });
});
export default apiKeysRoutes;
