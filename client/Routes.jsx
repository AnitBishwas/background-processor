import React from "react";
import Index from "./pages/Index";
import Secrets from "./pages/Secrets";

const routes = {
  "/": () => <Index />,
  "/secrets": () => <Secrets />,
};

export default routes;
