import { Router } from "express";
import {
  getCustomersLastFiveOrders,
  getOrderStatusByOrderId,
} from "../controllers/index.js";

const limeChaRoutes = Router();

limeChaRoutes.get("/status", async (req, res) => {
  try {
    const { orderId } = req.query;
    const shop = res.locals.user_session.shop;
    if (!orderId) {
      throw new Error("Required parameters missing");
    }
    const orderStatus = await getOrderStatusByOrderId(shop, orderId);
    if (!orderStatus) {
      throw new Error("Failed to get order status");
    }
    res.status(200).send({
      ok: true,
      message: orderStatus,
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
    });
  }
});

limeChaRoutes.get("/orders", async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) {
      throw new Error("Required parameters missing");
    }
    const ordersList = await getCustomersLastFiveOrders(phone);
    res.status(200).json({
      ok: true,
      orders: [...ordersList],
    });
  } catch (err) {
    res.status(400).json({
      ok: false,
    });
  }
});

export default limeChaRoutes;
