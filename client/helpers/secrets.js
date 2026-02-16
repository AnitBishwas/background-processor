const generateModuleSecrets = async (module) => {
  try {
    if (!module) {
      throw new Error("Module is required");
    }
    const url = "/api/apps/admin/secrets/generate";
    const request = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        module: module,
      }),
    });
    const res = await request.json();
    if (!res.ok) {
      throw new Error("Failed to generate module secret");
    }
    return res;
  } catch (err) {
    throw new Error(
      "Failed to generate module secrets reason -->" + err.message
    );
  }
};

export { generateModuleSecrets };
