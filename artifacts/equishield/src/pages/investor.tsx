import { useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { EQUISHIELD_ADDRESS } from '@/lib/contract';
import EquiShieldABI from '@/abi/EquiShield.json';
import { decryptUint64 } from '@/lib/fhevm';
import { useFhevmStatus } from '@/hooks/useFhevmStatus';
import Layout from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Lock, Unlock, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function InvestorPage() {
  const { address } = useAccount();
  const { toast } = useToast();
  const fheStatus = useFhevmStatus();

  const [decryptedShares, setDecryptedShares] = useState<number | null>(null);
  const [decryptedVested, setDecryptedVested] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);

  // getMyShares() uses msg.sender internally — wagmi passes 'account' as the
  // eth_call 'from' field, so this correctly reads for the connected wallet.
  // The ABI type is bytes32 (euint64 handle); wagmi returns it as 0x${string}.
  const { data: sharesHandle } = useReadContract({
    address: EQUISHIELD_ADDRESS,
    abi: EquiShieldABI,
    functionName: 'getMyShares',
    account: address,
    query: { enabled: !!address },
  });

  const { data: vestedHandle } = useReadContract({
    address: EQUISHIELD_ADDRESS,
    abi: EquiShieldABI,
    functionName: 'getMyVestedShares',
    account: address,
    query: { enabled: !!address },
  });

  async function handleDecrypt() {
    if (!address) return;
    setIsDecrypting(true);
    try {
      // Handles come back from wagmi as 0x-prefixed bytes32 hex strings.
      // decryptUint64 accepts both bigint and hex string.
      const sh = sharesHandle as `0x${string}` | undefined;
      const vh = vestedHandle as `0x${string}` | undefined;

      if (!sh || BigInt(sh) === 0n) {
        toast({
          title: "No shares found",
          description: "This address has no issued shares on-chain.",
          variant: "destructive",
        });
        return;
      }

      const [shares, vested] = await Promise.all([
        decryptUint64(sh, EQUISHIELD_ADDRESS, address),
        vh && BigInt(vh) !== 0n
          ? decryptUint64(vh, EQUISHIELD_ADDRESS, address)
          : Promise.resolve(0n),
      ]);

      setDecryptedShares(Number(shares));
      setDecryptedVested(Number(vested));
      toast({ title: "Decryption Successful" });
    } catch (err: any) {
      toast({ title: "Decryption Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsDecrypting(false);
    }
  }

  const progress = decryptedShares && decryptedVested
    ? Math.min(100, Math.max(0, (decryptedVested / decryptedShares) * 100))
    : 0;

  const unvested = decryptedShares !== null && decryptedVested !== null
    ? decryptedShares - decryptedVested
    : null;

  const decryptDisabled = !address || isDecrypting || fheStatus !== 'ready';

  return (
    <Layout>
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Investor View</h1>
          <p className="text-muted-foreground">Track your encrypted vesting progress securely.</p>
        </div>

        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Vesting Overview</CardTitle>
            <CardDescription>
              Your share counts are encrypted end-to-end. Decrypt to view progress.
              Data is read for the currently connected wallet ({address ? `${address.slice(0, 8)}...${address.slice(-4)}` : 'not connected'}).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {decryptedShares !== null && decryptedVested !== null ? (
              <div className="space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="bg-card border border-border p-4 rounded-md">
                    <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Total Shares</div>
                    <div className="text-2xl font-mono font-bold text-foreground">{decryptedShares.toLocaleString()}</div>
                  </div>
                  <div className="bg-card border border-border p-4 rounded-md">
                    <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Vested</div>
                    <div className="text-2xl font-mono font-bold text-primary">{decryptedVested.toLocaleString()}</div>
                  </div>
                  <div className="bg-card border border-border p-4 rounded-md">
                    <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Unvested</div>
                    <div className="text-2xl font-mono font-bold text-muted-foreground">{unvested!.toLocaleString()}</div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-sm font-medium">
                    <span>Vesting Progress</span>
                    <span className="font-mono">{progress.toFixed(1)}%</span>
                  </div>
                  <Progress value={progress} className="h-3" />
                </div>

                <Button variant="outline" className="w-full"
                  onClick={() => { setDecryptedShares(null); setDecryptedVested(null); }}>
                  <Lock className="mr-2 h-4 w-4" /> Re-encrypt View
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-12 border border-border/50 rounded-lg bg-background/50">
                <Lock className="w-12 h-12 text-primary/50 mb-4" />
                <h3 className="text-lg font-medium mb-2">Data Encrypted</h3>
                <p className="text-muted-foreground text-center mb-6 max-w-sm">
                  Your vesting schedule and total shares are currently hidden using Fully Homomorphic Encryption.
                </p>
                {!address ? (
                  <p className="text-sm text-muted-foreground">Connect wallet to decrypt</p>
                ) : (
                  <Button onClick={handleDecrypt} disabled={decryptDisabled}>
                    {isDecrypting
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Decrypting...</>
                      : fheStatus !== 'ready'
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> FHE Initializing...</>
                      : <><Unlock className="mr-2 h-4 w-4" /> Decrypt Records</>
                    }
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
