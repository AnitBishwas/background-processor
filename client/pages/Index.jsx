import {
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Layout,
  Link,
  Page,
  Text,
} from "@shopify/polaris";

const HomePage = () => {
  return (
    <>
      <Page title="Background processor">
        <InlineGrid columns={2}>
          <Card>
            <Link href="/secrets">Manage Api keys</Link>
          </Card>
        </InlineGrid>
      </Page>
    </>
  );
};

export default HomePage;
