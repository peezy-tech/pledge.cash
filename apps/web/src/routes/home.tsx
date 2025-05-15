// @ts-nocheck
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useState } from 'react'
import { cn as cls } from '../lib/utils'
import * as THREE from 'three';

import {
  CopyIcon,
  MenuIcon,
  PlayIcon,
  PlugIcon,
  PlusIcon,
  SearchIcon,
  StoreIcon,
  UserIcon,
  UserRoundIcon,
  VaultIcon,
  WalletCardsIcon,
  WalletIcon,
} from 'lucide-react'
import { useElemSize } from '../hooks/useElemSize'
import { loadPhysX } from '../components/backdrop/loadPhysX'
import { useScreenSize } from '../hooks/useScreenSize'
import {
  AgentIcon,
  CharacterIcon,
  CheckIcon,
  DotsIcon,
  EmoteIcon,
  LockIcon,
  PetIcon,
  RewardIcon,
  SpinIcon,
  VehicleIcon,
} from '../components/Icons'
import { createViewerWorld } from '../components/backdrop/viewer'
import { Env } from '../components/backdrop/Env'

const formatter = new Intl.NumberFormat('en-US')

// Mock useAccount hook
const useAccount = () => {
  const [vrmUrl, setVrmUrl] = useState('/character-hyperbot.vrm');
  return {
    data: {
      id: 'mock-user-id',
      address: '0x1234567890abcdef1234567890abcdef12345678',
      balance: 12345.67,
      vrmUrl: vrmUrl,
      items: [
        { id: 'char1', type: 'character', vrmUrl: '/character-hyperbot.vrm', imageUrl: '/temp-avatar-1.png' },
        { id: 'char2', type: 'character', vrmUrl: '/character-fashionista.vrm', imageUrl: '/temp-avatar-2.png' },
        { id: 'emote1', type: 'emote', glbUrl: '/emote-wave.glb', imageUrl: '/temp-emote-1.png' },
        { id: 'emote2', type: 'emote', glbUrl: '/emote-dance.glb', imageUrl: '/temp-emote-2.png' },
      ],
    },
    privy: {
      login: () => console.log('Privy login called'),
      logout: () => {
        console.log('Privy logout called');
        // Simulate logout by clearing parts of mock data or resetting state if needed
      },
    },
    setVRM: (url: string) => {
      console.log('Setting VRM to:', url);
      setVrmUrl(url);
    }
  };
};

export function PageHome() {
  const account = useAccount()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [tab, setTab] = useState('play')
  const [elemRef, width, height] = useElemSize()
  const [world] = useState(() => {
    const world = createViewerWorld()
    world.register('env', Env)
    return world
  })
  useEffect(() => {
    const viewport = viewportRef.current
    const baseEnvironment = {
      model: null,
      hdr: '/lab67.hdr',
      sunDirection: new THREE.Vector3(-0.7, -1, 0.7).normalize(),
      sunIntensity: 1,
      sunColor: 0xffffff,
      fogNear: null,
      fogFar: null,
      fogColor: null,
    }
    if (viewport) {
      world.init({ viewport, loadPhysX, baseEnvironment })
    }
  }, [])
  useEffect(() => {
    world.env.setScene(tab)
    world.env.setEmote(null)
  }, [tab, world.env])
  useEffect(() => {
    if (tab === 'vault' && !account.data?.id) {
      setTab('play')
    }
  }, [account.data, tab])
  useEffect(() => {
    world.env.setVRM(account.data?.vrmUrl)
  }, [account.data?.vrmUrl, world.env])

  const changeTab = (newTab: string) => {
    if (newTab === 'market' || newTab === 'create') return
    if (newTab === 'vault' && !account.data.id) return account.privy.login()
    setTab(newTab)
  }
  return (
    <div
      ref={elemRef}
      className="h-screen dvh-screen pointer-events-none select-none"
    >
      <div className="home-viewport absolute inset-0 z-10" ref={viewportRef} />
      <div className="home-gui absolute inset-0 z-20 flex flex-col items-stretch">
        <div className="home-tabs px-16 py-5 md:py-11 flex items-center max-md:px-5">
          <div
            className={cls(
              'home-tab relative pointer-events-auto px-[18px] h-9 rounded-[10px] flex items-center justify-center bg-transparent transition-transform duration-150 ease-out',
              { 'selected bg-white/90 backdrop-blur-md outline outline-2 outline-black/10': tab === 'play' },
              'hover:not(.selected):bg-black/10 hover:not(.selected):scale-105 hover:not(.selected):rotate-[-1deg]'
            )}
            onClick={() => changeTab('play')}
          >
            <span className={cls(
              "text-lg font-extrabold text-white",
              { '!text-[#121212] [text-stroke:0px_rgba(0,0,0,0)] [-webkit-text-stroke:0px_rgba(0,0,0,0)]': tab === 'play' },
              'paint-stroke-fill [-webkit-text-stroke:4px_rgba(0,0,0,0.2)]'
            )}>PLAY</span>
          </div>
          <div
            className={cls(
              'home-tab relative pointer-events-auto px-[18px] h-9 rounded-[10px] flex items-center justify-center bg-transparent transition-transform duration-150 ease-out',
              { 'selected bg-white/90 backdrop-blur-md outline outline-2 outline-black/10': tab === 'vault' },
               'hover:not(.selected):bg-black/10 hover:not(.selected):scale-105 hover:not(.selected):rotate-[-1deg]'
            )}
            onClick={() => changeTab('vault')}
          >
            <span className={cls(
              "text-lg font-extrabold text-white",
              { '!text-[#121212] [text-stroke:0px_rgba(0,0,0,0)] [-webkit-text-stroke:0px_rgba(0,0,0,0)]': tab === 'vault' },
              'paint-stroke-fill [-webkit-text-stroke:4px_rgba(0,0,0,0.2)]'
            )}>VAULT</span>
          </div>
          <div
            className={cls(
              'home-tab locked relative pointer-events-auto px-[18px] h-9 rounded-[10px] flex items-center justify-center bg-transparent transition-transform duration-150 ease-out',
              'hover:not(.selected):bg-black/10 hover:not(.selected):scale-105 hover:not(.selected):rotate-[-1deg]',
              'hover:not(.selected).locked>span:text-white/50',
              'hover:not(.selected) .home-tab-lock:flex'
            )}
            onClick={() => changeTab('market')}
          >
            <span className="text-lg font-extrabold text-white paint-stroke-fill [-webkit-text-stroke:4px_rgba(0,0,0,0.2)]">MARKETPLACE</span>
            <div className="home-tab-lock absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[30px] h-[30px] flex items-center justify-center rounded-[7px] hidden">
              <LockIcon size={24} />
            </div>
          </div>
          <div
            className={cls(
              'home-tab locked relative pointer-events-auto px-[18px] h-9 rounded-[10px] flex items-center justify-center bg-transparent transition-transform duration-150 ease-out',
              'hover:not(.selected):bg-black/10 hover:not(.selected):scale-105 hover:not(.selected):rotate-[-1deg]',
              'hover:not(.selected).locked>span:text-white/50',
              'hover:not(.selected) .home-tab-lock:flex'
            )}
            onClick={() => changeTab('create')}
          >
            <span className="text-lg font-extrabold text-white paint-stroke-fill [-webkit-text-stroke:4px_rgba(0,0,0,0.2)]">CREATE</span>
            <div className="home-tab-lock absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[30px] h-[30px] flex items-center justify-center rounded-[7px] hidden">
              <LockIcon size={24} />
            </div>
          </div>
        </div>
        <Account />
        {tab === 'play' && <Play world={world} />}
        {tab === 'vault' && <Vault world={world} />}
      </div>
    </div>
  )
}

function Account() {
  const account = useAccount()
  const [menu, setMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const copy = () => {
    if (account.data?.address) {
      navigator.clipboard.writeText(account.data.address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }
  return (
    <div
      className="account z-20 absolute top-[43px] right-16 flex items-center pointer-events-auto md:top-[18px] md:right-5 sm:top-20 sm:right-[27px]"
    >
      {!account.data && account.privy?.login && (
        <div className="account-preparing h-10 w-10 rounded-full bg-white flex items-center justify-center outline outline-2 outline-black/10 text-[#121212]" onClick={account.privy.login}>
          <SpinIcon className="animate-spin" />
        </div>
      )}
      {account.data && !account.data.id && account.privy?.login && (
        <div
          className="account-connect h-9 bg-black/40 backdrop-blur-3xl border-2 border-white outline outline-2 outline-black/10 rounded-[18px] flex items-center justify-center px-[18px] transition-colors duration-150 ease-out hover:bg-white hover:scale-105"
          onClick={account.privy.login}
        >
          <span className="text-base font-semibold text-white transition-colors duration-150 ease-out group-hover:text-[#121212]">CONNECT</span>
        </div>
      )}
      {account.data?.id && (
        <div className="account-info -mt-0.5 flex items-center">
          <img className="account-hyper w-[22px] shrink-0" src="/hyper-coin.svg" alt="Hyper Coin"/>
          <div className="account-balance ml-[5px] text-lg font-extrabold paint-stroke-fill [-webkit-text-stroke:4px_rgba(0,0,0,0.2)]">
            {account.data.balance ? formatter.format(account.data.balance) : '0'}
          </div>
          <div
            className="account-pfp ml-[30px] w-10 h-10 rounded-full bg-white outline outline-2 outline-black/10 flex items-center justify-center text-[#121212] hover:cursor-pointer"
            onClick={() => setMenu(!menu)}
          >
            <CharacterIcon size={24} />
          </div>
        </div>
      )}
      {menu && account.data?.address && (
        <div className="account-menu absolute top-[calc(100%+20px)] right-0 bg-white text-black/80 pt-5 w-[200px] shadow-[0_2px_5px_rgba(0,0,0,0.2)] rounded-[10px]">
          <div className="account-address px-5 flex items-center">
            <div className="account-address-text flex-1">{shortAddress(account.data.address)}</div>
            {!copied && (
              <div className="account-address-copy text-black/40 hover:text-black/90 hover:cursor-pointer" onClick={copy}>
                <CopyIcon size={14} />
              </div>
            )}
            {copied && <div className="account-address-copied text-xs font-medium text-black/70">COPIED!</div>}
          </div>
          {account.privy?.logout && (
            <div
              className="account-disconnect mt-5 border-t border-black/10 py-3 px-5 text-center hover:cursor-pointer group"
              onClick={() => {
                setMenu(false)
                account.privy.logout()
              }}
            >
              <span className="text-black/50 group-hover:text-black">Disconnect</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function shortAddress(address: string | undefined) {
  if (!address) return ''
  const first4 = address.substring(0, 4)
  const last4 = address.substring(address.length - 4)
  return `${first4}...${last4}`
}

function Content({ offset, children }: { offset: number, children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const spacerRef = useRef<HTMLDivElement>(null)

  return (
    <div
      ref={containerRef}
      className="content noscrollbar flex-1 flex flex-col overflow-y-auto"
      style={{ maskImage: 'linear-gradient(to top, black calc(100% - 20px), black 20px, transparent)', WebkitMaskImage: 'linear-gradient(to top, black calc(100% - 20px), black 20px, transparent)' }}
    >
      <div className="content-spacer shrink-0" ref={spacerRef} style={{ height: `calc(100% - ${offset}px)` }} />
      <div className="content-inner pointer-events-auto">{children}</div>
    </div>
  )
}

function Play({ world }: { world: any }) {
  const [width] = useScreenSize() ?? [0];
  const offset = 194 + (width < 750 ? 20 : 44)
  const playInsetClass = "px-16 md:px-5";

  return (
    <div
      className="play flex-1 flex"
    >
      <Content offset={offset}>
        <div className={cls("play-title mb-5", playInsetClass)}>
          <span className="text-2xl font-extrabold leading-none paint-stroke-fill [-webkit-text-stroke:4px_rgba(0,0,0,0.2)]">
            WORLDS
          </span>
        </div>
        <div className={cls("play-worlds noscrollbar overflow-x-auto -mx-2.5 mb-5 flex gap-[15px] whitespace-nowrap", playInsetClass, "py-2.5")}>
          <div className="play-world relative overflow-hidden h-[150px] aspect-[16/9] rounded-[20px] shrink-0 outline outline-2 outline-black/10 border-2 border-transparent transition-all duration-150 ease-out hover:cursor-pointer hover:outline-white hover:border-black hover:scale-105 group">
            <div
              className="play-world-image absolute inset-0 bg-cover bg-center transition-transform duration-150 ease-out group-hover:scale-125"
              style={{ backgroundImage: "url('/temp-game-bg.jpeg')" }}
            />
          </div>
          <div className="play-world relative overflow-hidden h-[150px] aspect-[16/9] rounded-[20px] shrink-0 outline outline-2 outline-black/10 border-2 border-transparent transition-all duration-150 ease-out hover:cursor-pointer hover:outline-white hover:border-black hover:scale-105 group">
            <div
              className="play-world-image absolute inset-0 bg-cover bg-center transition-transform duration-150 ease-out group-hover:scale-125"
              style={{ backgroundImage: "url('/temp-game-bg.jpeg')" }}
            />
          </div>
          <div className="play-world relative overflow-hidden h-[150px] aspect-[16/9] rounded-[20px] shrink-0 outline outline-2 outline-black/10 border-2 border-transparent transition-all duration-150 ease-out hover:cursor-pointer hover:outline-white hover:border-black hover:scale-105 group">
            <div
              className="play-world-image absolute inset-0 bg-cover bg-center transition-transform duration-150 ease-out group-hover:scale-125"
              style={{ backgroundImage: "url('/temp-game-bg.jpeg')" }}
            />
          </div>
        </div>
      </Content>
    </div>
  )
}

function Vault({ world }: { world: any }) {
  const account = useAccount()
  const [tab, setTab] = useState('characters')
  const characters = useMemo(() => {
    return account.data?.items.filter((c: any) => c.type === 'character') || []
  }, [account.data?.items])
  const emotes = useMemo(() => {
    return account.data?.items.filter((c: any) => c.type === 'emote') || []
  }, [account.data?.items])

  const vaultBottomClass = "mb-11 md:mb-5";
  const vaultLeftClass = "ml-16 md:ml-5";
  const vaultListPaddingClass = "pl-10 md:pl-5";

  return (
    <div
      className="vault absolute bottom-0 left-0 right-0 flex"
    >
      <div className={cls("vault-tabs shrink-0 flex flex-col bg-white/5 backdrop-blur-md rounded-[10px] pointer-events-auto", vaultBottomClass, vaultLeftClass)}>
        {[
          { id: 'characters', icon: <CharacterIcon />, label: 'Characters' },
          { id: 'emotes', icon: <EmoteIcon />, label: 'Emotes' },
          { id: 'rewards', icon: <RewardIcon />, label: 'Rewards' },
          { id: 'agents', icon: <AgentIcon />, label: 'Agents' },
          { id: 'vehicles', icon: <VehicleIcon />, label: 'Vehicles' },
          { id: 'pets', icon: <PetIcon />, label: 'Pets' },
          { id: 'misc', icon: <DotsIcon />, label: 'Misc' },
        ].map(t => (
          <div
            key={t.id}
            className={cls(
              'vault-tab w-11 h-11 rounded-[10px] flex items-center justify-center transition-transform duration-150 ease-out group',
              { 'selected bg-white text-[#121212] border-2 border-[#121212] outline outline-2 outline-white scale-102': tab === t.id }
            )}
            onClick={() => setTab(t.id)}
          >
            {React.cloneElement(t.icon, { className: cls('transition-transform duration-150 ease-out', tab === t.id ? 'scale-125' : 'group-hover:scale-125 group-hover:rotate-2') })}
          </div>
        ))}
      </div>

      {tab === 'characters' && account.data?.items && (
        <div className="vault-content flex flex-col justify-end flex-1">
          <div className={cls("vault-title mb-5", vaultListPaddingClass)}>
            <span className="text-2xl font-extrabold paint-stroke-fill [-webkit-text-stroke:4px_rgba(0,0,0,0.2)]">CHARACTERS</span>
          </div>
          <div
            className={cls("vault-list noscrollbar overflow-x-auto -mx-2.5 flex gap-[15px] whitespace-nowrap pointer-events-auto", vaultListPaddingClass, "py-2.5 pr-5", vaultBottomClass)}
            style={{ maskImage: 'linear-gradient(to right, transparent, black 20px, black calc(100% - 20px), transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 20px, black calc(100% - 20px), transparent)' }}
          >
            {characters.map((item: any) => (
              <div
                className="vault-item relative overflow-hidden w-[160px] aspect-[3/4] rounded-[20px] shrink-0 outline outline-2 outline-black/10 border-2 border-transparent transition-all duration-150 ease-out hover:cursor-pointer hover:outline-white hover:border-black hover:scale-105 group"
                key={item.id}
                onClick={() => account.setVRM(item.vrmUrl)}
              >
                <div
                  className="vault-item-image absolute inset-0 bg-cover bg-center transition-transform duration-150 ease-out group-hover:scale-125"
                  style={{ backgroundImage: `url(${item.imageUrl})` }}
                />
                {item.vrmUrl === account.data.vrmUrl && (
                  <div className="vault-item-active absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white text-[#121212] outline outline-2 outline-black/20 flex items-center justify-center">
                    <CheckIcon size={16} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {tab === 'emotes' && account.data?.items && (
        <div className="vault-content flex flex-col justify-end flex-1">
          <div className={cls("vault-title mb-5", vaultListPaddingClass)}>
            <span className="text-2xl font-extrabold paint-stroke-fill [-webkit-text-stroke:4px_rgba(0,0,0,0.2)]">EMOTES</span>
          </div>
          <div
            className={cls("vault-list noscrollbar overflow-x-auto -mx-2.5 flex gap-[15px] whitespace-nowrap pointer-events-auto", vaultListPaddingClass, "py-2.5 pr-5", vaultBottomClass)}
             style={{ maskImage: 'linear-gradient(to right, transparent, black 20px, black calc(100% - 20px), transparent)', WebkitMaskImage: 'linear-gradient(to right, transparent, black 20px, black calc(100% - 20px), transparent)' }}
          >
            {emotes.map((item: any) => (
              <div
                key={item.id}
                className="vault-item relative overflow-hidden w-[160px] aspect-[3/4] rounded-[20px] shrink-0 outline outline-2 outline-black/10 border-2 border-transparent transition-all duration-150 ease-out hover:cursor-pointer hover:outline-white hover:border-black hover:scale-105 group"
                onClick={() => world.env.setEmote(item.glbUrl)}
              >
                <div
                  className="vault-item-image absolute inset-0 bg-cover bg-center transition-transform duration-150 ease-out group-hover:scale-125"
                  style={{ backgroundImage: `url(${item.imageUrl})` }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
