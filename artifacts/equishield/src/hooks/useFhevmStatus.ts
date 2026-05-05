import { useState, useEffect } from "react";
import { getFhevmStatus, onFhevmStatusChange, type FhevmStatus } from "@/lib/fhevm";

export function useFhevmStatus(): FhevmStatus {
  const [status, setStatus] = useState<FhevmStatus>(getFhevmStatus);
  useEffect(() => onFhevmStatusChange(setStatus), []);
  return status;
}
