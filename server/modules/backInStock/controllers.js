import {
  createMoengageBusinessEventForBackInStock,
  triggerBackInStockMoengageEvent,
} from "./moe.js";
const handleVariantBackInStock = async (payload) => {
  try {
    if(payload.inventoryQuantity >= 100){
      await triggerBackInStockMoengageEvent(payload);
      console.log("✅ Triggered Moengage back in stock event")
    }
  } catch (err) {
    throw new Error(
      "Failed to handle variant back in stock reason -->" + err.message
    );
  }
};

export { handleVariantBackInStock };
