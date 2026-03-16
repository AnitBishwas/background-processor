// import { getRtoOrdersFromShiprocket } from "./shiprocket.js";

import { getRtoOrdersListFromEasycom } from "./easycom.js";

const handleRtoOrders = async () => {
  try {
    const easycomRtoOrders = await getRtoOrdersListFromEasycom();
  } catch (err) {
    console.log("Failed to handle RTO orders reason -->" + err.message);
  }
};
export default handleRtoOrders;
