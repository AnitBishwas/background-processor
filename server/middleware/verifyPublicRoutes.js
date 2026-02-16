import ApiKey from "../../utils/models/ApiKey.js";
import { hashApiKey, safeEqual } from "../../utils/apikey.js";

const extractApiKey = (req) => {
  const headerKey = req.headers["x-api-key"];

  if (headerKey) return headerKey.trim();
  const auth = req.headers["authorization"];
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  } else if (auth) {
    return auth;
  }
  return null;
};

const extractPrefix = (fullKey) => {
  const dot = fullKey.indexOf(".");
  if (dot === -1) return null;
  const left = fullKey.slice(0, dot);
  const parts = left.split("pk_live_");
  if (parts.length !== 2 || !parts[1]) return null;
  return parts[1];
};

const pathAllowed = (pathname, allowedPrefixes) => {
  const path = (pathname || "").replace(/\/+$/, "");
  return allowedPrefixes.some((prefix) => {
    const p = prefix.replace(/\/+$/, "");
    return path === p || path.startsWith(p + "/");
  });
};

const publicApiKeyAuth = async (req, res, next) => {
  try {
    const apiKey = extractApiKey(req);
    if (!apiKey) return res.status(401).json({ error: "Missing API key" });

    const prefix = extractPrefix(apiKey);
    if (!prefix)
      return res.status(401).json({ error: "Invalid API key format" });

    const doc = await ApiKey.findOne({
      keyPrefix: prefix,
      status: "active",
    }).lean();
    if (!doc)
      return res.status(401).json({ error: "Invalid or revoked API key" });

    if (doc.expiresAt && new Date(doc.expiresAt).getTime() < Date.now()) {
      return res.status(401).json({ error: "API key expired" });
    }

    const computed = hashApiKey(apiKey);
    if (!safeEqual(computed, doc.keyHash)) {
      return res.status(401).json({ error: "Invalid API key" });
    }

    const reqPath = req.path;

    const fullPath = ((req.baseUrl || "") + (reqPath || "")).includes("/api")
      ? ((req.baseUrl || "") + (reqPath || "")).replace("/api", "")
      : (req.baseUrl || "") + (reqPath || "");

    if (!pathAllowed(fullPath, doc.allowedPrefixes)) {
      return res
        .status(403)
        .json({ error: "API key not allowed for this endpoint" });
    }

    req.apiClient = {
      keyId: String(doc._id),
      clientId: doc.clientId,
      name: doc.name,
      allowedPrefixes: doc.allowedPrefixes,
    };
    ApiKey.updateOne(
      { _id: doc._id },
      { $set: { lastUsedAt: new Date(), lastUsedIp: req.ip } }
    ).catch(() => {});

    return next();
  } catch (err) {
    console.error("publicApiKeyAuth error:", err);
    return res.status(500).json({ error: "Auth middleware error" });
  }
};

export default publicApiKeyAuth;
