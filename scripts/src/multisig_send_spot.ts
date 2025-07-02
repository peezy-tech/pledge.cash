import * as hl from "@nktkas/hyperliquid";
import {
  Account,
  generatePrivateKey,
  PrivateKeyAccount,
  privateKeyToAccount,
} from "viem/accounts";
import * as fs from "fs";

const MULTISIG_ADDRESS = "0xB1b17e59D089596CD51BA34b0c83d8A6B34d32C2" as const;
const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
const DESTINATION_ADDRESS =
  "0xE60f03D22bC1D0BFF96F31578A5744F863b6D5b0" as const;

function convertToMultiSigUser(
  privateKey: `0x${string}`,
  authorizedUsers: `0x${string}`[]
) {
  const transport = new hl.HttpTransport({ isTestnet: true });
  const exchangeClient = new hl.ExchangeClient({
    transport,
    wallet: privateKeyToAccount(privateKey),
  });
  return exchangeClient.convertToMultiSigUser({
    authorizedUsers,
    threshold: 1,
  });
}

async function initMultisigAccount(
  user: `0x${string}`,
  operator: PrivateKeyAccount
) {
  // TODO: require submit txHash of the init tx to the operator (user sends 5 usdc)
  const transport = new hl.HttpTransport({ isTestnet: true });
  const exchangeClient = new hl.ExchangeClient({
    transport,
    wallet: operator,
  });

  const multisigAccount = privateKeyToAccount(generatePrivateKey());
  const multisigAddress = multisigAccount.address;

  const serverPrivateKey = generatePrivateKey();
  const serverSigner = privateKeyToAccount(serverPrivateKey);

  // send 1 usdc to multisig account and 1 usdc to server signer
  const tx = await exchangeClient.spotSend({
    destination: multisigAddress,
    token: "USDC:0x0000000000000000000000000000000000000000",
    amount: "1",
  });

  const serverTx = await exchangeClient.spotSend({
    destination: serverSigner.address,
    token: "USDC:0x0000000000000000000000000000000000000000",
    amount: "1",
  });

  const multisigExchangeClient = new hl.ExchangeClient({
    transport,
    wallet: multisigAccount,
  });

  const convertTx = await multisigExchangeClient.convertToMultiSigUser({
    authorizedUsers: [user, serverSigner.address],
    threshold: 1,
  });

  return { multisigAddress, convertTx, serverSigner };
}

interface AbstractViemWalletClient {
  signTypedData(
    params: {
      domain: {
        name: string;
        version: string;
        chainId: number;
        verifyingContract: hl.Hex;
      };
      types: {
        [key: string]: {
          name: string;
          type: string;
        }[];
      };
      primaryType: string;
      message: Record<string, unknown>;
    },
    options?: unknown
  ): Promise<hl.Hex>;
}

type AbstractWallet = hl.Hex | AbstractViemWalletClient;
async function spotTransferFrom(
  multiSignAddress: `0x${string}`,
  authorizedUsers: [hl.AbstractWalletWithAddress, ...AbstractWallet[]],
  amount: `${number}`,
  token: `${string}:0x${string}`,
  user: `0x${string}`
) {
  const transport = new hl.HttpTransport({ isTestnet: true });
  const multiSignClient = new hl.MultiSignClient({
    transport,
    multiSignAddress,
    signers: authorizedUsers,
    isTestnet: true,
  });

  return multiSignClient.spotSend({
    destination: user,
    token,
    amount,
  });
}

// Helper function to format price according to tick size rules for spot trading
function formatSpotPrice(price: number, szDecimals: number): string {
  const MAX_DECIMALS = 8;
  const maxDecimalPlaces = MAX_DECIMALS - szDecimals;

  // Convert to string to count significant figures
  const priceStr = price.toString();

  // Count significant figures (excluding leading zeros)
  const significantFigures = priceStr
    .replace(/^0\.0*/, "")
    .replace(".", "").length;

  // If price is an integer, return as is (integers are always allowed)
  if (Number.isInteger(price)) {
    return price.toString();
  }

  // Apply decimal places limit first
  let formattedPrice = price.toFixed(maxDecimalPlaces);

  // If we have more than 5 significant figures, we need to round more aggressively
  if (significantFigures > 5) {
    // Find the position where we should round to get 5 significant figures
    const decimalIndex = formattedPrice.indexOf(".");
    if (decimalIndex !== -1) {
      // Count non-zero digits before decimal
      const integerPart = formattedPrice.substring(0, decimalIndex);
      const nonZeroIntegerDigits = integerPart.replace(/^0+/, "").length;

      if (nonZeroIntegerDigits > 0) {
        // We have integer digits, so we can only have (5 - nonZeroIntegerDigits) decimal digits
        const allowedDecimalDigits = Math.max(0, 5 - nonZeroIntegerDigits);
        const maxAllowedDecimals = Math.min(
          allowedDecimalDigits,
          maxDecimalPlaces
        );
        formattedPrice = price.toFixed(maxAllowedDecimals);
      } else {
        // Price starts with 0., need to find first non-zero digit
        const match = formattedPrice.match(/^0\.0*([1-9])/);
        if (match) {
          const firstNonZeroIndex = formattedPrice.indexOf(match[1]);
          const allowedDecimals = Math.min(
            firstNonZeroIndex - 1 + 5,
            maxDecimalPlaces
          );
          formattedPrice = price.toFixed(allowedDecimals);
        }
      }
    }
  }

  // Remove trailing zeros as required for signing
  formattedPrice = formattedPrice.replace(/\.?0+$/, "");

  return formattedPrice;
}

async function swapSpotToUsdc(
  multiSignAddress: `0x${string}`,
  authorizedUsers: [hl.AbstractWalletWithAddress, ...AbstractWallet[]],
  amount: `${number}`,
  token: string,
  slippage: number
) {
  const transport = new hl.HttpTransport({ isTestnet: true });
  const multiSignClient = new hl.MultiSignClient({
    transport,
    multiSignAddress,
    signers: authorizedUsers,
    isTestnet: true,
  });

  const infoClient = new hl.InfoClient({ transport });
  const spotMeta = await infoClient.spotMeta();
  // console.log(spotMeta);

  const spotMetaAndAssetCtxs = await infoClient.spotMetaAndAssetCtxs();
  // console.log(spotMetaAndAssetCtxs);

  const assets = spotMeta.tokens.filter((t) => t.name === token);

  const asset = assets[0];
  if (!asset) {
    console.error("Asset not found in spot metadata");
    throw new Error("Could not find asset in spot metadata");
  }

  const spotTokenMarket = spotMeta.universe.find(
    (u) => u.tokens[0] === asset.index && u.tokens[1] === 0
  );

  console.log(spotTokenMarket);

  const l2Book = await infoClient.l2Book({ coin: asset.name });
  const bestBid = l2Book.levels[0][0];
  const bestAsk = l2Book.levels[1][0];

  console.log({ bestBid, bestAsk });

  // Calculate price with slippage and apply tick size formatting
  const rawPrice = parseFloat(bestBid.px) * (1 - slippage);
  const formattedPrice = formatSpotPrice(rawPrice, asset.szDecimals);

  const orderParams = {
    orders: [
      {
        a: 10000 + spotTokenMarket.index,
        b: false,
        p: formattedPrice,
        s: amount,
        r: false,
        t: { limit: { tif: "FrontendMarket" as const } },
      },
    ],
    grouping: "na" as const,
  };

  console.log(orderParams);

  const result = await multiSignClient.order(orderParams);
  console.log(result);
  return result;
}

async function swapUsdcToSpot(
  multiSignAddress: `0x${string}`,
  authorizedUsers: [hl.AbstractWalletWithAddress, ...AbstractWallet[]],
  amount: `${number}`,
  token: string,
  slippage: number
) {
  const transport = new hl.HttpTransport({ isTestnet: true });
  const multiSignClient = new hl.MultiSignClient({
    transport,
    multiSignAddress,
    signers: authorizedUsers,
    isTestnet: true,
  });

  const infoClient = new hl.InfoClient({ transport });
  const spotMeta = await infoClient.spotMeta();
  // console.log(spotMeta);

  const spotMetaAndAssetCtxs = await infoClient.spotMetaAndAssetCtxs();
  // console.log(spotMetaAndAssetCtxs);

  const assets = spotMeta.tokens.filter((t) => t.name === token);
  console.log(assets);
  const asset = assets[0];
  if (!asset) {
    console.error("Asset not found in spot metadata");
    throw new Error("Could not find asset in spot metadata");
  }

  // find spot token market -> array element of spotMeta.universe in which element.tokens = [1105, 0]
  let spotTokenMarketIndex = 0;
  const spotTokenMarket = spotMeta.universe.find((u, i) => {
    if (u.tokens[0] === asset.index && u.tokens[1] === 0) {
      spotTokenMarketIndex = i;
      return true;
    }
    return false;
  });
  console.log(spotTokenMarket);

  const l2Book = await infoClient.l2Book({ coin: asset.name });
  // console.log(l2Book.levels);
  const bestBid = l2Book.levels[0][0];
  const bestAsk = l2Book.levels[1][0];

  console.log({ bestBid, bestAsk });

  const orderParams = {
    orders: [
      {
        a: 10000 + spotTokenMarket.index,
        b: true,
        p: `${parseFloat(bestAsk.px) * (1 + slippage)}`,
        s: amount,
        r: false,
        t: { limit: { tif: "FrontendMarket" as const } },
      },
    ],
    grouping: "na" as const,
  };

  console.log(orderParams);

  const result = await multiSignClient.order(orderParams);
  console.log(result);
  return result;
}

async function swapUsdcClassTransfer(
  multiSignAddress: `0x${string}`,
  authorizedUsers: [hl.AbstractWalletWithAddress, ...AbstractWallet[]],
  amount: `${number}`,
  toPerp: boolean
) {
  const transport = new hl.HttpTransport({ isTestnet: true });
  const multiSignClient = new hl.MultiSignClient({
    transport,
    multiSignAddress,
    signers: authorizedUsers,
    isTestnet: true,
  });

  const result = await multiSignClient.usdClassTransfer({
    amount,
    toPerp,
  });
  console.log(result);
  return result;
}

async function testMarketBuy(
  multiSignAddress: `0x${string}`,
  authorizedUsers: [hl.AbstractWalletWithAddress, ...AbstractWallet[]],
  amount: `${number}`,
  token: `${string}:0x${string}`
) {
  console.log("swapUsdcToSpot called with parameters:");
  console.log("  multiSignAddress:", multiSignAddress);
  console.log("  authorizedUsers:", authorizedUsers);
  console.log("  amount:", amount);
  console.log("  token:", token);

  console.log("Creating HttpTransport...");
  const transport = new hl.HttpTransport({ isTestnet: true });
  console.log("Transport created successfully");

  console.log("Creating InfoClient...");
  const infoClient = new hl.InfoClient({ transport });
  console.log("InfoClient created successfully");

  console.log("Fetching spot metadata...");
  const spotMeta = await infoClient.spotMeta();
  console.log("Spot metadata fetched:", spotMeta);
  // console.log(
  //   "Available tokens:",
  //   spotMeta.tokens.map((t) => ({
  //     name: t.name,
  //     tokenId: t.tokenId,
  //     index: t.index,
  //   }))
  // );

  console.log("Looking for BTC asset...");
  const btcAsset = spotMeta.tokens.find((t) => t.name === "BTC");
  if (!btcAsset) {
    console.error("BTC asset not found in spot metadata");
    throw new Error("Could not find spot BTC in the metadata.");
  }
  console.log("BTC asset found:", btcAsset);

  const btcTokenIdentifier = `${btcAsset.name}:${btcAsset.tokenId}`;
  console.log("BTC token identifier:", btcTokenIdentifier);

  console.log("Creating MultiSignClient...");
  const multiSignClient = new hl.MultiSignClient({
    transport,
    multiSignAddress,
    signers: authorizedUsers,
    isTestnet: true,
  });
  console.log("MultiSignClient created successfully");

  // Get current market price for BTC
  console.log("Fetching all mids for current market prices...");
  const allMids = await infoClient.allMids();
  console.log("All mids fetched:");

  // infoClient.

  console.log("Looking for BTC mid price...");
  const btcMid = allMids[btcAsset.name];
  if (!btcMid) {
    console.error("BTC mid price not found in allMids");
    throw new Error("Could not get current BTC price");
  }
  console.log("BTC mid price found:", btcMid);

  let btcIndex = 0;
  console.log(
    (await infoClient.meta()).universe.filter((u, i) => {
      if (u.name === "BTC") btcIndex = i;
      return u.name === "BTC";
    })
  );
  // Create a market order by using IOC (Immediate or Cancel) with current market price
  const orderParams = {
    orders: [
      {
        a: btcIndex,
        b: true, // buying BTC with USDC
        p: (parseInt(btcMid.split(".")[0]) - 100).toString(), // use current market price
        s: amount, // use the amount parameter
        r: false,
        t: { limit: { tif: "Ioc" as const } }, // IOC makes it behave like a market order
      },
    ],
    grouping: "na" as const,
  };
  console.log(
    "Order parameters prepared:",
    JSON.stringify(orderParams, null, 2)
  );

  console.log("Submitting order...");
  try {
    const result = await multiSignClient.order(orderParams);
    console.log("Order submitted successfully, result:", result);

    return result;
  } catch (error) {
    console.error("Error submitting order:", error);
    console.log(JSON.stringify(error, null, 2));
  }
}

async function dumpUniverseToFile() {
  const transport = new hl.HttpTransport({ isTestnet: true });
  const infoClient = new hl.InfoClient({ transport });
  const spotMeta = await infoClient.spotMeta();
  console.log(spotMeta);
  fs.writeFileSync("universe.json", JSON.stringify(spotMeta, null, 2));

  const perpsMeta = await infoClient.meta();
  console.log(perpsMeta);
  fs.writeFileSync("perps.json", JSON.stringify(perpsMeta, null, 2));

  const allMids = await infoClient.allMids();
  console.log(allMids);
  fs.writeFileSync("allMids.json", JSON.stringify(allMids, null, 2));

  const spotMetaAndAssetCtxs = await infoClient.spotMetaAndAssetCtxs();
  console.log(spotMetaAndAssetCtxs);
  fs.writeFileSync(
    "spotMetaAndAssetCtxs.json",
    JSON.stringify(spotMetaAndAssetCtxs, null, 2)
  );
}

async function getOpenOrders(
  multiSignAddress: `0x${string}`,
  authorizedUsers: [hl.AbstractWalletWithAddress, ...AbstractWallet[]]
) {
  const transport = new hl.HttpTransport({ isTestnet: true });
  const infoClient = new hl.InfoClient({ transport });
  const openOrders = await infoClient.openOrders({
    user: multiSignAddress,
  });
  console.log(openOrders);
  return openOrders;
}

async function cancelAllOrders(
  multiSignAddress: `0x${string}`,
  authorizedUsers: [hl.AbstractWalletWithAddress, ...AbstractWallet[]]
) {
  const transport = new hl.HttpTransport({ isTestnet: true });
  const infoClient = new hl.InfoClient({ transport });
  const openOrders = await getOpenOrders(multiSignAddress, authorizedUsers);
  console.log(openOrders);

  const multiSignClient = new hl.MultiSignClient({
    transport,
    multiSignAddress,
    signers: authorizedUsers,
    isTestnet: true,
  });

  const meta = await infoClient.meta();

  for (const order of openOrders) {
    let assetIndex = 0;
    const asset = meta.universe.find((u, i) => {
      if (u.name === order.coin) {
        assetIndex = i;
      }
    });
    await multiSignClient.cancel({
      cancels: [
        {
          a: assetIndex,
          o: order.oid,
        },
      ],
    });
  }
}

async function usdSend(
  multiSignAddress: `0x${string}`,
  authorizedUsers: [hl.AbstractWalletWithAddress, ...AbstractWallet[]],
  amount: `${number}`
) {
  const transport = new hl.HttpTransport({ isTestnet: true });
  const multiSignClient = new hl.MultiSignClient({
    transport,
    multiSignAddress,
    signers: authorizedUsers,
    isTestnet: true,
  });

  const infoClient = new hl.InfoClient({ transport });
  const clearinghouseState = await infoClient.clearinghouseState({
    user: multiSignAddress,
  });
  console.log(clearinghouseState);

  const openOrders = await infoClient.openOrders({
    user: multiSignAddress,
  });
  console.log(openOrders);

  return multiSignClient.usdSend({
    destination: DESTINATION_ADDRESS,
    amount,
  });
}

async function test() {
  const multiSignAddress = MULTISIG_ADDRESS;
  const signers = [privateKeyToAccount(PRIVATE_KEY)] as const;
  const destinationAddress = DESTINATION_ADDRESS;

  if (!multiSignAddress || !multiSignAddress.startsWith("0x")) {
    console.error(
      "Error: MULTISIG_ADDRESS must be a valid hexadecimal string (starting with '0x')."
    );
    process.exit(1);
  }

  try {
    const amountToSend = "1";
    const transport = new hl.HttpTransport({ isTestnet: true });

    // 1. Initialize InfoClient to find the USDC asset details
    console.log("Initializing InfoClient to find USDC details...");
    const infoClient = new hl.InfoClient({ transport });
    const spotMeta = await infoClient.spotMeta();

    const usdcAsset = spotMeta.tokens.find((t) => t.name === "USDC");
    if (!usdcAsset) {
      throw new Error("Could not find spot USDC in the metadata.");
    }
    const usdcTokenIdentifier = `${usdcAsset.name}:${usdcAsset.tokenId}`;
    console.log(`Found USDC token identifier: ${usdcTokenIdentifier}`);
    console.log(`USDC szDecimals: ${usdcAsset.szDecimals}`);

    // 2. Initialize MultiSignClient with the multisig address and signers
    console.log("Initializing MultiSignClient...");
    const multiSignClient = new hl.MultiSignClient({
      transport,
      multiSignAddress,
      signers,
      isTestnet: true,
    });

    // 3. Execute the spotSend transaction using multisig
    console.log(
      `Attempting to send ${amountToSend} USDC from multisig ${multiSignAddress} to ${destinationAddress}...`
    );
    const res = await multiSignClient.spotSend({
      destination: destinationAddress,
      token: usdcTokenIdentifier as `${string}:0x${string}`,
      amount: amountToSend,
    });

    console.log(res);

    console.log("--- Multisig Transaction Sent Successfully ---");
    // The transaction hash isn't directly returned by spotSend. We need to find it another way.
    // The most reliable way is to query the multisig's recent transactions.

    console.log("Waiting a moment to query for the transaction...");
    await new Promise((resolve) => setTimeout(resolve, 3000)); // Wait 3s for the tx to be indexed

    const userFills = await infoClient.userFills({ user: multiSignAddress });

    // Find the most recent spot send fill
    const spotSendFill = userFills
      .filter(
        (fill) =>
          fill.dir === "Withdraw" &&
          fill.px === "0" && // Spot sends have a price of 0
          fill.coin === "USDC" // Look for USDC
      )
      .sort((a, b) => b.time - a.time)[0]; // Get the most recent one

    if (!spotSendFill) {
      console.error(
        "Could not find the spot send transaction in recent user fills. Please check the Hyperliquid UI for the transaction hash."
      );
    } else {
      console.log(
        `\nFound matching fill. Transaction Hash: ${spotSendFill.tid}`
      );
      console.log(
        "You can now use this hash with the \`verify_tx.ts\` script."
      );
    }
  } catch (error) {
    console.error("An error occurred during the multisig send process:", error);
    process.exit(1);
  }
}

async function main() {
  await swapSpotToUsdc(
    MULTISIG_ADDRESS,
    [privateKeyToAccount(PRIVATE_KEY)],
    "1",
    "HYPE",
    0.5
  );
  // await dumpUniverseToFile();
  // await usdSend(
  //   MULTISIG_ADDRESS,
  //   [privateKeyToAccount(PRIVATE_KEY)],
  //   "9998.85"
  // );
  // await cancelAllOrders(MULTISIG_ADDRESS, [privateKeyToAccount(PRIVATE_KEY)]);
}

main();
