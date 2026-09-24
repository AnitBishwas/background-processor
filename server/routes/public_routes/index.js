import { Router } from "express";
import limeChaRoutes from "../../modules/limechat/routes/index.js";
import publicApiKeyAuth from "../../middleware/verifyPublicRoutes.js";
import cashbackPublicRoutes from "../../modules/cashback/routes/public/index.js";
import exotelRoutes from "../../modules/exotel/routes/exotelRoutes.js";
import clickpostRoutes from "../../modules/clickpost/routes/index.js";
import eventPublicRoutes from "../../modules/events/routes/publicRoutes.js";
import cors from "cors";
import tokenDelegationPublicRoutes from "../../modules/accessTokenDelegration/routes/public.js";

const publicRoutes = Router();

publicRoutes.get("/health", (req, res) => {
  try {
    res.status(200).json({
      ok: true,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
    });
  }
});

publicRoutes.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "x-api-key"],
    optionsSuccessStatus: 200,
  }),
  publicApiKeyAuth
);

publicRoutes.use("/cashback", cashbackPublicRoutes);
publicRoutes.use("/limechat", limeChaRoutes);
publicRoutes.use("/exotel", exotelRoutes);
publicRoutes.use("/clickpost", clickpostRoutes);
publicRoutes.use("/events", eventPublicRoutes);
publicRoutes.use("/token", tokenDelegationPublicRoutes);

export default publicRoutes;
