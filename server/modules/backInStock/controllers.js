import { createMoengageBusinessEventForBackInStock } from "./moe.js";

const handleVariantBackInStock = async (payload) => {
  try {
    console.dir(payload, { depth: null });
    // createMoengageBusinessEventForBackInStock()
  } catch (err) {
    throw new Error(
      "Failed to handle variant back in stock reason -->" + err.message
    );
  }
};

export { handleVariantBackInStock };
