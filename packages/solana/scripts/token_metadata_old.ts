import { Metaplex } from "@metaplex-foundation/js";
import { Connection, PublicKey } from "@solana/web3.js";
import { ENV, TokenListProvider } from "@solana/spl-token-registry";

async function getTokenMetadata() {
    console.log('Starting getTokenMetadata function');

    const connection = new Connection("https://api.mainnet-beta.solana.com");
    console.log('Connection established to:', "https://api.mainnet-beta.solana.com");

    const metaplex = Metaplex.make(connection);
    console.log('Metaplex instance created');

    const mintAddress = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    console.log('Mint address:', mintAddress.toBase58());

    let tokenName;
    let tokenSymbol;
    let tokenLogo;
    let decimals;

    // First get mint info for decimals
    console.log('Fetching mint info');
    try {
        const mintInfo = await connection.getParsedAccountInfo(mintAddress);
        // console.log('Raw mint info:', mintInfo);

        if (mintInfo.value?.data && 'parsed' in mintInfo.value.data) {
            decimals = mintInfo.value.data.parsed.info.decimals;
            console.log('Decimals from mint:', decimals);
        }
    } catch (error) {
        console.error('Error fetching mint info:', error);
    }

    console.log('Getting metadata account PDA');
    const metadataAccount = metaplex
        .nfts()
        .pdas()
        .metadata({ mint: mintAddress });
    console.log('Metadata account address:', metadataAccount.toBase58());

    console.log('Fetching metadata account info');
    const metadataAccountInfo = await connection.getAccountInfo(metadataAccount);
    console.log('Metadata account exists:', !!metadataAccountInfo);

    if (metadataAccountInfo) {
        console.log('Metadata account found, fetching NFT data');
        try {
            const token = await metaplex.nfts().findByMint({ mintAddress: mintAddress });
            // console.log('NFT data retrieved:', token);

            tokenName = token.name;
            tokenSymbol = token.symbol;
            tokenLogo = token.json?.image;

            console.log('Token data from NFT:', {
                name: tokenName,
                symbol: tokenSymbol,
                logo: tokenLogo,
                decimals
            });
        } catch (error) {
            console.error('Error fetching NFT data:', error);
        }
    }
    else {
        console.log('Metadata account not found, falling back to token list');
        try {
            const provider = await new TokenListProvider().resolve();
            console.log('Token list provider resolved');

            const tokenList = provider.filterByChainId(ENV.MainnetBeta).getList();
            console.log('Total tokens in filtered list:', tokenList.length);

            console.log('Creating token map');
            const tokenMap = tokenList.reduce((map, item) => {
                map.set(item.address, item);
                return map;
            }, new Map());
            console.log('Token map size:', tokenMap.size);

            const token = tokenMap.get(mintAddress.toBase58());
            console.log('Found token in map:', !!token);

            if (token) {
                tokenName = token.name;
                tokenSymbol = token.symbol;
                tokenLogo = token.logoURI;
                // If we didn't get decimals from mint, try token list
                if (decimals === undefined) {
                    decimals = token.decimals;
                    console.log('Decimals from token list:', decimals);
                }

                console.log('Token data from list:', {
                    name: tokenName,
                    symbol: tokenSymbol,
                    logo: tokenLogo,
                    decimals
                });
            } else {
                console.warn('Token not found in token list');
            }
        } catch (error) {
            console.error('Error fetching from token list:', error);
        }
    }

    console.log('Final token data:', {
        name: tokenName,
        symbol: tokenSymbol,
        logo: tokenLogo,
        decimals
    });

    return {
        name: tokenName,
        symbol: tokenSymbol,
        logo: tokenLogo,
        decimals
    };
}

console.log('Starting script');
await getTokenMetadata()
    .then(result => console.log('Script completed successfully:', result))
    .catch(error => console.error('Script failed:', error));
