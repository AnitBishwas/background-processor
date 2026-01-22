import { BigQuery } from "@google-cloud/bigquery";

function transformToBigQuerySchema(rawEvent, options = {}) {
  const {
    userId = null,
    deviceId = null,
    sessionId = null,
    timestamp = Date.now(), // current timestamp in ms
    event_date = new Date().toISOString(),
  } = options;
  const eventName = rawEvent?.event || "unknown_event";

  // Exclude top-level fields that aren't event_params
  const excludeKeys = new Set([
    "event",
    "timestamp",
    "user_id",
    "device_id",
    "session_id",
  ]);

  function convertValue(value) {
    if (typeof value === "string") {
      return { string_value: value };
    } else if (typeof value === "number") {
      // Distinguish float vs int
      return Number.isInteger(value)
        ? { int_value: value }
        : { float_value: value };
    } else if (typeof value === "boolean") {
      return { string_value: value.toString() }; // Store as string
    } else {
      return { string_value: JSON.stringify(value) }; // Store nested/complex objects as JSON
    }
  }

  const eventParams = Object.entries(rawEvent)
    .filter(([key]) => !excludeKeys.has(key))
    .map(([key, value]) => ({
      key,
      value: convertValue(value),
    }));

  return {
    timestamp,
    event_name: eventName,
    user_id: userId,
    device_id: deviceId,
    session_id: sessionId,
    event_params: eventParams,
    event_date,
  };
}

const insertBigqueryEvent = async (data) => {
  const datasetId = process.env.DATASET_ID;
  const tableId = process.env.TABLE_ID;
  const credentials = JSON.parse(process.env.CREDS);
  try {
    const rows = [data];
    const bigquery = new BigQuery({
      projectId: "resolute-oxygen-464005-m0",
      credentials: credentials,
    });
    const insertion = await bigquery
      .dataset(datasetId)
      .table(tableId)
      .insert(rows);
    console.log(`Inserted ${rows.length} rows`, insertion);
  } catch (err) {
    console.dir(err, {
      depth: null,
    });
  }
};

export { transformToBigQuerySchema, insertBigqueryEvent };
