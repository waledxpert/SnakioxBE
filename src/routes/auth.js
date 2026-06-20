import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler.js";
import { upsertUser } from "../services/store.js";
import {
  getRegistrationMessage,
  normalizeWallet,
  verifyRegistrationSignature
} from "../services/signatureService.js";
import { forbidden } from "../utils/errors.js";

const router = Router();

const registerSchema = z.object({
  wallet: z.string().min(1),
  signature: z.string().min(1)
});

router.get(
  "/message/:wallet",
  asyncHandler(async (req, res) => {
    const walletAddress = normalizeWallet(req.params.wallet);

    res.json({
      wallet: walletAddress,
      message: getRegistrationMessage(walletAddress)
    });
  })
);

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const walletAddress = normalizeWallet(input.wallet);

    if (!verifyRegistrationSignature(walletAddress, input.signature)) {
      throw forbidden("Invalid wallet signature");
    }

    const user = await upsertUser(walletAddress);

    res.status(201).json({
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        registeredAt: user.registeredAt,
        hasMinted: user.hasMinted
      }
    });
  })
);

export default router;
