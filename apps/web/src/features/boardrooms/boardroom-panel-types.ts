import type {
  Address,
  BondMarketState,
  DutchAuctionState,
  FixedPriceSaleState,
  ProtocolLiquidityVaultState as LockedLiquidityState,
  MerkleAirdropState,
  MigratingBondingCurveState,
  PledgeCashDeployment,
} from "@pledge.cash/sdk";
import type { Dispatch, SetStateAction } from "react";
import type { Capability } from "../capabilities/project-capabilities";
import type {
  BoardroomForm,
  BondMarketForm,
  BoardroomGrantForm,
  BoardroomSnapshot,
  CurveMigrationForm,
  DutchAuctionForm,
  FixedPriceSaleForm,
  LockedLiquidityExitForm,
  LockedLiquidityForm,
  MerkleAirdropForm,
  MigratingCurveForm,
  WindDownForm,
} from "../../lib/types";

export type BoardroomPanelProps = {
  section?: "all" | "setup" | "token" | "grants" | "distributions" | "liquidity" | "governance" | "close";
  boardroomIdentityLocked?: boolean | undefined;
  capabilities?: BoardroomPanelCapabilities | undefined;
  boardroom: BoardroomPanelState;
  bondMarket: BondMarketPanelState;
  dutchAuction: DutchAuctionPanelState;
  fixedPriceSale: FixedPriceSalePanelState;
  grant: BoardroomGrantPanelState;
  lockedLiquidity: LockedLiquidityPanelState;
  merkleAirdrop: MerkleAirdropPanelState;
  migratingCurve: MigratingCurvePanelState;
  windDown: WindDownPanelState;
  workflow: BoardroomWorkflow;
};

export type BondMarketPanelState = {
  address: string;
  form: BondMarketForm;
  predicted: Address | undefined;
  snapshot: BondMarketState | undefined;
  close: () => Promise<void>;
  create: () => Promise<void>;
  load: () => Promise<void>;
  predict: () => Promise<void>;
  setAddress: (address: string) => void;
  setForm: Dispatch<SetStateAction<BondMarketForm>>;
};

export type BoardroomPanelCapabilities = {
  claimRedemption: Capability;
  createBoardroom: Capability;
  createDistribution: Capability;
  createGrant: Capability;
  createLiquidity: Capability;
  manageDistribution: Capability;
  manageLiquidity: Capability;
  mint: Capability;
  beginSnapshot: Capability;
  openRedemptions: Capability;
  processSnapshot: Capability;
  permissionlessWindDown: Capability;
  redeem: Capability;
  registerRedeemableAsset: Capability;
  startWindDown: Capability;
};

export type BoardroomWorkflow = {
  deployment: PledgeCashDeployment | undefined;
  pendingAction: string | undefined;
  runAction: (label: string, action: () => Promise<void>) => Promise<void>;
};

export type BoardroomPanelState = {
  address: string;
  form: BoardroomForm;
  mintAmount: string;
  mintTo: string;
  predicted: Address | undefined;
  snapshot: BoardroomSnapshot | undefined;
  create: () => Promise<void>;
  load: () => Promise<void>;
  migrate: () => Promise<void>;
  mintShares: () => Promise<void>;
  predict: () => Promise<void>;
  setBoardroomAddress: (address: string) => void;
  setBoardroomForm: Dispatch<SetStateAction<BoardroomForm>>;
  setBoardroomMintAmount: Dispatch<SetStateAction<string>>;
  setBoardroomMintTo: Dispatch<SetStateAction<string>>;
  setPredictedBoardroom: Dispatch<SetStateAction<Address | undefined>>;
};

export type BoardroomGrantPanelState = {
  form: BoardroomGrantForm;
  predicted: Address | undefined;
  approveFactory: () => Promise<void>;
  clearPrediction: () => void;
  create: () => Promise<void>;
  createBatch: () => Promise<void>;
  predict: () => Promise<void>;
  setForm: Dispatch<SetStateAction<BoardroomGrantForm>>;
};

export type FixedPriceSalePanelState = {
  address: string;
  form: FixedPriceSaleForm;
  predicted: Address | undefined;
  snapshot: FixedPriceSaleState | undefined;
  cancel: () => Promise<void>;
  close: () => Promise<void>;
  create: () => Promise<void>;
  load: () => Promise<void>;
  predict: () => Promise<void>;
  setFixedPriceSaleAddress: (address: string) => void;
  setFixedPriceSaleForm: Dispatch<SetStateAction<FixedPriceSaleForm>>;
};

export type DutchAuctionPanelState = {
  address: string;
  form: DutchAuctionForm;
  predicted: Address | undefined;
  snapshot: DutchAuctionState | undefined;
  cancel: () => Promise<void>;
  close: () => Promise<void>;
  create: () => Promise<void>;
  finalize: () => Promise<void>;
  load: () => Promise<void>;
  predict: () => Promise<void>;
  setAddress: (address: string) => void;
  setForm: Dispatch<SetStateAction<DutchAuctionForm>>;
};

export type MerkleAirdropPanelState = {
  address: string;
  form: MerkleAirdropForm;
  predicted: Address | undefined;
  snapshot: MerkleAirdropState | undefined;
  cancel: () => Promise<void>;
  close: () => Promise<void>;
  create: () => Promise<void>;
  load: () => Promise<void>;
  predict: () => Promise<void>;
  setMerkleAirdropAddress: (address: string) => void;
  setMerkleAirdropForm: Dispatch<SetStateAction<MerkleAirdropForm>>;
};

export type MigratingCurvePanelState = {
  address: string;
  form: MigratingCurveForm;
  migrationForm: CurveMigrationForm;
  predicted: Address | undefined;
  snapshot: MigratingBondingCurveState | undefined;
  cancel: () => Promise<void>;
  create: () => Promise<void>;
  expire: () => Promise<void>;
  fallbackToUnwind: () => Promise<void>;
  finalizeForfeiture: () => Promise<void>;
  finalizeUnwind: () => Promise<void>;
  load: () => Promise<void>;
  migrate: () => Promise<void>;
  openForfeiture: () => Promise<void>;
  predict: () => Promise<void>;
  recoverForfeitedQuote: () => Promise<void>;
  recoverQuote: () => Promise<void>;
  setCurveMigrationForm: Dispatch<SetStateAction<CurveMigrationForm>>;
  setMigratingCurveAddress: (address: string) => void;
  setMigratingCurveForm: Dispatch<SetStateAction<MigratingCurveForm>>;
  vetoForfeiture: () => Promise<void>;
};

export type LockedLiquidityPanelState = {
  add: () => Promise<void>;
  address: string;
  close: () => Promise<void>;
  exitForm: LockedLiquidityExitForm;
  form: LockedLiquidityForm;
  predicted: Address | undefined;
  snapshot: LockedLiquidityState | undefined;
  claimFees: () => Promise<void>;
  create: () => Promise<void>;
  exit: () => Promise<void>;
  load: () => Promise<void>;
  predict: () => Promise<void>;
  releaseClaims: () => Promise<void>;
  remove: () => Promise<void>;
  setLockedLiquidityAddress: (address: string) => void;
  setLockedLiquidityExitForm: Dispatch<SetStateAction<LockedLiquidityExitForm>>;
  setLockedLiquidityForm: Dispatch<SetStateAction<LockedLiquidityForm>>;
};

export type WindDownPanelState = {
  form: WindDownForm;
  burnTreasuryShares: () => Promise<void>;
  beginSnapshot: () => Promise<void>;
  claimRedemptionAsset: () => Promise<void>;
  openRedemptions: () => Promise<void>;
  processSnapshot: () => Promise<void>;
  pruneObligation: (obligation: string) => Promise<void>;
  pruneObligations: (obligations: string) => Promise<void>;
  redeemShares: () => Promise<void>;
  registerRedeemableAsset: () => Promise<void>;
  setForm: Dispatch<SetStateAction<WindDownForm>>;
  start: () => Promise<void>;
};
