import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { Web3Provider } from "./components/web3-provider";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Web3Provider>
      <App />
    </Web3Provider>
  </React.StrictMode>,
);
