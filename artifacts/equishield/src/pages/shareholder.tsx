import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseAbiItem } from 'viem';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { EQUISHIELD_ADDRESS } from '@/lib/contract';
import EquiShieldABI from '@/abi/EquiShield.json';
import { encryptUint64, decryptUint64 } from '@/lib/fhevm';
import { useFhevmStatus } from '@/hooks/useFhevmStatus';
import Layout from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Lock, Unlock, Loader2, Send, ExternalLink, History } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const transferSchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
  amount: z.string().min(1, "Amount is required"),
});

type TransferEntry = {
  to: `0x${string}`;
  timestamp: number;
  txHash: `0x${string}`;
};

const TRANSFER_EVENT = parseAbiItem(
  'event SharesTransferred(address indexed from, address indexed to, uint256 timestamp)'
);

export default function ShareholderPage() {
  const { address } = useAccount();
  const { toast } = useToast();
  const fheStatus = useFhevmStatus();
  const publicClient = usePublicClient();

  const [decryptedShares, setDecryptedShares] = useState<string | null>(null);
  const [noShares, setNoShares] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isEncrypting, setIsEncrypting] = useState(false);

  const [transfers, setTransfers] = useState<TransferEntry[]>([]);
  const [loadingTransfers, setLoadingTransfers] = useState(false);
  const [transfersLoaded, setTransfersLoaded] = useState(false);

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: mySharesHandle, isLoading: sharesLoading } = useReadContract({
    address: EQUISHIELD_ADDRESS,
    abi: EquiShieldABI,
    functionName: 'getMyShares',
    account: address,
    query: { enabled: !!address },
  });

  const transferForm = useForm<z.infer<typeof transferSchema>>({
    resolver: zodResolver(transferSchema),
    defaultValues: { to: "", amount: "" },
  });

  // ── Transfer history ────────────────────────────────────────────────────
  const loadTransferHistory = useCallback(async () => {
    if (!address || !publicClient) return;
    setLoadingTransfers(true);
    try {
      const currentBlock = await publicClient.getBlockNumber();
      const fromBlock = currentBlock > 49000n ? currentBlock - 49000n : 0n;
      const logs = await publicClient.getLogs({
        address: EQUISHIELD_ADDRESS,
        event: TRANSFER_EVENT,
        args: { from: address },
        fromBlock,
        toBlock: 'latest',
      });
      setTransfers(
        logs.map((log) => ({
          to: (log.args as any).to as `0x${string}`,
          timestamp: Number((log.args as any).timestamp ?? 0) * 1000,
          txHash: log.transactionHash!,
        }))
      );
    } catch (err) {
      console.error('[transfers] getLogs failed:', err);
    } finally {
      setLoadingTransfers(false);
      setTransfersLoaded(true);
    }
  }, [address, publicClient]);

  useEffect(() => {
    if (address) loadTransferHistory();
  }, [address, loadTransferHistory]);

  useEffect(() => {
    if (isConfirmed) {
      toast({ title: "Transfer Confirmed", description: "Transaction confirmed on-chain." });
      loadTransferHistory();
    }
  }, [isConfirmed, loadTransferHistory, toast]);

  // ── Decrypt balance ─────────────────────────────────────────────────────
  async function handleDecrypt() {
    if (isDecrypting || !address) return;
    setIsDecrypting(true);
    setNoShares(false);
    try {
      const handle = mySharesHandle as `0x${string}` | undefined;
      if (!handle || BigInt(handle) === 0n) {
        setNoShares(true);
        return;
      }
      // decryptUint64 correctly reads ClearValueType directly (bigint), not .value
      const decrypted = await decryptUint64(handle, EQUISHIELD_ADDRESS, address);
      setDecryptedShares(decrypted.toString());
      toast({ title: "Decryption Successful", description: "Your shares are now visible." });
    } catch (err: any) {
      if (err.message?.includes('No shares')) {
        setNoShares(true);
      } else {
        toast({ title: "Decryption Failed", description: err.message, variant: "destructive" });
      }
    } finally {
      setIsDecrypting(false);
    }
  }

  // ── Transfer ────────────────────────────────────────────────────────────
  async function onTransferSubmit(data: z.infer<typeof transferSchema>) {
    if (!address) return toast({ title: "Wallet not connected", variant: "destructive" });
    setIsEncrypting(true);
    try {
      console.log("[transferShares] encrypting amount:", data.amount);
      const encryptedAmount = await encryptUint64(BigInt(data.amount), EQUISHIELD_ADDRESS, address);
      console.log("[transferShares] encryption successful, handle:", encryptedAmount.handle);
      setIsEncrypting(false);
      writeContract({
        address: EQUISHIELD_ADDRESS,
        abi: EquiShieldABI,
        functionName: 'transferShares',
        args: [data.to as `0x${string}`, encryptedAmount.handle, encryptedAmount.proof],
      });
      transferForm.reset();
    } catch (err: any) {
      setIsEncrypting(false);
      console.error("[transferShares] failed:", err);
      toast({ title: "Encryption failed", description: err.message, variant: "destructive" });
    }
  }

  const decryptDisabled = !address || isDecrypting || fheStatus !== 'ready' || sharesLoading;
  const transferBusy = isEncrypting || isPending || isConfirming;

  return (
    <Layout>
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Shareholder Dashboard</h1>
          <p className="text-muted-foreground">View your encrypted position and manage your holdings.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* ── Position card ── */}
          <Card className="bg-card">
            <CardHeader>
              <CardTitle>Your Position</CardTitle>
              <CardDescription>Your share balance is encrypted on-chain. Decrypt to view.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center p-8 border border-border/50 rounded-lg bg-background/50">
                {decryptedShares !== null ? (
                  <div className="text-center">
                    <Unlock className="w-12 h-12 text-primary mx-auto mb-4" />
                    <div className="text-4xl font-bold font-mono text-foreground mb-2">
                      {Number(decryptedShares).toLocaleString()}
                    </div>
                    <div className="text-sm text-muted-foreground uppercase tracking-widest mb-1">Your shares</div>
                    <Button variant="outline" size="sm" className="mt-4"
                      onClick={() => { setDecryptedShares(null); setNoShares(false); }}>
                      <Lock className="mr-2 h-3 w-3" /> Hide
                    </Button>
                  </div>
                ) : noShares ? (
                  <div className="text-center">
                    <Lock className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground mb-4">No shares found for this address</p>
                    <Button variant="outline" size="sm" onClick={() => setNoShares(false)}>Try Again</Button>
                  </div>
                ) : (
                  <div className="text-center">
                    <Lock className="w-12 h-12 text-primary/50 mx-auto mb-4" />
                    <div className="text-2xl font-bold font-mono text-muted-foreground mb-2 blur-sm select-none">••••••</div>
                    <div className="text-sm text-primary uppercase tracking-widest flex items-center justify-center gap-2 mb-6">
                      <Lock className="w-4 h-4" /> FHE Encrypted
                    </div>
                    {!address ? (
                      <p className="text-xs text-muted-foreground">Connect wallet to decrypt</p>
                    ) : (
                      <Button onClick={handleDecrypt} disabled={decryptDisabled}>
                        {isDecrypting
                          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Decrypting...</>
                          : sharesLoading
                          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading...</>
                          : fheStatus !== 'ready'
                          ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> FHE Initializing...</>
                          : <><Unlock className="mr-2 h-4 w-4" /> Decrypt Balance</>
                        }
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* ── Transfer card ── */}
          <Card>
            <CardHeader>
              <CardTitle>Transfer Shares</CardTitle>
              <CardDescription>Transfer a portion of your shares to another address.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...transferForm}>
                <form onSubmit={transferForm.handleSubmit(onTransferSubmit)} className="space-y-4">
                  <FormField control={transferForm.control} name="to" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Recipient Address</FormLabel>
                      <FormControl><Input placeholder="0x..." className="font-mono" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={transferForm.control} name="amount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Amount to Transfer</FormLabel>
                      <FormControl><Input type="number" placeholder="100" min="1" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" disabled={transferBusy || !address} className="w-full">
                    {isEncrypting
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Encrypting...</>
                      : isPending
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirm in wallet...</>
                      : isConfirming
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Confirming...</>
                      : <><Send className="mr-2 h-4 w-4" /> Encrypt & Transfer</>
                    }
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* ── Transfer history ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="w-5 h-5 text-primary" /> Transfer History
            </CardTitle>
            <CardDescription>Outgoing transfers sent from your connected wallet.</CardDescription>
          </CardHeader>
          <CardContent>
            {!address ? (
              <p className="text-sm text-muted-foreground py-4">Connect wallet to view transfer history.</p>
            ) : loadingTransfers ? (
              <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading transfer history...
              </div>
            ) : transfers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                {transfersLoaded ? "No transfers yet." : "Loading..."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>To Address</TableHead>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Tx Hash</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transfers.map((t) => (
                    <TableRow key={t.txHash}>
                      <TableCell className="font-mono text-xs">
                        {t.to.slice(0, 10)}...{t.to.slice(-6)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {t.timestamp ? new Date(t.timestamp).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>
                        <a
                          href={`https://sepolia.etherscan.io/tx/${t.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-primary hover:underline font-mono"
                        >
                          {t.txHash.slice(0, 10)}...{t.txHash.slice(-4)}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
