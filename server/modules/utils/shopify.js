import fetch from "node-fetch";
const clientProvider = async (query, variables) => {
  try {
    let url = process.env.SHOP_URL + "/admin/api/2025-04/graphql.json";
    const request = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": process.env.SHOPIFY_SECRET_TOKEN,
      },
      body: JSON.stringify({
        query: query,
        variables: variables,
      }),
    });
    const res = await request.json();
    return res;
  } catch (err) {
    throw new Error("Failed to make request reason --> " + err.message);
  }
};

export { clientProvider };
