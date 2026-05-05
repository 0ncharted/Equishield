/**
 * fhevmjs client-side FHE encryption utilities.
 *
 * All share counts and prices must be encrypted client-side before sending
 * to the EquiShield contract. This module wraps fhevmjs instance creation
 * and provides helpers for generating encrypted inputs with ZK proofs.
 */
import { createInstance, type FhevmInstance } from "fhevmjs/bundle";

let fhevmInstance: FhevmInstance | null = null;
let initPromise: Promise<FhevmInstance> | null = null;

/**
 * Returns a singleton fhevmjs instance for Sepolia (Zama gateway).
 * Safe to call multiple times — only creates the instance once.
 */
export async function getFhevmInstance(): Promise<FhevmInstance> {
  if (fhevmInstance) return fhevmInstance;
  if (initPromise) return initPromise;

  initPromise = createInstance({
    kmsContractAddress: "0x9D6891A6240D6130c54ae243d8005063D05fE14b",
    aclContractAddress: "0xFee8407e2f5e3Ee68ad77cAE98c434e637f516EC",
    network: window.ethereum,
    gatewayUrl: "https://gateway.zama.ai",
    chainId: 11155111,
  }).then((instance) => {
    fhevmInstance = instance;
    initPromise = null;
    return instance;
  });

  return initPromise;
}

/**
 * Encrypt a uint64 value for a specific contract address.
 * Returns { handle, proof } ready to pass to contract functions.
 */
export async function encryptUint64(
  value: bigint,
  contractAddress: string,
  userAddress: string
): Promise<{ handle: `0x${string}`; proof: `0x${string}` }> {
  const instance = await getFhevmInstance();
  const encrypted = await instance.createEncryptedInput(contractAddress, userAddress);
  encrypted.add64(value);
  const result = await encrypted.encrypt();
  return {
    handle: result.handles[0] as `0x${string}`,
    proof: `0x${Buffer.from(result.inputProof).toString("hex")}` as `0x${string}`,
  };
}

/**
 * Decrypt a euint64 handle returned from the contract.
 * The caller must have been granted FHE.allow() access to this handle.
 */
export async function decryptUint64(
  handle: bigint,
  contractAddress: string,
  userAddress: string,
  provider: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
): Promise<bigint> {
  const instance = await getFhevmInstance();
  const reEncrypted = await instance.reencrypt(
    handle,
    userAddress,
    contractAddress,
    undefined,
    { request: provider.request }
  );
  return reEncrypted;
}
