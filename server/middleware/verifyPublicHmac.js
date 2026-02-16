import { verifyHmacApiKey } from "../../utils/keyManagement.js";

const publicHmacAuth = (req, res, next) => {
  const apiKey = req.header("X-API-KEY");

  if (!apiKey) {
    return res.status(401).json({ error: "API key missing" });
  }

  const isValid = verifyHmacApiKey(apiKey, 300); // 5 mins

  if (!isValid) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  // Optional: extract module
  const [, moduleId] = apiKey.split(".");
  req.moduleId = moduleId;

  next();
};

export default publicHmacAuth;
