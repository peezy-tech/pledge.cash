import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey();
const generated = privateKeyToAccount(privateKey);

console.log(`generated wallet: ${generated.address}`);
console.log(`private key: ${privateKey}`);
