import { Router } from "express";
import { insertBigqueryEvent,transformToBigQuerySchema } from "../../../analytics/helpers/index.js";
import { handleMoeEvent } from "../helpers/moe.js";

const eventPublicRoutes = Router();

eventPublicRoutes.post("/", async (req, res) => {
  try {
    const data = req.body;
    if (!data) {
      throw new Error("Payload can not be blank");
    }
    const formattedData = transformToBigQuerySchema(data);
    formattedData.session_id = data.session_id;
    await insertBigqueryEvent(formattedData);
    if(req.body?.moe && req.body?.customer_phone){
      await handleMoeEvent(req.body);
    }
    res
      .send({
        ok: true,
      })
      .status(200);
  } catch (err) {
    console.log("Failed to handle event post route reason -->" + err.message);
    res
      .send({
        ok: false,
      })
      .status(420);
  }
});
export default eventPublicRoutes;