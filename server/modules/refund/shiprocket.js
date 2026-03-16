import fetch from "node-fetch";

const getRtoOrdersFromShiprocket = async () => {
  try {
    const authToken = await generateShiprocketAuthToken();
    if (!authToken.token) {
      throw new Error("Failed to generate shiprocket auth token");
    }
    let ordersList = [];
    let next = null;
    while (next || next == null) {
      const url = `https://apiv2.shiprocket.in/v1/external/orders?filter_by=status&filter=15,25,26&from${new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]}&to${new Date(Date.now()).toISOString().split("T")[0]}&per_page=5&page=${next || 1}`;
      const req = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken.token}`,
          redirect: "follow",
        },
      });
      const res = await req.json();
      const orders = res?.data || [];
      const paginationInfo = res?.meta?.pagination || null;
      if (orders.length == 0) {
        throw new Error("No rto order found in shiprocket");
      }
      let mappedOrderData = orders.map((el) =>
        el["channel_order_id"]?.replace("R_", "")
      );
      ordersList = [...ordersList, ...mappedOrderData];
      if (paginationInfo.current_page < paginationInfo.total_pages) {
        next++;
      } else {
        next = false;
      }
    }
    return ordersList;
  } catch (err) {
    throw new Error(
      "Failed to get rto orders from shiprocket reason -->" + err.message
    );
  }
};

const generateShiprocketAuthToken = async () => {
  try {
    const url = `https://apiv2.shiprocket.in/v1/external/auth/login`;
    const payload = {
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASS,
    };
    const req = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const res = await req.json();
    return res;
  } catch (err) {
    throw new Error(
      "Failed to generate shiprocket auth token reason -->" + err.message
    );
  }
};
export { getRtoOrdersFromShiprocket };
