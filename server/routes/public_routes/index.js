import { Router } from "express";
import limeChaRoutes from "../../modules/limechat/routes/index.js";
import publicApiKeyAuth from "../../middleware/verifyPublicRoutes.js";
import cashbackPublicRoutes from "../../modules/cashback/routes/public/index.js";

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


publicRoutes.use(publicApiKeyAuth);

publicRoutes.use("/cashback", cashbackPublicRoutes);
publicRoutes.use("/limechat", limeChaRoutes);





export default publicRoutes;
