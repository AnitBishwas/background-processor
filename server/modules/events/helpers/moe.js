import nodebase64 from "nodejs-base64-converter";


/**
 * Generate base64 encoded auth key
 * @returns {string} - auth key
 */
const generateMoenagageEncodedAuthKey = () => {
    try {
        const username = process.env.MOE_WORKSPACE_ID;
        const password = process.env.MOE_API_KEY;
        if (!username || !password) {
            throw new Error("Required parameter missing");
        }
        const base64Pass = nodebase64.encode(`${username}:${password}`);
        return base64Pass;
    } catch (err) {
        throw new Error("failed to generate encoded auth key -->" + err.message);
    }
};

/**
 * create moengage events
 * @typedef {object} payload
 * @property {string} eventName - event name
 * @property {string} customerPhone - customer phone number
 * @property {object} params - data parameters
 */
const createMoengageEvent = async ({ eventName, customerPhone, params }) => {
    try {
        console.log("trying to create moengage event : ", eventName, customerPhone);
        if (!customerPhone) {
            throw new Error("Phone number missing");
        }
        const moeUrl = process.env.MOE_URL;
        const username = process.env.MOE_WORKSPACE_ID;
        const endpoint = `${moeUrl}/v1/event/${username}`;
        const payload = {
            type: "event",
            customer_id: customerPhone,
            actions: [
                {
                    action: eventName,
                    attributes: { ...params },
                },
            ],
        };
        const request = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${generateMoenagageEncodedAuthKey()}`,
                "X-Forwarded-For": null,
            },
            body: JSON.stringify(payload),
        });
        const response = await request.json();
        console.dir(response, { depth: null });
    } catch (err) {
        console.log("Failed to cretae moengage event reason -->" + err.message);
    }
};

const handleMoeEvent = async (payload) => {
    try {
        if (!payload) {
            throw new Error("No payload provided");
        }
        const moePayload = {
            eventName: payload["event"],
            customerPhone: payload["customer_phone"],
            params: {}
        };
        for (const [key, value] of Object.entries(payload)) {
            if (key != 'event' && key != "customer_phone" && key != "storefront_session_id" && key != "storefront_client_id" && key != "moe" && key != "gtm.uniqueEventId") {
                moePayload["params"][key] = value;
            }
        }
        await createMoengageEvent(moePayload);
    } catch (err) {
        console.error("Failed to handle moengage event reason -->" + err.message);
    }
}
export { createMoengageEvent, handleMoeEvent };