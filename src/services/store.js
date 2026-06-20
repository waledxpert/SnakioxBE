import { env } from "../config/env.js";
import * as jsonStore from "./jsonStore.js";
import * as postgresStore from "./postgresStore.js";

const selectedStore =
  env.storageDriver === "postgres" ? postgresStore : jsonStore;

export const upsertUser = selectedStore.upsertUser;
export const findUser = selectedStore.findUser;
export const createInviteCodes = selectedStore.createInviteCodes;
export const clearInviteCodes = selectedStore.clearInviteCodes;
export const listInviteCodes = selectedStore.listInviteCodes;
export const redeemInviteCode = selectedStore.redeemInviteCode;
export const findInviteByWallet = selectedStore.findInviteByWallet;
export const listAllowlist = selectedStore.listAllowlist;
export const addAllowlistWallets = selectedStore.addAllowlistWallets;
export const removeAllowlistWallet = selectedStore.removeAllowlistWallet;
export const clearAllowlist = selectedStore.clearAllowlist;
export const isWalletAllowlisted = selectedStore.isWalletAllowlisted;
export const getSettings = selectedStore.getSettings;
export const updateSettings = selectedStore.updateSettings;
export const markInviteMinted = selectedStore.markInviteMinted;
export const findSessionsByWallet = selectedStore.findSessionsByWallet;
export const findSessionById = selectedStore.findSessionById;
export const createSession = selectedStore.createSession;
export const updateSession = selectedStore.updateSession;
export const createMintRecord = selectedStore.createMintRecord;
export const checkStoreHealth = selectedStore.checkStoreHealth;
export const closeStore = selectedStore.closeStore;
