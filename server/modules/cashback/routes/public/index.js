import { Router } from "express";
import { getCustomersRedeemableValueBasedOnCart } from "../../controllers/index.js";

const cashbackPublicRoutes = Router();

cashbackPublicRoutes.post("/", async (req, res) => {
  const payload = req.body;
  try {
    const walletinfo = await getCustomersRedeemableValueBasedOnCart(payload);
    res.status(200).json({
      ok: true,
      ...walletinfo,
    });
  } catch (err) {
    console.log(
      "Failed to handle cashback public endpoint reason -->" + err.message
    );
    res.status(400).json({
      ok: false,
    });
  }
});

export default cashbackPublicRoutes;
