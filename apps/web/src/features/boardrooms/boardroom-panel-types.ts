import type {
  Address,
  FixedPriceSaleState,
  LockedLiquidityState,
  MigratingBondingCurveState,
  PledgeCashDeployment,
} from "@pledge.cash/sdk";
import type { Dispatch, SetStateAction } from "react";
import type {
  BoardroomForm,
  BoardroomGrantForm,
  BoardroomSnapshot,
  CurveMigrationForm,
  FixedPriceSaleForm,
  LockedLiquidityExitForm,
  LockedLiquidityForm,
  MigratingCurveForm,
  WindDownForm,
} from "../../lib/types";

export type BoardroomPanelProps = {
  boardroom: BoardroomPanelState;
  fixedPriceSale: FixedPriceSalePanelState;
  grant: BoardroomGrantPanelState;
  lockedLiquidity: LockedLiquidityPanelState;
  migratingCurve: MigratingCurvePanelState;
  windDown: WindDownPanelState;
  workflow: BoardroomWorkflow;
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

export type MigratingCurvePanelState = {
  address: string;
  form: MigratingCurveForm;
  migrationForm: CurveMigrationForm;
  predicted: Address | undefined;
  snapshot: MigratingBondingCurveState | undefined;
  cancel: () => Promise<void>;
  create: () => Promise<void>;
  load: () => Promise<void>;
  migrate: () => Promise<void>;
  predict: () => Promise<void>;
  setCurveMigrationForm: Dispatch<SetStateAction<CurveMigrationForm>>;
  setMigratingCurveAddress: (address: string) => void;
  setMigratingCurveForm: Dispatch<SetStateAction<MigratingCurveForm>>;
};

export type LockedLiquidityPanelState = {
  address: string;
  exitForm: LockedLiquidityExitForm;
  form: LockedLiquidityForm;
  predicted: Address | undefined;
  snapshot: LockedLiquidityState | undefined;
  claimFees: () => Promise<void>;
  create: () => Promise<void>;
  exit: () => Promise<void>;
  load: () => Promise<void>;
  predict: () => Promise<void>;
  setLockedLiquidityAddress: (address: string) => void;
  setLockedLiquidityExitForm: Dispatch<SetStateAction<LockedLiquidityExitForm>>;
  setLockedLiquidityForm: Dispatch<SetStateAction<LockedLiquidityForm>>;
};

export type WindDownPanelState = {
  form: WindDownForm;
  burnTreasuryShares: () => Promise<void>;
  openRedemptions: () => Promise<void>;
  redeemShares: () => Promise<void>;
  registerRedeemableAsset: () => Promise<void>;
  setForm: Dispatch<SetStateAction<WindDownForm>>;
  start: () => Promise<void>;
};
