import { useState, useEffect } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { EQUISHIELD_ADDRESS } from '@/lib/contract';
import EquiShieldABI from '@/abi/EquiShield.json';
import { decryptUint64 } from '@/lib/fhevm';
import Layout from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Lock, Unlock, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function InvestorPage() {
  const { address } = useAccount();
  const { toast } = useToast();
  
  const [decryptedShares, setDecryptedShares] = useState<number | null>(null);
  const [decryptedVested, setDecryptedVested] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);

  const { data: sharesHandle } = useReadContract({
    address: EQUISHIELD_ADDRESS,
    abi: EquiShieldABI,
    functionName: 'getMyShares',
    account: address,
  });

  const { data: vestedHandle } = useReadContract({
    address: EQUISHIELD_ADDRESS,
    abi: EquiShieldABI,
    functionName: 'getMyVestedShares',
    account: address,
  });

  async function handleDecrypt() {
    if (!address || !sharesHandle || !vestedHandle || !window.ethereum) return;
    setIsDecrypting(true);
    try {
      const shares = await decryptUint64(sharesHandle as bigint, EQUISHIELD_ADDRESS, address, window.ethereum);
      const vested = await decryptUint64(vestedHandle as bigint, EQUISHIELD_ADDRESS, address, window.ethereum);
      
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
            <CardDescription>Your share counts are encrypted end-to-end. Decrypt to view progress.</CardDescription>
          </CardHeader>
          <CardContent>
            {decryptedShares !== null && decryptedVested !== null ? (
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-card border border-border p-4 rounded-md">
                    <div className="text-sm text-muted-foreground uppercase tracking-widest mb-1">Total Granted</div>
                    <div className="text-3xl font-mono font-bold text-foreground">{decryptedShares.toLocaleString()}</div>
                  </div>
                  <div className="bg-card border border-border p-4 rounded-md">
                    <div className="text-sm text-muted-foreground uppercase tracking-widest mb-1">Vested</div>
                    <div className="text-3xl font-mono font-bold text-primary">{decryptedVested.toLocaleString()}</div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex justify-between text-sm font-medium">
                    <span>Vesting Progress</span>
                    <span className="font-mono">{progress.toFixed(1)}%</span>
                  </div>
                  <Progress value={progress} className="h-3" />
                </div>
                
                <Button variant="outline" className="w-full" onClick={() => { setDecryptedShares(null); setDecryptedVested(null); }}>
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
                <Button onClick={handleDecrypt} disabled={!sharesHandle || !vestedHandle || isDecrypting}>
                  {isDecrypting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlock className="mr-2 h-4 w-4" />}
                  Decrypt Records
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
