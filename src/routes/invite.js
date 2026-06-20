import { Router } from "express";
import { ethers } from "ethers";
import { z } from "zod";
import { env } from "../config/env.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { conflict, forbidden } from "../utils/errors.js";
import { normalizeWallet } from "../services/signatureService.js";
import {
  addAllowlistWallets,
  clearAllowlist,
  clearInviteCodes,
  createInviteCodes,
  getSettings,
  listAllowlist,
  listInviteCodes,
  removeAllowlistWallet,
  redeemInviteCode,
  updateSettings
} from "../services/store.js";

const router = Router();

const adminPrefix = "Generate Snakiox invite codes with wallet";
const redeemPrefix = "Redeem Snakiox invite code";

const generateSchema = z.object({
  wallet: z.string().min(1),
  signature: z.string().min(1),
  count: z.number().int().min(1).max(1000).default(1)
});

const adminAuthSchema = z.object({
  wallet: z.string().min(1),
  signature: z.string().min(1)
});

const settingsSchema = adminAuthSchema.extend({
  inviteRequired: z.boolean()
});

const redeemSchema = z.object({
  wallet: z.string().min(1),
  code: z.string().min(1),
  signature: z.string().min(1)
});

const allowlistAddSchema = adminAuthSchema.extend({
  wallets: z.array(z.string().min(1)).min(1).max(1000)
});

const allowlistRemoveSchema = adminAuthSchema.extend({
  targetWallet: z.string().min(1)
});

router.get(
  "/admin/message/:wallet",
  asyncHandler(async (req, res) => {
    const wallet = normalizeWallet(req.params.wallet);
    res.json({ wallet, message: getAdminMessage(wallet) });
  })
);

router.post(
  "/admin/generate",
  asyncHandler(async (req, res) => {
    const input = generateSchema.parse(req.body);
    const wallet = normalizeWallet(input.wallet);

    assertAdminSignature(wallet, input.signature);

    const codes = await createInviteCodes({
      count: input.count,
      createdBy: wallet
    });

    res.status(201).json({ codes: codes.map(serializeInvite) });
  })
);

router.post(
  "/admin/list",
  asyncHandler(async (req, res) => {
    const input = adminAuthSchema.parse(req.body);
    const wallet = normalizeWallet(input.wallet);

    assertAdminSignature(wallet, input.signature);

    const codes = await listInviteCodes();
    res.json({ codes: codes.map(serializeInvite) });
  })
);

router.post(
  "/admin/clear",
  asyncHandler(async (req, res) => {
    const input = adminAuthSchema.parse(req.body);
    const wallet = normalizeWallet(input.wallet);

    assertAdminSignature(wallet, input.signature);

    await clearInviteCodes();
    res.json({ codes: [] });
  })
);

router.post(
  "/admin/settings",
  asyncHandler(async (req, res) => {
    const input = settingsSchema.parse(req.body);
    const wallet = normalizeWallet(input.wallet);

    assertAdminSignature(wallet, input.signature);

    const settings = await updateSettings({ inviteRequired: input.inviteRequired });
    res.json({ settings });
  })
);

router.post(
  "/admin/settings/read",
  asyncHandler(async (req, res) => {
    const input = adminAuthSchema.parse(req.body);
    const wallet = normalizeWallet(input.wallet);

    assertAdminSignature(wallet, input.signature);

    const settings = await getSettings();
    res.json({ settings });
  })
);

router.post(
  "/admin/allowlist/list",
  asyncHandler(async (req, res) => {
    const input = adminAuthSchema.parse(req.body);
    const wallet = normalizeWallet(input.wallet);
    assertAdminSignature(wallet, input.signature);

    const entries = await listAllowlist();
    res.json({ entries });
  })
);

router.post(
  "/admin/allowlist/add",
  asyncHandler(async (req, res) => {
    const input = allowlistAddSchema.parse(req.body);
    const wallet = normalizeWallet(input.wallet);
    assertAdminSignature(wallet, input.signature);

    const walletAddresses = [...new Set(input.wallets.map(normalizeWallet))];
    const entries = await addAllowlistWallets({ walletAddresses, addedBy: wallet });
    res.status(201).json({ entries });
  })
);

router.post(
  "/admin/allowlist/remove",
  asyncHandler(async (req, res) => {
    const input = allowlistRemoveSchema.parse(req.body);
    const wallet = normalizeWallet(input.wallet);
    assertAdminSignature(wallet, input.signature);

    const targetWallet = normalizeWallet(input.targetWallet);
    const removed = await removeAllowlistWallet(targetWallet);
    res.json({ removed, walletAddress: targetWallet });
  })
);

router.post(
  "/admin/allowlist/clear",
  asyncHandler(async (req, res) => {
    const input = adminAuthSchema.parse(req.body);
    const wallet = normalizeWallet(input.wallet);
    assertAdminSignature(wallet, input.signature);

    await clearAllowlist();
    res.json({ entries: [] });
  })
);

router.get(
  "/redeem/message/:wallet/:code",
  asyncHandler(async (req, res) => {
    const wallet = normalizeWallet(req.params.wallet);
    const code = normalizeCode(req.params.code);
    res.json({ wallet, code, message: getRedeemMessage(wallet, code) });
  })
);

router.post(
  "/redeem",
  asyncHandler(async (req, res) => {
    const input = redeemSchema.parse(req.body);
    const wallet = normalizeWallet(input.wallet);
    const code = normalizeCode(input.code);

    const recovered = ethers.verifyMessage(getRedeemMessage(wallet, code), input.signature);
    if (normalizeWallet(recovered) !== wallet) {
      throw forbidden("Invalid invite redemption signature");
    }

    try {
      const invite = await redeemInviteCode({ code, walletAddress: wallet });
      res.json({ invite: serializeInvite(invite) });
    } catch (error) {
      if (["INVITE_NOT_FOUND", "INVITE_USED", "WALLET_HAS_INVITE"].includes(error.code)) {
        throw conflict(error.message);
      }
      throw error;
    }
  })
);

function assertAdminSignature(wallet, signature) {
  const adminWallet = env.adminWalletAddress
    ? normalizeWallet(env.adminWalletAddress)
    : normalizeWallet(env.gameSignerPrivateKey ? new ethers.Wallet(env.gameSignerPrivateKey).address : wallet);

  if (wallet !== adminWallet) {
    throw forbidden("Wallet is not allowed to generate invite codes");
  }

  const recovered = ethers.verifyMessage(getAdminMessage(wallet), signature);
  if (normalizeWallet(recovered) !== wallet) {
    throw forbidden("Invalid admin signature");
  }
}

function getAdminMessage(wallet) {
  return `${adminPrefix} ${normalizeWallet(wallet)}`;
}

function getRedeemMessage(wallet, code) {
  return `${redeemPrefix} ${normalizeWallet(wallet)} ${normalizeCode(code)}`;
}

function normalizeCode(code) {
  return String(code).trim().toUpperCase();
}

function serializeInvite(invite) {
  return {
    code: invite.code,
    createdBy: invite.createdBy,
    createdAt: invite.createdAt,
    redeemedBy: invite.redeemedBy,
    redeemedAt: invite.redeemedAt,
    mintedBy: invite.mintedBy,
    mintedAt: invite.mintedAt
  };
}

export default router;
