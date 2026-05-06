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
// gatewayUrl is required so fhevmjs can fetch the FHE public key for encryption.
const _initPromise: Promise<void> = (async () => {
  try {
    console.log("[fhevmjs] Initializing FHE instance for Sepolia...");
    fhevmInstance = await createInstance({
      chainId: 11155111,
      networkUrl: SEPOLIA_RPC,
      gatewayUrl: "https://gateway.sepolia.zama.ai",
    });
    console.log("[fhevmjs] FHE instance created successfully, public key fetched");
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
 * Encrypt a single uint64 value for a specific contract + user address pair.
 * Returns { handle, proof } ready to pass to contract write functions.
 */
export async function encryptUint64(
  value: bigint,
  contractAddress: string,
  userAddress: string
): Promise<{ handle: `0x${string}`; proof: `0x${string}` }> {
  try {
    const instance = await getFhevmInstance();
    const input = instance.createEncryptedInput(contractAddress, userAddress);
    input.add64(value);
    const result = await input.encrypt();
    return {
      handle: result.handles[0] as `0x${string}`,
      proof: `0x${Buffer.from(result.inputProof).toString("hex")}` as `0x${string}`,
    };
  } catch (err) {
    console.error("[fhevmjs] encryptUint64 failed — value:", value.toString(), "contract:", contractAddress, "user:", userAddress, "error:", err);
    throw err;
  }
}

/**
 * Encrypt TWO uint64 values in a single FHE input — produces two handles
 * that share one proof. Use this for issueShares(shares, price) so both
 * ciphertexts are covered by the same ZK proof.
 *
 * Returns { handle0, handle1, proof }
 */
export async function encryptTwoUint64(
  value0: bigint,
  value1: bigint,
  contractAddress: string,
  userAddress: string
): Promise<{ handle0: `0x${string}`; handle1: `0x${string}`; proof: `0x${string}` }> {
  try {
    const instance = await getFhevmInstance();
    const input = instance.createEncryptedInput(contractAddress, userAddress);
    input.add64(value0);
    input.add64(value1);
    const result = await input.encrypt();
    const proof = `0x${Buffer.from(result.inputProof).toString("hex")}` as `0x${string}`;
    return {
      handle0: result.handles[0] as `0x${string}`,
      handle1: result.handles[1] as `0x${string}`,
      proof,
    };
  } catch (err) {
    console.error("[fhevmjs] encryptTwoUint64 failed — values:", value0.toString(), value1.toString(), "contract:", contractAddress, "user:", userAddress, "error:", err);
    throw err;
  }
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
  try {
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
  } catch (err) {
    console.error("[fhevmjs] decryptUint64 failed — handle:", handle.toString(), "contract:", contractAddress, "user:", userAddress, "error:", err);
    throw err;
  }
}
