import { Router } from "express";
import { generateDelegatedToken } from "../controllers/index.js";

const tokenDelegationPublicRoutes = Router();

tokenDelegationPublicRoutes.post("/generate", async (req, res) => {
  try {
    const payload = req.body;
    if (!payload) {
      throw new Error("Payload missing");
    }
    const scopes = payload.scopes;
    if (!scopes) {
      throw new Error("Scopes are required");
    }
    const validAccessScopes = [
      "read_customers",
      "read_inventory",
      "read_orders",
      "read_products",
      "read_all_orders",
      "read_reports",
      "write_products"
    ];
    const checkIfScopesAreValid = scopes.every(
      (el) => validAccessScopes.indexOf(el) != -1
    );
    if (!checkIfScopesAreValid) {
      throw new Error("Invalid access scopes provided");
    }
    const { token, createdAt } = await generateDelegatedToken(payload.scopes);
    res.status(200).json({
      ok: true,
      data: {
        token,
        createdAt,
      },
    });
  } catch (err) {
    console.error("Failed to generate access token reason -->" + err.message);
    res.status(420).json({ ok: false });
  }
});

export default tokenDelegationPublicRoutes;
