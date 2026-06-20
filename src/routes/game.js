import { Router } from "express";
import { z } from "zod";
import {
  completeGame,
  getGameStatus,
  getLockedResult,
  getLockedResults,
  recordMint,
  serializeSessionResult,
  startGame
} from "../services/gameService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { normalizeWallet } from "../services/signatureService.js";

const router = Router();

const cellSchema = z.object({
  x: z.number().int(),
  y: z.number().int()
});

const moveSchema = z.object({
  direction: z.enum(["UP", "DOWN", "LEFT", "RIGHT"]),
  tick: z.number().int().nonnegative().optional(),
  atMs: z.number().int().nonnegative().optional()
});

const startSchema = z.object({
  wallet: z.string().min(1)
});

const completeSchema = z.object({
  sessionId: z.string().min(1),
  wallet: z.string().min(1),
  score: z.number().int().nonnegative(),
  snakeLength: z.number().int().positive(),
  finalSnakeCells: z.array(cellSchema).min(1),
  moves: z.array(moveSchema).min(1),
  deathReason: z.enum(["wall", "self", "timeout", "manual"])
});

const mintRecordSchema = z.object({
  wallet: z.string().min(1),
  sessionId: z.string().min(1),
  tokenId: z.union([z.string().min(1), z.number().int().nonnegative()]),
  txHash: z.string().min(1)
});

router.get(
  "/status/:wallet",
  asyncHandler(async (req, res) => {
    const status = await getGameStatus(req.params.wallet);
    res.json(status);
  })
);

router.post(
  "/start",
  asyncHandler(async (req, res) => {
    const input = startSchema.parse(req.body);
    const session = await startGame(input.wallet);

    res.status(201).json({
      allowed: true,
      sessionId: session.id,
      wallet: session.walletAddress,
      status: session.status,
      startedAt: session.startedAt
    });
  })
);

router.post(
  "/complete",
  asyncHandler(async (req, res) => {
    const input = completeSchema.parse(req.body);
    const result = await completeGame(input);
    const session = serializeSessionResult(result.session);

    res.json({
      locked: true,
      session: {
        id: session.id,
        walletAddress: session.walletAddress,
        status: session.status,
        score: session.score,
        snakeLength: session.snakeLength,
        finalSnakeCells: session.finalSnakeCells,
        moves: session.moves,
        deathReason: session.deathReason,
        endedAt: session.endedAt
      },
      mint: result.mint
    });
  })
);

router.get(
  "/results/:wallet",
  asyncHandler(async (req, res) => {
    const walletAddress = normalizeWallet(req.params.wallet);
    const sessions = (await getLockedResults(walletAddress)).map(serializeSessionResult);

    res.json({
      wallet: walletAddress,
      sessions: sessions.map(serializeResultResponse)
    });
  })
);

router.get(
  "/result/:wallet",
  asyncHandler(async (req, res) => {
    const walletAddress = normalizeWallet(req.params.wallet);
    const session = serializeSessionResult(await getLockedResult(walletAddress));

    res.json(serializeResultResponse(session, walletAddress));
  })
);

router.post(
  "/mint-record",
  asyncHandler(async (req, res) => {
    const input = mintRecordSchema.parse(req.body);
    const mintRecord = await recordMint({
      ...input,
      tokenId: String(input.tokenId)
    });

    res.status(201).json({ mintRecord });
  })
);

export default router;

function serializeResultResponse(session, walletAddress = session.walletAddress) {
  return {
    wallet: walletAddress,
    sessionId: session.id,
    id: session.id,
    status: session.status,
    score: session.score,
    snakeLength: session.snakeLength,
    finalSnakeCells: session.finalSnakeCells,
    moves: session.moves,
    deathReason: session.deathReason,
    replayGifUrl: session.replayGifUrl,
    mintPayloadHash: session.mintPayloadHash,
    mintSignature: session.mintSignature,
    mintedTokenId: session.mintedTokenId,
    txHash: session.txHash
  };
}
