import React, { useMemo, useState } from "react";
import {
  Page,
  Card,
  TextField,
  Select,
  Button,
  InlineStack,
  BlockStack,
  Banner,
  Text,
} from "@shopify/polaris";

const MODULES = [
  {
    label: "Cashback Public API",
    value: "cashback",
    prefix: "/public/cashback",
  },
  {
    label: "Limechat Public API",
    value: "limechat",
    prefix: "/public/limechat",
  },
  // add more modules...
];

const Secrets = () => {
  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [moduleValue, setModuleValue] = useState(MODULES[0].value);

  const [loading, setLoading] = useState(false);
  const [generatedKey, setGeneratedKey] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(
    () => MODULES.find((m) => m.value === moduleValue),
    [moduleValue]
  );

  async function onGenerate() {
    setError("");
    setGeneratedKey("");

    if (!clientId.trim()) {
      setError(
        "Client ID is required (so you can identify who used the key later)."
      );
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/apps/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId.trim(),
          name: name.trim(),
          allowedPrefixes: [selected.prefix],
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to generate API key");

      setGeneratedKey(data.apiKey);
    } catch (e) {
      setError(e.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function copyKey() {
    if (!generatedKey) return;
    navigator.clipboard.writeText(generatedKey).catch(() => {});
  }

  return (
    <Page title="Public API Keys">
      <BlockStack gap="400">
        {error ? (
          <Banner tone="critical" title="Could not generate key">
            <p>{error}</p>
          </Banner>
        ) : null}

        {generatedKey ? (
          <Banner tone="success" title="API key generated">
            <BlockStack gap="200">
              <Text as="p">
                Copy this key now — you won’t be able to see it again.
              </Text>
              <Card>
                <BlockStack gap="200">
                  <Text as="p" fontWeight="bold">
                    API Key
                  </Text>
                  <div style={{ wordBreak: "break-all" }}>{generatedKey}</div>
                  <InlineStack gap="200">
                    <Button onClick={copyKey}>Copy</Button>
                    <Button variant="plain" onClick={() => setGeneratedKey("")}>
                      Hide
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </BlockStack>
          </Banner>
        ) : null}

        <Card>
          <BlockStack gap="400">
            <Select
              label="Module (scope)"
              options={MODULES.map((m) => ({ label: m.label, value: m.value }))}
              value={moduleValue}
              onChange={setModuleValue}
            />

            <TextField
              label="Client ID"
              value={clientId}
              onChange={setClientId}
              placeholder="e.g. Gokwik, limechat"
              autoComplete="off"
              helpText="Used to identify who accessed the endpoint (later, if needed)."
            />

            <TextField
              label="Key name (optional)"
              value={name}
              onChange={setName}
              placeholder="e.g. Cashback public key"
              autoComplete="off"
            />

            <InlineStack gap="200" align="end">
              <Button variant="primary" loading={loading} onClick={onGenerate}>
                Generate API Key
              </Button>
            </InlineStack>

            <Text as="p" tone="subdued">
              This key will only work for: <b>{selected.prefix}</b>
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
};
export default Secrets;
