import { Router } from "express";
import exotelRoutes from "./exotelRoutes.js";
import limeChatRoutes from "./limechatRoutes.js";

const appRouter = Router();

appRouter.use("/exotel", exotelRoutes);
appRouter.use("/limechat", limeChatRoutes);

export default appRouter;
