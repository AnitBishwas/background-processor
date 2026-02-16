import {
  transformToBigQuerySchema,
  insertBigqueryEvent,
} from "../../../analytics/helpers/index.js";

const createServerEvent = async ({ eventName = "", params = {} }) => {
  try {
    if (eventName.trim().length == 0) {
      throw new Error("Event name was missing");
    }
    const parsedData = transformToBigQuerySchema({
      event: eventName,
      ...params,
    });
    const insertData = await insertBigqueryEvent(parsedData);
  } catch (err) {
    console.log("Failed to create server event reason -->" + err.message);
  }
};

export { createServerEvent };
