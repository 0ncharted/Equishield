/**
 * fhevmjs client-side FHE encryption utilities.
 *
 * Initializes eagerly on module load so the instance is ready before any
 * button is clicked. Exposes a status listener so the UI can reflect state.
 */
import { createInstance, type FhevmInstance } from "fhevmjs/bundle";

export type FhevmStatus = "initializing" | "ready" | "error";

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
// Only chainId + networkUrl are needed to fetch the FHE public key.
const _initPromise: Promise<void> = (async () => {
  try {
    fhevmInstance = await createInstance({
      chainId: 11155111,
      networkUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    });
    setStatus("ready");
  } catch (err) {
    console.error("[fhevmjs] init failed:", err);
    setStatus("error");
  }
})();

export async function getFhevmInstance(): Promise<FhevmInstance> {
  await _initPromise;
  if (!fhevmInstance) throw new Error("FHE instance failed to initialize");
  return fhevmInstance;
}

/**
 * Encrypt a uint64 value for a specific contract + user address pair.
 * Returns { handle, proof } ready to pass to contract write functions.
 */
export async function encryptUint64(
  value: bigint,
  contractAddress: string,
  userAddress: string
): Promise<{ handle: `0x${string}`; proof: `0x${string}` }> {
  const instance = await getFhevmInstance();
  const input = instance.createEncryptedInput(contractAddress, userAddress);
  input.add64(value);
  const result = await input.encrypt();
  return {
    handle: result.handles[0] as `0x${string}`,
    proof: `0x${Buffer.from(result.inputProof).toString("hex")}` as `0x${string}`,
  };
}

/**
 * Decrypt a euint64 handle via Zama Gateway re-encryption.
 * Requires the caller to have been granted FHE.allow() access on-chain.
 * Prompts the user to sign an EIP-712 reencryption request.
 */
export async function decryptUint64(
  handle: bigint,
  contractAddress: string,
  userAddress: string
): Promise<bigint> {
  if (!handle || handle === 0n) throw new Error("No shares found for this address");
  const instance = await getFhevmInstance();

  const { publicKey, privateKey } = instance.generateKeypair();
  const eip712 = instance.createEIP712(publicKey, contractAddress);

  const signature = await (window as any).ethereum.request({
    method: "eth_signTypedData_v4",
    params: [userAddress, JSON.stringify(eip712)],
  });

  return await instance.reencrypt(
    handle,
    privateKey,
    publicKey,
    signature as string,
    contractAddress,
    userAddress
  );
}
