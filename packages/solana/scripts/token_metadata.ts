import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata'

// Use the RPC endpoint of your choice.
const umi = createUmi('https://api.mainnet-beta.solana.com').use(mplTokenMetadata())

import { generateSigner, percentAmount } from '@metaplex-foundation/umi'
import {
    createNft,
    fetchDigitalAsset,
} from '@metaplex-foundation/mpl-token-metadata'

const asset = await fetchDigitalAsset(umi, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")

console.log(asset)
