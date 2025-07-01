import * as hl from "@nktkas/hyperliquid";
import { Account, generatePrivateKey, PrivateKeyAccount, privateKeyToAccount } from "viem/accounts";

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
  operator: PrivateKeyAccount,
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
async function transferToAuthorizedUser(
  multiSignAddress: `0x${string}`,
  authorizedUsers: [hl.AbstractWalletWithAddress, ...AbstractWallet[]],
  amount: `${number}`,
  token: `${string}:0x${string}`,
  user: `0x${string}`
) {
  // TODO: make sure user is one of the authorized users

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

async function swapSpotToUsdc(
  multiSignAddress: `0x${string}`,
  authorizedUsers: [hl.AbstractWalletWithAddress, ...AbstractWallet[]],
  amount: `${number}`,
  token: `${string}:0x${string}`
) {}

async function swapUsdcToSpot(
  multiSignAddress: `0x${string}`,
  authorizedUsers: [hl.AbstractWalletWithAddress, ...AbstractWallet[]],
  amount: `${number}`,
  token: `${string}:0x${string}`,
) {}

async function main() {
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

main();
