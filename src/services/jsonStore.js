import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

const dataDir = path.join(process.cwd(), ".data");
const dataFile = path.join(dataDir, "snakiox.json");
let writeQueue = Promise.resolve();

const emptyState = {
  users: [],
  sessions: [],
  mintRecords: [],
  inviteCodes: [],
  allowlist: [],
  settings: {
    inviteRequired: true
  }
};

export async function upsertUser(walletAddress) {
  return updateState((state) => {
    let user = state.users.find((item) => item.walletAddress === walletAddress);

    if (!user) {
      const timestamp = now();
      user = {
        id: randomUUID(),
        walletAddress,
        registeredAt: timestamp,
        hasMinted: false,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      state.users.push(user);
    }

    return user;
  });
}

export async function findUser(walletAddress) {
  const state = await readState();
  return state.users.find((user) => user.walletAddress === walletAddress) || null;
}

export async function createInviteCodes({ count, createdBy }) {
  return updateState((state) => {
    const timestamp = now();
    const codes = Array.from({ length: count }, () => ({
      id: randomUUID(),
      code: makeInviteCode(),
      createdBy,
      createdAt: timestamp,
      redeemedBy: null,
      redeemedAt: null,
      mintedBy: null,
      mintedAt: null
    }));

    state.inviteCodes.push(...codes);
    return codes;
  });
}

export async function clearInviteCodes() {
  return updateState((state) => {
    state.inviteCodes = [];
    return [];
  });
}

export async function listInviteCodes() {
  const state = await readState();
  return state.inviteCodes
    .slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function redeemInviteCode({ code, walletAddress }) {
  return updateState((state) => {
    const normalizedCode = normalizeCode(code);
    const invite = state.inviteCodes.find((item) => item.code === normalizedCode);

    if (!invite) {
      const error = new Error("Invite code does not exist");
      error.code = "INVITE_NOT_FOUND";
      throw error;
    }

    if (invite.redeemedBy && invite.redeemedBy !== walletAddress) {
      const error = new Error("Invite code has already been used");
      error.code = "INVITE_USED";
      throw error;
    }

    if (!invite.redeemedBy) {
      invite.redeemedBy = walletAddress;
      invite.redeemedAt = now();
    }

    return invite;
  });
}

export async function findInviteByWallet(walletAddress) {
  const state = await readState();
  return (
    state.inviteCodes.find((invite) => invite.redeemedBy === walletAddress && !invite.mintedBy) ||
    null
  );
}

export async function listAllowlist() {
  const state = await readState();
  return state.allowlist
    .slice()
    .sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
}

export async function addAllowlistWallets({ walletAddresses, addedBy }) {
  return updateState((state) => {
    const added = [];

    for (const walletAddress of walletAddresses) {
      if (state.allowlist.some((entry) => entry.walletAddress === walletAddress)) continue;

      const entry = {
        id: randomUUID(),
        walletAddress,
        addedBy,
        addedAt: now()
      };
      state.allowlist.push(entry);
      added.push(entry);
    }

    return added;
  });
}

export async function removeAllowlistWallet(walletAddress) {
  return updateState((state) => {
    const before = state.allowlist.length;
    state.allowlist = state.allowlist.filter((entry) => entry.walletAddress !== walletAddress);
    return before !== state.allowlist.length;
  });
}

export async function clearAllowlist() {
  return updateState((state) => {
    state.allowlist = [];
    return [];
  });
}

export async function isWalletAllowlisted(walletAddress) {
  const state = await readState();
  return state.allowlist.some((entry) => entry.walletAddress === walletAddress);
}

export async function getSettings() {
  const state = await readState();
  return state.settings;
}

export async function updateSettings(data) {
  return updateState((state) => {
    state.settings = {
      ...state.settings,
      ...data
    };
    return state.settings;
  });
}

export async function markInviteMinted({ walletAddress }) {
  return updateState((state) => {
    const invite = state.inviteCodes.find(
      (item) => item.redeemedBy === walletAddress && !item.mintedBy
    );
    if (!invite) return null;

    invite.mintedBy = walletAddress;
    invite.mintedAt = now();
    return invite;
  });
}

export async function findSessionsByWallet(walletAddress) {
  const state = await readState();
  return state.sessions
    .filter((session) => session.walletAddress === walletAddress)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function findSessionById(id) {
  const state = await readState();
  return state.sessions.find((session) => session.id === id) || null;
}

export async function createSession(walletAddress) {
  return updateState((state) => {
    const timestamp = now();
    const session = {
      id: randomUUID(),
      walletAddress,
      status: "ACTIVE",
      startedAt: timestamp,
      endedAt: null,
      score: null,
      snakeLength: null,
      finalSnakeCells: null,
      moves: null,
      deathReason: null,
      replayGifUrl: null,
      mintPayloadHash: null,
      mintSignature: null,
      mintedTokenId: null,
      txHash: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    state.sessions.push(session);
    return session;
  });
}

export async function updateSession(id, data) {
  return updateState((state) => {
    const session = state.sessions.find((item) => item.id === id);
    if (!session) return null;

    Object.assign(session, data, { updatedAt: now() });
    return session;
  });
}

export async function createMintRecord({
  walletAddress,
  sessionId,
  tokenId,
  txHash,
  consumeInvite = true
}) {
  return updateState((state) => {
    if (state.mintRecords.some((record) => record.sessionId === sessionId)) {
      const error = new Error("Session has already been recorded as minted");
      error.code = "DUPLICATE_SESSION";
      throw error;
    }

    if (state.mintRecords.some((record) => record.txHash === txHash)) {
      const error = new Error("Transaction hash has already been recorded");
      error.code = "DUPLICATE_TX";
      throw error;
    }

    const mintRecord = {
      id: randomUUID(),
      walletAddress,
      tokenId,
      sessionId,
      txHash,
      mintedAt: now()
    };
    state.mintRecords.push(mintRecord);

    const user = state.users.find((item) => item.walletAddress === walletAddress);
    if (user) {
      user.hasMinted = true;
      user.updatedAt = now();
    }

    const session = state.sessions.find((item) => item.id === sessionId);
    if (session) {
      session.status = "MINTED";
      session.mintedTokenId = tokenId;
      session.txHash = txHash;
      session.updatedAt = now();
    }

    if (consumeInvite) {
      const invite = state.inviteCodes.find(
        (item) => item.redeemedBy === walletAddress && !item.mintedBy
      );
      if (invite) {
        invite.mintedBy = walletAddress;
        invite.mintedAt = now();
      }
    }

    return mintRecord;
  });
}

export async function checkStoreHealth() {
  await readState();
  return true;
}

export async function closeStore() {
  await writeQueue;
}

async function readState() {
  try {
    const raw = await readFile(dataFile, "utf8");
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(emptyState);
    throw error;
  }
}

async function updateState(mutator) {
  const operation = writeQueue.then(async () => {
    const state = await readState();
    const result = mutator(state);
    await mkdir(dataDir, { recursive: true });
    await writeFile(dataFile, JSON.stringify(state, null, 2));
    return result;
  });

  writeQueue = operation.catch(() => {});
  return operation;
}

function now() {
  return new Date().toISOString();
}

function normalizeState(state) {
  return {
    ...structuredClone(emptyState),
    ...state,
    inviteCodes: Array.isArray(state.inviteCodes) ? state.inviteCodes : [],
    allowlist: Array.isArray(state.allowlist) ? state.allowlist : [],
    settings: {
      ...emptyState.settings,
      ...(state.settings || {})
    }
  };
}

function normalizeCode(code) {
  return String(code).trim().toUpperCase();
}

function makeInviteCode() {
  return `SNX-${randomBytes(3).toString("hex").toUpperCase()}-${randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}
