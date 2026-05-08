import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseAbiItem } from 'viem';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { EQUISHIELD_ADDRESS } from '@/lib/contract';
import EquiShieldABI from '@/abi/EquiShield.json';
import { encryptUint64, decryptMultipleUint64 } from '@/lib/fhevm';
import { useFhevmStatus } from '@/hooks/useFhevmStatus';
import Layout from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { Lock, Unlock, Loader2, Send, ExternalLink, History, Building2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ── Company profile (mirrored from localStorage, same key as admin) ──────
const PROFILE_KEY = 'equishield:company_profile';
interface CompanyProfile { name: string; ticker: string; totalAuthorized: string; parValue: string; }
function loadProfile(): CompanyProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return JSON.parse(raw) as CompanyProfile;
  } catch { /* ignore */ }
  return { name: '', ticker: '', totalAuthorized: '', parValue: '' };
}

// ── Zod / types ──────────────────────────────────────────────────────────
const transferSchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
  amount: z.string().min(1, "Amount is required"),
});

type TransferEntry = { to: `0x${string}`; timestamp: number; txHash: `0x${string}` };
type DecryptedPosition = {
  shares: bigint;
  vested: bigint;
  price: bigint;  // price-per-share as encrypted uint64 (e.g. cents or whole dollars)
};

const TRANSFER_EVENT = parseAbiItem(
  'event SharesTransferred(address indexed from, address indexed to, uint256 timestamp)'
);

// ── Component ────────────────────────────────────────────────────────────
export default function ShareholderPage() {
  const { address } = useAccount();
  const { toast } = useToast();
  const fheStatus = useFhevmStatus();
  const publicClient = usePublicClient();

  // Read company profile from localStorage on mount (stays in sync with admin page)
  const [profile] = useState<CompanyProfile>(loadProfile);

  const [position, setPosition] = useState<DecryptedPosition | null>(null);
  const [noShares, setNoShares] = useState(false);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isEncrypting, setIsEncrypting] = useState(false);

  const [transfers, setTransfers] = useState<TransferEntry[]>([]);
  const [loadingTransfers, setLoadingTransfers] = useState(false);
  const [transfersLoaded, setTransfersLoaded] = useState(false);

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  // Single call to shareholders(address) returns all three encrypted handles at once:
  // { holder, encryptedShares, encryptedVestedShares, encryptedPricePerShare, isActive }
  const { data: shareholderData, isLoading: sharesLoading } = useReadContract({
    address: EQUISHIELD_ADDRESS,
    abi: EquiShieldABI,
    functionName: 'shareholders',
    args: [address!],
    query: { enabled: !!address },
  });

  const transferForm = useForm<z.infer<typeof transferSchema>>({
    resolver: zodResolver(transferSchema),
    defaultValues: { to: "", amount: "" },
  });

  // ── Transfer history ─────────────────────────────────────────────────────
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
      setTransfers(logs.map((log) => ({
        to: (log.args as any).to as `0x${string}`,
        timestamp: Number((log.args as any).timestamp ?? 0) * 1000,
        txHash: log.transactionHash!,
      })));
    } catch (err) {
      console.error('[transfers] getLogs failed:', err);
    } finally {
      setLoadingTransfers(false);
      setTransfersLoaded(true);
    }
  }, [address, publicClient]);

  useEffect(() => { if (address) loadTransferHistory(); }, [address, loadTransferHistory]);

  useEffect(() => {
    if (isConfirmed) {
      toast({ title: "Transfer Confirmed", description: "Transaction confirmed on-chain." });
      loadTransferHistory();
    }
  }, [isConfirmed, loadTransferHistory, toast]);

  // ── Decrypt: shares + vested + price — all three in ONE wallet signature ──
  async function handleDecrypt() {
    if (isDecrypting || !address) return;
    setIsDecrypting(true);
    setNoShares(false);

    try {
      const sd = shareholderData as
        | [string, `0x${string}`, `0x${string}`, `0x${string}`, boolean]
        | undefined;

      if (!sd) {
        toast({ title: "Data not loaded yet", description: "Please wait and try again.", variant: "destructive" });
        return;
      }

      const [, sharesHandle, vestedHandle, priceHandle, isActive] = sd;

      if (!isActive || BigInt(sharesHandle) === 0n) {
        setNoShares(true);
        return;
      }

      // Build the list of non-zero handles to decrypt together.
      // All handles are decrypted in one userDecrypt call → single EIP-712 signature.
      const pairs: Array<{ handle: `0x${string}`; contractAddress: string }> = [
        { handle: sharesHandle, contractAddress: EQUISHIELD_ADDRESS },
      ];
      const hasVested = BigInt(vestedHandle) !== 0n;
      const hasPrice  = BigInt(priceHandle) !== 0n;
      if (hasVested) pairs.push({ handle: vestedHandle, contractAddress: EQUISHIELD_ADDRESS });
      if (hasPrice)  pairs.push({ handle: priceHandle,  contractAddress: EQUISHIELD_ADDRESS });

      console.log('[shareholder] decrypting', pairs.length, 'handle(s) with a single signature');
      const results = await decryptMultipleUint64(pairs, address);

      let idx = 0;
      const shares = results[idx++];
      const vested = hasVested ? results[idx++] : 0n;
      const price  = hasPrice  ? results[idx++] : 0n;

      setPosition({ shares, vested, price });
      toast({ title: "Decryption Successful", description: "Your encrypted position is now visible." });
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

  // ── Transfer ─────────────────────────────────────────────────────────────
  async function onTransferSubmit(data: z.infer<typeof transferSchema>) {
    if (!address) return toast({ title: "Wallet not connected", variant: "destructive" });
    setIsEncrypting(true);
    try {
      const encryptedAmount = await encryptUint64(BigInt(data.amount), EQUISHIELD_ADDRESS, address);
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
      toast({ title: "Encryption failed", description: err.message, variant: "destructive" });
    }
  }

  // ── Derived display values ────────────────────────────────────────────────
  const unvested = position ? position.shares - position.vested : 0n;
  const vestingPct = position && position.shares > 0n
    ? Math.min(100, Number((position.vested * 10000n) / position.shares) / 100)
    : 0;
  const totalValue = position && position.price > 0n ? position.shares * position.price : null;

  const decryptDisabled = !address || isDecrypting || fheStatus !== 'ready' || sharesLoading;
  const transferBusy = isEncrypting || isPending || isConfirming;

  const companyLabel = profile.name
    ? `${profile.name}${profile.ticker ? ` (${profile.ticker})` : ''}`
    : null;

  return (
    <Layout>
      <div className="flex flex-col gap-8">

        {/* ── Page header ── */}
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Shareholder Dashboard</h1>
          <p className="text-muted-foreground">View your encrypted position and manage your holdings.</p>
        </div>

        {/* ── Company context banner ── */}
        {companyLabel && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="py-4 flex items-center gap-3">
              <Building2 className="w-5 h-5 text-primary shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  You hold shares in: <span className="text-primary font-semibold">{companyLabel}</span>
                </p>
                {profile.totalAuthorized && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Total authorized: {Number(profile.totalAuthorized).toLocaleString()} shares
                    {profile.parValue ? ` · Par value $${profile.parValue}/share` : ''}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* ── Position card ── */}
          <Card className="bg-card">
            <CardHeader>
              <CardTitle>Your Position</CardTitle>
              <CardDescription>
                Shares, vesting, and price — all encrypted on-chain.
                One wallet signature decrypts all three simultaneously.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {position !== null ? (
                <div className="space-y-5">
                  {/* Share count + price row */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/40 border border-border rounded-md p-4">
                      <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Total Shares</div>
                      <div className="text-3xl font-bold font-mono text-foreground">
                        {Number(position.shares).toLocaleString()}
                      </div>
                      {position.price > 0n && (
                        <div className="text-xs text-muted-foreground mt-1">
                          @ ${Number(position.price).toLocaleString()} / share
                        </div>
                      )}
                    </div>
                    {totalValue !== null && (
                      <div className="bg-primary/5 border border-primary/20 rounded-md p-4">
                        <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Total Value</div>
                        <div className="text-3xl font-bold font-mono text-primary">
                          ${Number(totalValue).toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {Number(position.shares).toLocaleString()} × ${Number(position.price).toLocaleString()}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Vesting breakdown */}
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-muted/40 border border-border rounded-md p-3">
                        <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Vested</div>
                        <div className="text-xl font-bold font-mono text-green-400">
                          {Number(position.vested).toLocaleString()}
                        </div>
                      </div>
                      <div className="bg-muted/40 border border-border rounded-md p-3">
                        <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">Unvested</div>
                        <div className="text-xl font-bold font-mono text-muted-foreground">
                          {Number(unvested).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Vesting progress</span>
                        <span className="font-mono">{vestingPct.toFixed(1)}%</span>
                      </div>
                      <Progress value={vestingPct} className="h-2" />
                    </div>
                  </div>

                  <Button variant="outline" size="sm" className="w-full"
                    onClick={() => { setPosition(null); setNoShares(false); }}>
                    <Lock className="mr-2 h-3 w-3" /> Re-encrypt View
                  </Button>
                </div>
              ) : noShares ? (
                <div className="flex flex-col items-center justify-center p-8 border border-border/50 rounded-lg bg-background/50 text-center">
                  <Lock className="w-12 h-12 text-muted-foreground/40 mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground mb-4">No active shares found for this address</p>
                  <Button variant="outline" size="sm" onClick={() => setNoShares(false)}>Try Again</Button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center p-8 border border-border/50 rounded-lg bg-background/50 text-center">
                  <Lock className="w-12 h-12 text-primary/50 mx-auto mb-4" />
                  <div className="text-2xl font-bold font-mono text-muted-foreground mb-2 blur-sm select-none">••••••</div>
                  <div className="text-sm text-primary uppercase tracking-widest flex items-center justify-center gap-2 mb-2">
                    <Lock className="w-4 h-4" /> FHE Encrypted
                  </div>
                  <p className="text-xs text-muted-foreground mb-6">
                    Shares, vesting &amp; price decrypted together — one signature
                  </p>
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
                        : <><Unlock className="mr-2 h-4 w-4" /> Decrypt Position (1 sig)</>
                      }
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Transfer card ── */}
          <Card>
            <CardHeader>
              <CardTitle>Transfer Shares</CardTitle>
              <CardDescription>
                Transfer a portion of your shares to another address.
                {companyLabel && <span className="text-primary"> ({companyLabel})</span>}
              </CardDescription>
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
              {companyLabel && (
                <span className="text-sm font-normal text-muted-foreground">
                  — {companyLabel}
                </span>
              )}
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
