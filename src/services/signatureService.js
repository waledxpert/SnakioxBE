import { ethers } from "ethers";
import { env } from "../config/env.js";
import { badRequest } from "../utils/errors.js";

const registerPrefix = "Register for Snakiox with wallet";

export function normalizeWallet(wallet) {
  return ethers.getAddress(wallet);
}

export function getRegistrationMessage(wallet) {
  return `${registerPrefix} ${normalizeWallet(wallet)}`;
}

export function verifyRegistrationSignature(wallet, signature) {
  const normalizedWallet = normalizeWallet(wallet);
  const recovered = ethers.verifyMessage(
    getRegistrationMessage(normalizedWallet),
    signature
  );

  return normalizeWallet(recovered) === normalizedWallet;
}

export function getGameSignerAddress() {
  return getGameSigner().address;
}

export function buildMintPayload({
  wallet,
  sessionId,
  score,
  snakeLength,
  finalSnakeCells
}) {
  const normalizedWallet = normalizeWallet(wallet);
  const snakeData = ethers.toUtf8Bytes(JSON.stringify(finalSnakeCells));
  const snakeDataHash = ethers.keccak256(snakeData);

  const payloadHash = ethers.solidityPackedKeccak256(
    ["address", "bytes32", "bytes32", "uint256", "uint256", "address", "uint256"],
    [
      normalizedWallet,
      ethers.id(sessionId),
      snakeDataHash,
      BigInt(score),
      BigInt(snakeLength),
      env.mintContractAddress,
      env.chainId
    ]
  );

  return {
    wallet: normalizedWallet,
    sessionId,
    sessionHash: ethers.id(sessionId),
    snakeData: ethers.hexlify(snakeData),
    snakeDataHash,
    score,
    snakeLength,
    contractAddress: env.mintContractAddress,
    chainId: env.chainId.toString(),
    payloadHash
  };
}

export async function signMintPayload(payload) {
  const signer = getGameSigner();
  return signer.signMessage(ethers.getBytes(payload.payloadHash));
}

function getGameSigner() {
  if (!env.gameSignerPrivateKey || /^0x0+$/.test(env.gameSignerPrivateKey)) {
    throw badRequest("GAME_SIGNER_PRIVATE_KEY must be configured");
  }

  return new ethers.Wallet(env.gameSignerPrivateKey);
}
