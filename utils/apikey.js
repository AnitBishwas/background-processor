import crypto from "crypto";

const API_KEY_PEPPER = process.env.ENCRYPTION_STRING;

if (!API_KEY_PEPPER) {
  throw new Error("Missing API_KEY_PEPPER in environment");
}

const generateApiKey = () => {
  const prefix = crypto.randomBytes(6).toString("hex");
  const secret = crypto.randomBytes(24).toString("base64url");
  const fullKey = `pk_live_${prefix}.${secret}`;
  return { fullKey, prefix };
};

const hashApiKey = (fullKey) => {
  return crypto
    .createHmac("sha256", API_KEY_PEPPER)
    .update(fullKey)
    .digest("hex");
};

const safeEqual = (a, b) => {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

export { generateApiKey, hashApiKey, safeEqual };
