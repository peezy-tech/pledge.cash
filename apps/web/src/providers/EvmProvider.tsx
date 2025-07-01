"use client";

import * as React from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { SimpleKitProvider } from "@/components/evm/simplekit";
import { queryClient } from './QueryClientProvider'
import { config } from '@/wagmiConfig'

// 4. Create your Wagmi provider
export function EvmProvider(props: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
        <SimpleKitProvider>{props.children}</SimpleKitProvider>
    </WagmiProvider>
  );
}