"use client"

import * as React from "react"
import { useMediaQuery } from "@/hooks/use-media-query"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Drawer,
  DrawerContent,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ChevronDown, Search } from "lucide-react"

export interface TokenOption {
  name: string
  balance?: string
  icon?: React.ReactNode
}

interface TokenComboboxProps {
  tokens: TokenOption[]
  selectedToken: string
  onTokenSelect: (token: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}

export function TokenCombobox({
  tokens,
  selectedToken,
  onTokenSelect,
  placeholder = "Select token",
  className = "",
  disabled = false,
}: TokenComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const isDesktop = useMediaQuery("(min-width: 768px)")
  
  const selectedTokenData = tokens.find(token => token.name === selectedToken)

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={`w-full justify-between ${className}`}
            disabled={disabled}
          >
            {selectedTokenData ? (
              <div className="flex items-center gap-2">
                {selectedTokenData.icon}
                <span>{selectedTokenData.name}</span>
              </div>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" align="start">
          <TokenList
            tokens={tokens}
            selectedToken={selectedToken}
            setOpen={setOpen}
            onTokenSelect={onTokenSelect}
          />
        </PopoverContent>
      </Popover>
    )
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={`w-full justify-between ${className}`}
          disabled={disabled}
        >
          {selectedTokenData ? (
            <div className="flex items-center gap-2">
              {selectedTokenData.icon}
              <span>{selectedTokenData.name}</span>
            </div>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DrawerTrigger>
      <DrawerContent>
        <div className="mt-4 border-t">
          <TokenList
            tokens={tokens}
            selectedToken={selectedToken}
            setOpen={setOpen}
            onTokenSelect={onTokenSelect}
          />
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function TokenList({
  tokens,
  selectedToken,
  setOpen,
  onTokenSelect,
}: {
  tokens: TokenOption[]
  selectedToken: string
  setOpen: (open: boolean) => void
  onTokenSelect: (token: string) => void
}) {
  return (
    <Command>
      <CommandInput placeholder="Search tokens..." />
      <CommandList>
        <CommandEmpty>No tokens found.</CommandEmpty>
        <CommandGroup>
          {tokens.map((token) => (
            <CommandItem
              key={token.name}
              value={token.name}
              onSelect={(value) => {
                onTokenSelect(value)
                setOpen(false)
              }}
            >
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2">
                  {token.icon}
                  <span>{token.name}</span>
                </div>
                {token.balance && (
                  <span className="text-sm text-muted-foreground">
                    {token.balance}
                  </span>
                )}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
} 