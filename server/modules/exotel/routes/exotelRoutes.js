import { Router } from "express";

import mapExotelRequests from "../controllers/mapExotel.js";

import {
  getTextBySsid,
  mapActions,
  mapFlowId,
  storeTextInDb,
} from "../controllers/exotel.js";

import { getOrderTrackingController } from "../controllers/shopify.js";

const exotelRoutes = Router();

// exotelRoutes.post("/tracking/order", getOrderTrackingController);

exotelRoutes.get("/json", (req, res) => {
  console.log("request was ");

  res
    .send({
      ok: true,
    })
    .status(200);
});

exotelRoutes.get("/message", async (req, res) => {
  try {
    const { CallSid } = req.query;

    if (!CallSid) {
      throw new Error("Required parameter missing");
    }

    const text = await getTextBySsid(CallSid);

    res.setHeader("Content-Type", "text/plain").status(200).send(text);
  } catch (err) {}
});

//import { mapOrderStatus } from "../controllers/actions.js";

// exotelRoutes.post("/test/message", (req, res) => {
//   const { status } = req.body;

//   const order = {
//     fulfillments: [{}],
//     tracking: {
//       success: true,
//       current_status: status,
//       tracking_data: {
//         latest_status: {
//           timestamp: new Date().toISOString(),
//         },
//       },
//     },
//   };

//   const message = mapOrderStatus(order);

//   return res.json({
//     status,
//     message,
//   });
// });

// import { mapOrderCancellation } from "../controllers/actions.js";

// exotelRoutes.post("/test/cancel-mock", async (req, res) => {
//   try {
//     const { status = "packed", paymentType = "cod" } = req.body || {};

//     const mockOrder = {
//       id: "gid://shopify/Order/test",
//       createdAt: new Date().toISOString(),
//       cancelledAt: null,
//       paymentGatewayNames:
//         paymentType === "cod" ? ["cash_on_delivery"] : ["razorpay"],
//       fulfillments: status === "unfulfilled" ? [] : [{}],
//       currentTotalPriceSet: {
//         shopMoney: {
//           amount: "299",
//         },
//       },
//       tracking: {
//         success: true,
//         current_status: status === "unfulfilled" ? "packed" : status,
//         tracking_data: {
//           latest_status: {
//             clickpost_status_description:
//               status === "packed" || status === "unfulfilled"
//                 ? "OrderPlaced"
//                 : status,
//             timestamp: new Date().toISOString(),
//           },
//         },
//       },
//     };

//     const blockedStatuses = [
//       "in-transit",
//       "out-for-delivery",
//       "delivered",
//       "rto",
//       "failed-delivery",
//       "lost",
//       "damaged",
//     ];

//     if (blockedStatuses.includes(status)) {
//       return res.status(200).json({
//         ok: true,
//         testMode: true,
//         status,
//         paymentType,
//         message: `Your current order status is ${status}. Hence, it cannot be cancelled as we allow cancellation only before your order gets packed.`,
//       });
//     }

//     return res.status(200).json({
//       ok: true,
//       testMode: true,
//       status,
//       paymentType,
//       message:
//         paymentType === "cod"
//           ? "Your cash on delivery order is cancelled."
//           : "Your order is cancelled. Your refund is initiated.",
//       mockOrder,
//     });
//   } catch (err) {
//     return res.status(500).json({
//       ok: false,
//       error: err.message,
//     });
//   }
// });

exotelRoutes.get("/:path", async (req, res) => {
  try {
    const flowId = req.path.replace("/", "") ? req.path.replace("/", "") : null;

    if (!flowId) {
      throw new Error("Flow id missing");
    }
    const { CallSid } = req.query;

    const customerPhone = req.query.From ? req.query.From : null;

    const digitsInserted = req.query.digits
      ? req.query.digits?.replace(
          /[`~!@#$%^&*()_|+\-=?;:'",.<>\{\}\[\]\\\/]/gi,
          ""
        )
      : null;

    const action = mapFlowId(flowId);

    const mapCorrespondingActions = await mapActions(
      action.value,
      customerPhone,
      digitsInserted
    );

    if (mapCorrespondingActions.text) {
      await storeTextInDb(CallSid, mapCorrespondingActions.text);
    }

    if (mapCorrespondingActions.whatsappLabel) {
      await sendLimeChatWhatsappTrigger(
        CallSid,
        customerPhone,
        mapCorrespondingActions.whatsappLabel
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.log("Failed to handle request reason -->" + err.message);

    res.status(400).send({
      ok: false,
    });
  }
});

export default exotelRoutes;
