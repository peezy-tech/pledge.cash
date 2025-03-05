import fs from "fs/promises";

const broadcastPath = "./broadcast/";
async function getDeployments() {
  const dirs = await fs.readdir(broadcastPath);

  let deployments = {};

  for (const dir of dirs) {
    console.log(dir);
    const d = await fs.readdir(`${broadcastPath}${dir}`);
    for (const dirr of d) {
      console.log(`chainId ${dirr}`);
      const filePath = `${broadcastPath}${dir}/${dirr}/run-latest.json`;

      console.log("path", filePath);
      const file = await fs.readFile(filePath);
      const json = JSON.parse(file);

      // console.log(json)

      for (const tx of json.transactions) {
        if (tx.transactionType === "CREATE") {
          const { contractName, contractAddress } = tx;

          //   console.log({ [contractName]: contractAddress });

          if (deployments[contractName] === undefined) {
            deployments[contractName] = {
              [dirr]: contractAddress,
            };
          } else {
            deployments[contractName] = {
              ...deployments[contractName],
              [dirr]: contractAddress,
            };
          }
        }
      }
    }
  }

  console.log(deployments);

  const json = JSON.stringify(deployments, null, 2);

  const chainDeployments = {};
  for (const contract in deployments) {
    if (Object.hasOwnProperty.call(deployments, contract)) {
      const [[chainId, address]] = Object.entries(deployments[contract]);
      const chain = chainDeployments[chainId] ?? {};
      chainDeployments[chainId] = {
        ...chain,
        [contract]: address,
      };
    }
  }

  for (const [chain, contracts] of Object.entries(chainDeployments)) {
    await fs.writeFile(`./${chain}.json`, JSON.stringify(contracts));
  }

  // console.log(chainDeployments);

  await fs.writeFile(`./deployments.json`, json);
}

getDeployments();
