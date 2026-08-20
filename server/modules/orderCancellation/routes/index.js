import { Router } from "express";
import {
  checkOrderCancellationEligibilityController,
  cancelOrderController,
} from "../controllers/index.js";

const orderCancellationRoutes = Router();

orderCancellationRoutes.post(
  "/check",
  checkOrderCancellationEligibilityController
);
orderCancellationRoutes.post("/cancel", cancelOrderController);

export default orderCancellationRoutes;
