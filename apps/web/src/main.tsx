import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Web3Provider } from "./components/web3-provider";
import "./index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing root element for pledge.cash web app");
}

const app = (
  <React.StrictMode>
    <Web3Provider>
      <App />
    </Web3Provider>
  </React.StrictMode>
);

createRoot(rootElement).render(app);
