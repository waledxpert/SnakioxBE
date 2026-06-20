import { env } from "../config/env.js";
import {
  buildMintPayload,
  normalizeWallet,
  signMintPayload
} from "./signatureService.js";
import {
  createMintRecord,
  createSession,
  findInviteByWallet,
  findSessionById,
  findSessionsByWallet,
  findUser,
  getSettings,
  isWalletAllowlisted,
  updateSession
} from "./store.js";
import { badRequest, conflict, forbidden, notFound } from "../utils/errors.js";

const maxMintsPerWallet = 3;

export async function getGameStatus(wallet) {
  const walletAddress = normalizeWallet(wallet);
  const user = await findUser(walletAddress);

  if (!user) {
    return {
      registered: false,
      canPlay: false,
      hasCompletedGame: false,
      hasMinted: false,
      reason: "Wallet is not registered"
    };
  }

  const sessions = await findSessionsByWallet(walletAddress);
  const invite = await findInviteByWallet(walletAddress);
  const isAllowlisted = await isWalletAllowlisted(walletAddress);
  const settings = await getSettings();
  const latestSession = sessions[0] || null;
  const mintedCount = sessions.filter((session) => session.status === "MINTED").length;
  const hasCompletedGame = latestSession?.status === "COMPLETED";
  const hasActiveGame = latestSession?.status === "ACTIVE";
  const hasInviteAccess = isAllowlisted || !settings.inviteRequired || Boolean(invite);
  const remainingMints = Math.max(maxMintsPerWallet - mintedCount, 0);
  const canPlay =
    hasInviteAccess && remainingMints > 0 && !hasCompletedGame && !hasActiveGame;

  return {
    registered: true,
    inviteRequired: settings.inviteRequired,
    isAllowlisted,
    hasInvite: Boolean(invite),
    inviteCode: invite?.code || null,
    canPlay,
    hasCompletedGame,
    hasMinted: mintedCount > 0,
    mintedCount,
    maxMintsPerWallet,
    remainingMints,
    activeSessionId: hasActiveGame ? latestSession.id : null,
    completedSessionId: hasCompletedGame ? latestSession.id : null,
    reason: canPlay
      ? null
      : getBlockedReason({
          hasInviteAccess,
          remainingMints,
          latestSession,
          hasActiveGame,
          hasCompletedGame
        })
  };
}

export async function startGame(wallet) {
  const walletAddress = normalizeWallet(wallet);
  const user = await findUser(walletAddress);

  if (!user) {
    throw forbidden("Wallet must be registered before starting a game");
  }

  const invite = await findInviteByWallet(walletAddress);
  const isAllowlisted = await isWalletAllowlisted(walletAddress);
  const settings = await getSettings();
  if (settings.inviteRequired && !invite && !isAllowlisted) {
    throw forbidden("Wallet must redeem an invite code before starting a game");
  }

  const sessions = await findSessionsByWallet(walletAddress);
  const mintedCount = sessions.filter((session) => session.status === "MINTED").length;
  if (mintedCount >= maxMintsPerWallet) {
    throw conflict("Wallet mint limit reached");
  }

  const existingSession = sessions.find((session) =>
    ["ACTIVE", "COMPLETED"].includes(session.status)
  );

  if (existingSession?.status === "ACTIVE") {
    return existingSession;
  }

  if (existingSession) {
    throw conflict("Wallet has a locked game result waiting to be minted");
  }

  try {
    return await createSession(walletAddress);
  } catch (error) {
    if (error.code === "PENDING_SESSION") {
      throw conflict(error.message);
    }
    throw error;
  }
}

export async function completeGame(input) {
  const walletAddress = normalizeWallet(input.wallet);
  const session = await findSessionById(input.sessionId);

  if (!session) {
    throw notFound("Game session not found");
  }

  if (session.walletAddress !== walletAddress) {
    throw forbidden("Game session does not belong to this wallet");
  }

  if (session.status !== "ACTIVE") {
    throw conflict("Game session has already been completed");
  }

  validateGameResult({
    startedAt: new Date(session.startedAt),
    score: input.score,
    snakeLength: input.snakeLength,
    finalSnakeCells: input.finalSnakeCells,
    moves: input.moves
  });

  const payload = buildMintPayload({
    wallet: walletAddress,
    sessionId: session.id,
    score: input.score,
    snakeLength: input.snakeLength,
    finalSnakeCells: input.finalSnakeCells
  });
  const signature = await signMintPayload(payload);

  const updatedSession = await updateSession(session.id, {
      status: "COMPLETED",
      endedAt: new Date().toISOString(),
      score: input.score,
      snakeLength: input.snakeLength,
      finalSnakeCells: JSON.stringify(input.finalSnakeCells),
      moves: JSON.stringify(input.moves),
      deathReason: input.deathReason,
      mintPayloadHash: payload.payloadHash,
      mintSignature: signature
  });

  return {
    session: updatedSession,
    mint: {
      ...payload,
      signature
    }
  };
}

export async function getLockedResult(wallet) {
  const walletAddress = normalizeWallet(wallet);
  const session = (await findSessionsByWallet(walletAddress))
    .filter((item) => ["COMPLETED", "MINTED"].includes(item.status))
    .sort((a, b) => new Date(b.endedAt || b.updatedAt) - new Date(a.endedAt || a.updatedAt))[0];

  if (!session) {
    throw notFound("No locked game result found for this wallet");
  }

  return session;
}

export async function getLockedResults(wallet) {
  const walletAddress = normalizeWallet(wallet);
  const sessions = (await findSessionsByWallet(walletAddress))
    .filter((item) => ["COMPLETED", "MINTED"].includes(item.status))
    .sort((a, b) => new Date(b.endedAt || b.updatedAt) - new Date(a.endedAt || a.updatedAt));

  return sessions;
}

export function serializeSessionResult(session) {
  return {
    ...session,
    finalSnakeCells: parseJsonField(session.finalSnakeCells, []),
    moves: parseJsonField(session.moves, [])
  };
}

export async function recordMint({ wallet, sessionId, tokenId, txHash }) {
  const walletAddress = normalizeWallet(wallet);
  const session = await findSessionById(sessionId);

  if (!session) {
    throw notFound("Game session not found");
  }

  if (session.walletAddress !== walletAddress) {
    throw forbidden("Game session does not belong to this wallet");
  }

  if (session.status !== "COMPLETED") {
    throw conflict("Only completed sessions can be marked as minted");
  }

  const invite = await findInviteByWallet(walletAddress);
  const isAllowlisted = await isWalletAllowlisted(walletAddress);
  const settings = await getSettings();
  if (settings.inviteRequired && !invite && !isAllowlisted) {
    throw forbidden("Wallet must redeem an invite code before minting");
  }

  if (invite?.mintedBy && invite.mintedBy !== walletAddress) {
    throw conflict("Invite code has already been used to mint");
  }

  const mintedCount = (await findSessionsByWallet(walletAddress)).filter(
    (item) => item.status === "MINTED"
  ).length;
  if (mintedCount >= maxMintsPerWallet) {
    throw conflict("Wallet mint limit reached");
  }

  try {
    return await createMintRecord({
      walletAddress,
      sessionId,
      tokenId,
      txHash,
      consumeInvite: !isAllowlisted
    });
  } catch (error) {
    if (
      error.code === "DUPLICATE_SESSION" ||
      error.code === "DUPLICATE_TX" ||
      error.code === "WALLET_LIMIT"
    ) {
      throw conflict(error.message);
    }
    throw error;
  }
}

export async function saveReplay({ wallet, sessionId, replayURI }) {
  const walletAddress = normalizeWallet(wallet);
  const session = await findSessionById(sessionId);

  if (!session) {
    throw notFound("Game session not found");
  }

  if (session.walletAddress !== walletAddress) {
    throw forbidden("Game session does not belong to this wallet");
  }

  if (!["COMPLETED", "MINTED"].includes(session.status)) {
    throw conflict("Replay can only be saved after the game result is locked");
  }

  if (session.replayGifUrl) {
    throw conflict("Replay has already been saved");
  }

  return updateSession(sessionId, { replayGifUrl: replayURI });
}

function validateGameResult({ startedAt, score, snakeLength, finalSnakeCells, moves }) {
  if (!Array.isArray(finalSnakeCells) || finalSnakeCells.length === 0) {
    throw badRequest("finalSnakeCells must be a non-empty array");
  }

  if (!Array.isArray(moves) || moves.length === 0) {
    throw badRequest("moves must be a non-empty array");
  }

  if (snakeLength !== finalSnakeCells.length) {
    throw badRequest("snakeLength must match finalSnakeCells length");
  }

  const durationSeconds = (Date.now() - startedAt.getTime()) / 1000;
  if (durationSeconds > env.maxGameDurationSeconds) {
    throw badRequest("Game duration is too long");
  }

  if (moves.length / Math.max(durationSeconds, 1) > 1 / env.minSecondsPerMove) {
    throwBotDetected();
  }

  const occupied = new Set();
  for (const cell of finalSnakeCells) {
    if (!Number.isInteger(cell?.x) || !Number.isInteger(cell?.y)) {
      throw badRequest("Each final snake cell must include integer x and y values");
    }

    const key = `${cell.x}:${cell.y}`;
    if (occupied.has(key)) {
      throw badRequest("finalSnakeCells contains duplicate body cells");
    }
    occupied.add(key);
  }

  let previousTick = -1;
  let previousAtMs = -1;
  let impossibleBurstCount = 0;

  for (const move of moves) {
    if (!["UP", "DOWN", "LEFT", "RIGHT"].includes(move.direction)) {
      throw badRequest("moves can only include UP, DOWN, LEFT, or RIGHT directions");
    }

    if (typeof move.tick === "number") {
      if (move.tick < previousTick) throwBotDetected();
      if (move.tick === previousTick) impossibleBurstCount += 1;
      previousTick = move.tick;
    }

    if (typeof move.atMs === "number") {
      if (move.atMs < previousAtMs) throwBotDetected();
      if (previousAtMs >= 0 && move.atMs - previousAtMs < env.minSecondsPerMove * 1000) {
        impossibleBurstCount += 1;
      }
      previousAtMs = move.atMs;
    }

    if (impossibleBurstCount > 12) throwBotDetected();
  }

  if (score < 0 || snakeLength < 1) {
    throw badRequest("score and snakeLength values are out of range");
  }
}

function throwBotDetected() {
  throw badRequest("Bot activities detected");
}

function getBlockedReason({
  hasInviteAccess,
  remainingMints,
  latestSession,
  hasActiveGame,
  hasCompletedGame
}) {
  if (!hasInviteAccess) return "Wallet needs an invite code";
  if (remainingMints <= 0) return "Wallet mint limit reached";
  if (hasActiveGame) return "Game session is already active";
  if (hasCompletedGame) return "Game result must be minted before starting another run";
  if (latestSession?.status === "EXPIRED") return "Previous game session expired";
  return "Wallet cannot play";
}

function parseJsonField(value, fallback) {
  if (!value) return fallback;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
