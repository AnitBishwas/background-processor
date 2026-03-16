const getRtoOrdersFromBluedart = async () => {
  try {
  } catch (err) {
    throw new Error(
      "Failed to get rto orders from bluedart reason -->" + err.message
    );
  }
};

export { getRtoOrdersFromBluedart };
