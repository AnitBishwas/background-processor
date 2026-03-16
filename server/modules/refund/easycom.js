import fetch from "node-fetch";

const getRtoOrdersListFromEasycom = async () => {
  try {
    const authKey = await generateEasycomAuthKey();

  } catch (err) {
    throw new Error(
      "Failed to get RTO orders list from easycom reason -->" + err.message
    );
  }
};

const generateEasycomAuthKey = async () => {
  try {
    const url = "https://api.easyecom.io/access/token";
    const payload = {
      email: process.env.EASYCOM_USERNAME,
      password: process.env.EASYCOM_PASSWORD,
      location_key: process.env.EASYCOM_LOCATION_KEY,
    };
    const request = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const res = await request.json();
    if (!res.data?.token?.jwt_token) {
      throw new Error("Failed to generate easycom auth key");
    }
    return res.data.token.jwt_token;
  } catch (err) {
    throw new Error(
      "Failed to generate easycom auth key reason -->" + err.message
    );
  }
};
export { getRtoOrdersListFromEasycom };
