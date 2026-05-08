/**
 * FHE encryption utilities using @zama-fhe/relayer-sdk.
 *
 * Imports the real browser ES module bundle (aliased in vite.config.ts).
 * Calls initSDK() to load WASM, then createInstance() with the correct
 * Zama Sepolia testnet addresses and relayer URL.
 */
import { initSDK, createInstance } from "@zama-fhe/relayer-sdk/bundle";
import type { FhevmInstance } from "@zama-fhe/relayer-sdk/bundle";

export type FhevmStatus = "initializing" | "ready" | "error";

/** Convert a Uint8Array to a lowercase hex string — browser-safe, no Buffer needed. */
function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * JSON.stringify replacer that serializes BigInt values as decimal strings.
 * Required when stringifying EIP-712 objects — the domain chainId is a BigInt
 * in some SDK versions, and JSON.stringify throws on raw BigInt values.
 */
function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/** Normalize a handle (bigint or 0x-prefixed bytes32 hex) to a padded 32-byte hex string. */
function normalizeHandle(handle: bigint | `0x${string}`): `0x${string}` {
  const big = typeof handle === "bigint" ? handle : BigInt(handle as string);
  return `0x${big.toString(16).padStart(64, "0")}` as `0x${string}`;
}

// Zama Sepolia testnet config — matches @zama-fhe/relayer-sdk SepoliaConfigV1
const ACL_CONTRACT            = "0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D";
const KMS_CONTRACT            = "0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A";
const INPUT_VERIFIER_CONTRACT = "0xBBC1fFCdc7C316aAAd72E807D9b0272BE8F84DA0";
const VERIFYING_DECRYPTION    = "0x5D8BD78e2ea6bbE41f26dFe9fdaEAa349e077478";
const VERIFYING_INPUT_VERIFY  = "0x483b9dE06E4E4C7D35CCf5837A1668487406D955";
// Base relayer URL — no version suffix; relayerRouteVersion tells the SDK which path to use.
// /v1/keyurl → 404, /v2/keyurl → 200 (verified 2026-05-06)
const RELAYER_URL             = "https://relayer.testnet.zama.org";
const CHAIN_ID                = 11155111;
const GATEWAY_CHAIN_ID        = 10901;

const SEPOLIA_RPC = (import.meta as any).env?.VITE_INFURA_API_KEY
  ? `https://sepolia.infura.io/v3/${(import.meta as any).env.VITE_INFURA_API_KEY}`
  : "https://ethereum-sepolia-rpc.publicnode.com";

let fhevmInstance: FhevmInstance | null = null;
let fhevmStatus: FhevmStatus = "initializing";
const statusListeners: Set<(s: FhevmStatus) => void> = new Set();

function setStatus(s: FhevmStatus) {
  fhevmStatus = s;
  statusListeners.forEach((fn) => fn(s));
}

export function getFhevmStatus(): FhevmStatus {
  return fhevmStatus;
}

export function onFhevmStatusChange(fn: (s: FhevmStatus) => void): () => void {
  statusListeners.add(fn);
  fn(fhevmStatus);
  return () => statusListeners.delete(fn);
}

// Eager singleton initialization — runs once when the module is imported.
// 1. initSDK() loads the TFHE WASM module
// 2. createInstance() fetches the FHE public key + CRS from the Zama relayer
const _initPromise: Promise<void> = (async () => {
  try {
    console.log("[fhevmjs] Loading WASM via initSDK (single-threaded mode)...");
    // thread: 0 disables SharedArrayBuffer threading — works without COOP/COEP headers
    await (initSDK as any)({ thread: 0 });
    console.log("[fhevmjs] WASM loaded. Creating FHE instance for Sepolia...");
    fhevmInstance = await createInstance({
      aclContractAddress:                       ACL_CONTRACT,
      kmsContractAddress:                       KMS_CONTRACT,
      inputVerifierContractAddress:             INPUT_VERIFIER_CONTRACT,
      verifyingContractAddressDecryption:       VERIFYING_DECRYPTION,
      verifyingContractAddressInputVerification: VERIFYING_INPUT_VERIFY,
      chainId:             CHAIN_ID,
      gatewayChainId:      GATEWAY_CHAIN_ID,
      relayerUrl:          RELAYER_URL,
      relayerRouteVersion: 2,
      network:             SEPOLIA_RPC,
    } as any);
    if (!fhevmInstance) throw new Error("createInstance returned null/undefined");
    console.log("[fhevmjs] FHE instance created successfully — public key fetched from relayer");
    setStatus("ready");
  } catch (err) {
    const msg  = (err as any)?.message ?? String(err);
    const name = (err as any)?.name ?? typeof err;
    console.error("[fhevmjs] init FAILED — name:", name, "message:", msg);
    console.error("[fhevmjs] full error:", err);
    setStatus("error");
  }
})();

export async function getFhevmInstance(): Promise<FhevmInstance> {
  await _initPromise;
  if (!fhevmInstance) throw new Error("FHE instance failed to initialize — check console for details");
  return fhevmInstance;
}

/**
 * Encrypt a single uint64 value for a specific contract + user address pair.
 * Returns { handle, proof } as 0x-prefixed hex strings ready for contract calls.
 */
export async function encryptUint64(
  value: bigint,
  contractAddress: string,
  userAddress: string
): Promise<{ handle: `0x${string}`; proof: `0x${string}` }> {
  try {
    console.log("[fhevmjs] encryptUint64 — value:", value.toString(), "contract:", contractAddress);
    const instance = await getFhevmInstance();
    const input = instance.createEncryptedInput(contractAddress, userAddress);
    (input as any).add64(value);
    const result = await (input as any).encrypt();
    const handle = `0x${uint8ArrayToHex(result.handles[0])}` as `0x${string}`;
    const proof  = `0x${uint8ArrayToHex(result.inputProof)}` as `0x${string}`;
    console.log("[fhevmjs] encryptUint64 success — handle:", handle.slice(0, 18) + "...");
    return { handle, proof };
  } catch (err) {
    const msg = (err as any)?.message ?? String(err);
    console.error("[fhevmjs] encryptUint64 FAILED — message:", msg, "raw:", err);
    throw err;
  }
}

/**
 * Encrypt TWO uint64 values in a single FHE input — produces two handles
 * that share one proof. Use this for issueShares(shares, price) so both
 * ciphertexts are covered by the same ZK proof.
 */
export async function encryptTwoUint64(
  value0: bigint,
  value1: bigint,
  contractAddress: string,
  userAddress: string
): Promise<{ handle0: `0x${string}`; handle1: `0x${string}`; proof: `0x${string}` }> {
  try {
    console.log("[fhevmjs] encryptTwoUint64 — values:", value0.toString(), value1.toString());
    const instance = await getFhevmInstance();
    const input = instance.createEncryptedInput(contractAddress, userAddress);
    (input as any).add64(value0);
    (input as any).add64(value1);
    const result = await (input as any).encrypt();
    const handle0 = `0x${uint8ArrayToHex(result.handles[0])}` as `0x${string}`;
    const handle1 = `0x${uint8ArrayToHex(result.handles[1])}` as `0x${string}`;
    const proof   = `0x${uint8ArrayToHex(result.inputProof)}` as `0x${string}`;
    console.log("[fhevmjs] encryptTwoUint64 success — handle0:", handle0.slice(0, 18) + "...");
    return { handle0, handle1, proof };
  } catch (err) {
    const msg = (err as any)?.message ?? String(err);
    console.error("[fhevmjs] encryptTwoUint64 FAILED — message:", msg, "raw:", err);
    throw err;
  }
}

/**
 * Decrypt a SINGLE euint64 handle via one userDecrypt call (one wallet signature).
 *
 * Key facts about the SDK:
 * - ClearValueType = bigint | boolean | 0x${string}
 *   results[handleHex] IS the clear value — NOT an object with a .value property.
 * - HandleContractPair.handle = Uint8Array | string (accepts 0x-prefixed hex strings)
 * - userDecrypt() takes a handles array; each handle gets its result keyed by its hex
 *
 * @param handle - euint64 handle as bigint OR 0x-prefixed bytes32 hex (wagmi's format)
 */
export async function decryptUint64(
  handle: bigint | `0x${string}`,
  contractAddress: string,
  userAddress: string
): Promise<bigint> {
  if (handle === undefined || handle === null) {
    throw new Error("Handle is undefined — share data may still be loading");
  }

  const handleHex = normalizeHandle(handle);
  const handleBigint = BigInt(handleHex);
  if (handleBigint === 0n) throw new Error("No shares found for this address");

  try {
    const instance = await getFhevmInstance();
    const { publicKey, privateKey } = instance.generateKeypair() as any;
    const startTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 min ago
    const durationDays   = 1;

    const eip712 = instance.createEIP712(publicKey, [contractAddress], startTimestamp, durationDays);

    // JSON.stringify with BigInt replacer — the EIP-712 domain chainId may be BigInt
    const signature = await (window as any).ethereum.request({
      method: "eth_signTypedData_v4",
      params: [userAddress, JSON.stringify(eip712, bigIntReplacer)],
    });

    console.log("[fhevmjs] userDecrypt — handle:", handleHex.slice(0, 18) + "...");
    const results = await (instance as any).userDecrypt(
      [{ handle: handleHex, contractAddress }],
      privateKey,
      publicKey,
      signature as string,
      [contractAddress],
      userAddress,
      startTimestamp,
      durationDays,
    );

    // ClearValues = Record<0x${string}, ClearValueType>
    // ClearValueType = bigint | boolean | 0x${string}
    // results[handleHex] IS the clear value directly — NOT { value: ... }
    const clearValue = (results as Record<string, unknown>)[handleHex];
    if (clearValue === undefined || clearValue === null) {
      throw new Error("Relayer returned no value for handle " + handleHex + ". Ensure FHE.allow() was called for this address.");
    }

    console.log("[fhevmjs] userDecrypt success — clearValue type:", typeof clearValue);
    return BigInt(clearValue as bigint);
  } catch (err) {
    const msg = (err as any)?.message ?? String(err);
    console.error("[fhevmjs] decryptUint64 FAILED — message:", msg, "raw:", err);
    throw err;
  }
}

/**
 * Decrypt MULTIPLE euint64 handles in a single userDecrypt call — ONE wallet signature.
 *
 * Use this when you need to decrypt more than one handle for the same user to avoid
 * prompting multiple wallet signatures. All handles share the same EIP-712 request.
 *
 * Returns an array of decrypted bigints in the same order as the input handles.
 * Handles with value 0n are returned as 0n without being included in the RPC call.
 *
 * @param handlePairs - array of { handle, contractAddress } to decrypt
 * @param userAddress - the connected wallet address (must own the handles via FHE.allow)
 */
export async function decryptMultipleUint64(
  handlePairs: Array<{ handle: bigint | `0x${string}`; contractAddress: string }>,
  userAddress: string
): Promise<bigint[]> {
  if (!handlePairs.length) return [];

  // Normalise all handles and filter out zero handles
  const normalised = handlePairs.map((pair) => ({
    hexHandle: normalizeHandle(pair.handle),
    contractAddress: pair.contractAddress,
    isZero: BigInt(normalizeHandle(pair.handle)) === 0n,
  }));

  // Only send non-zero handles to the relayer
  const nonZero = normalised.filter((h) => !h.isZero);

  if (!nonZero.length) {
    // All handles are zero — nothing to decrypt
    return normalised.map(() => 0n);
  }

  try {
    const instance = await getFhevmInstance();
    const { publicKey, privateKey } = instance.generateKeypair() as any;
    const startTimestamp = Math.floor(Date.now() / 1000) - 600;
    const durationDays   = 1;

    // contractAddresses for EIP-712 must include all unique contracts
    const contractAddresses = [...new Set(nonZero.map((h) => h.contractAddress))];

    const eip712 = instance.createEIP712(publicKey, contractAddresses, startTimestamp, durationDays);

    // ONE signature for all handles
    const signature = await (window as any).ethereum.request({
      method: "eth_signTypedData_v4",
      params: [userAddress, JSON.stringify(eip712, bigIntReplacer)],
    });

    console.log("[fhevmjs] decryptMultipleUint64 — handles:", nonZero.length,
      nonZero.map((h) => h.hexHandle.slice(0, 14) + "..."));

    const results = await (instance as any).userDecrypt(
      nonZero.map((h) => ({ handle: h.hexHandle, contractAddress: h.contractAddress })),
      privateKey,
      publicKey,
      signature as string,
      contractAddresses,
      userAddress,
      startTimestamp,
      durationDays,
    );

    // Map results back to the original input order
    return normalised.map((h) => {
      if (h.isZero) return 0n;
      const clearValue = (results as Record<string, unknown>)[h.hexHandle];
      if (clearValue === undefined || clearValue === null) {
        throw new Error("Relayer returned no value for handle " + h.hexHandle);
      }
      return BigInt(clearValue as bigint);
    });
  } catch (err) {
    const msg = (err as any)?.message ?? String(err);
    console.error("[fhevmjs] decryptMultipleUint64 FAILED — message:", msg, "raw:", err);
    throw err;
  }
}
