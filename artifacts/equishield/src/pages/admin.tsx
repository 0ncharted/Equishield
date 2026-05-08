import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { parseAbiItem } from 'viem';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { EQUISHIELD_ADDRESS } from '@/lib/contract';
import EquiShieldABI from '@/abi/EquiShield.json';
import { encryptUint64, encryptTwoUint64 } from '@/lib/fhevm';
import { useFhevmStatus } from '@/hooks/useFhevmStatus';
import Layout from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Lock, CheckCircle2, AlertCircle, Loader2, ListPlus, Building2, ExternalLink, History, Pencil, Save, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// ── Schemas ─────────────────────────────────────────────────────────────
const issueSharesSchema = z.object({
  holder: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
  shares: z.string().min(1, "Shares amount is required"),
  price: z.string().min(1, "Price is required"),
});

const vestSharesSchema = z.object({
  holder: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
  amount: z.string().min(1, "Amount is required"),
});

type BatchResult = { address: string; status: 'success' | 'failed'; error?: string };

// ── Company Profile ──────────────────────────────────────────────────────
const PROFILE_KEY = 'equishield:company_profile';

interface CompanyProfile {
  name: string;
  ticker: string;
  totalAuthorized: string;
  parValue: string;
}

function loadProfile(): CompanyProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (raw) return JSON.parse(raw) as CompanyProfile;
  } catch { /* ignore */ }
  return { name: '', ticker: '', totalAuthorized: '', parValue: '' };
}

function saveProfile(p: CompanyProfile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
}

// ── Transaction log events ───────────────────────────────────────────────
const ISSUED_EVENT = parseAbiItem(
  'event SharesIssued(address indexed holder, uint256 timestamp)'
);
const VESTED_EVENT = parseAbiItem(
  'event SharesVested(address indexed holder, uint256 timestamp)'
);

type TxEntry = {
  type: 'Issued' | 'Vested';
  holder: `0x${string}`;
  timestamp: number;
  txHash: `0x${string}`;
};

// ── Component ────────────────────────────────────────────────────────────
export default function AdminPage() {
  const { address } = useAccount();
  const { toast } = useToast();
  const fheStatus = useFhevmStatus();
  const publicClient = usePublicClient();

  const { writeContractAsync, data: txHash, error: txError, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const [isEncrypting, setIsEncrypting] = useState(false);

  // Company Profile
  const [profile, setProfile] = useState<CompanyProfile>(loadProfile);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState<CompanyProfile>(loadProfile);

  // Transaction History
  const [txHistory, setTxHistory] = useState<TxEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Batch state
  const [batchIssueText, setBatchIssueText] = useState('');
  const [batchVestText, setBatchVestText] = useState('');
  const [batchIssueProgress, setBatchIssueProgress] = useState<{ current: number; total: number } | null>(null);
  const [batchVestProgress, setBatchVestProgress] = useState<{ current: number; total: number } | null>(null);
  const [batchIssueResults, setBatchIssueResults] = useState<BatchResult[]>([]);
  const [batchVestResults, setBatchVestResults] = useState<BatchResult[]>([]);

  const { data: owner } = useReadContract({
    address: EQUISHIELD_ADDRESS,
    abi: EquiShieldABI,
    functionName: 'owner',
  });

  const { data: shareholderCount } = useReadContract({
    address: EQUISHIELD_ADDRESS,
    abi: EquiShieldABI,
    functionName: 'getShareholderCount',
  });

  const issueForm = useForm<z.infer<typeof issueSharesSchema>>({
    resolver: zodResolver(issueSharesSchema),
    defaultValues: { holder: "", shares: "", price: "" },
  });

  const vestForm = useForm<z.infer<typeof vestSharesSchema>>({
    resolver: zodResolver(vestSharesSchema),
    defaultValues: { holder: "", amount: "" },
  });

  // ── Transaction History loader ──────────────────────────────────────────
  const loadTxHistory = useCallback(async () => {
    if (!publicClient) return;
    setLoadingHistory(true);
    try {
      const currentBlock = await publicClient.getBlockNumber();
      const fromBlock = currentBlock > 49000n ? currentBlock - 49000n : 0n;

      const [issuedLogs, vestedLogs] = await Promise.all([
        publicClient.getLogs({
          address: EQUISHIELD_ADDRESS,
          event: ISSUED_EVENT,
          fromBlock,
          toBlock: 'latest',
        }),
        publicClient.getLogs({
          address: EQUISHIELD_ADDRESS,
          event: VESTED_EVENT,
          fromBlock,
          toBlock: 'latest',
        }),
      ]);

      const entries: TxEntry[] = [
        ...issuedLogs.map((l) => ({
          type: 'Issued' as const,
          holder: (l.args as any).holder as `0x${string}`,
          timestamp: Number((l.args as any).timestamp ?? 0) * 1000,
          txHash: l.transactionHash!,
        })),
        ...vestedLogs.map((l) => ({
          type: 'Vested' as const,
          holder: (l.args as any).holder as `0x${string}`,
          timestamp: Number((l.args as any).timestamp ?? 0) * 1000,
          txHash: l.transactionHash!,
        })),
      ];

      // Sort newest first
      entries.sort((a, b) => b.timestamp - a.timestamp);
      setTxHistory(entries);
    } catch (err) {
      console.error('[txHistory] getLogs failed:', err);
    } finally {
      setLoadingHistory(false);
      setHistoryLoaded(true);
    }
  }, [publicClient]);

  useEffect(() => {
    loadTxHistory();
  }, [loadTxHistory]);

  useEffect(() => {
    if (isConfirmed) {
      toast({ title: "Transaction Confirmed" });
      loadTxHistory();
    }
  }, [isConfirmed, loadTxHistory, toast]);

  // ── Issue Shares ────────────────────────────────────────────────────────
  async function onIssueSubmit(data: z.infer<typeof issueSharesSchema>) {
    if (!address) return toast({ title: "Wallet not connected", variant: "destructive" });
    setIsEncrypting(true);
    try {
      console.log("[issueShares] encrypting shares:", data.shares, "price:", data.price);
      const enc = await encryptTwoUint64(BigInt(data.shares), BigInt(data.price), EQUISHIELD_ADDRESS, address);
      console.log("[issueShares] encryption successful — handle0:", enc.handle0, "handle1:", enc.handle1);
      setIsEncrypting(false);
      await writeContractAsync({
        address: EQUISHIELD_ADDRESS,
        abi: EquiShieldABI,
        functionName: 'issueShares',
        args: [data.holder as `0x${string}`, enc.handle0, enc.proof, enc.handle1, enc.proof],
      });
      toast({ title: "Shares Issued", description: `Transaction submitted for ${data.holder.slice(0, 10)}...` });
      issueForm.reset();
    } catch (err: any) {
      setIsEncrypting(false);
      console.error("[issueShares] failed:", err);
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  }

  // ── Vest Shares ─────────────────────────────────────────────────────────
  async function onVestSubmit(data: z.infer<typeof vestSharesSchema>) {
    if (!address) return toast({ title: "Wallet not connected", variant: "destructive" });
    setIsEncrypting(true);
    try {
      console.log("[vestShares] encrypting amount:", data.amount);
      const encryptedAmount = await encryptUint64(BigInt(data.amount), EQUISHIELD_ADDRESS, address);
      console.log("[vestShares] encryption successful, handle:", encryptedAmount.handle);
      setIsEncrypting(false);
      await writeContractAsync({
        address: EQUISHIELD_ADDRESS,
        abi: EquiShieldABI,
        functionName: 'vestShares',
        args: [data.holder as `0x${string}`, encryptedAmount.handle, encryptedAmount.proof],
      });
      toast({ title: "Vesting Triggered", description: `Transaction submitted for ${data.holder.slice(0, 10)}...` });
      vestForm.reset();
    } catch (err: any) {
      setIsEncrypting(false);
      console.error("[vestShares] failed:", err);
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  }

  // ── Batch Issue ─────────────────────────────────────────────────────────
  async function handleBatchIssue() {
    if (!address) return toast({ title: "Wallet not connected", variant: "destructive" });
    const lines = batchIssueText.trim().split('\n').filter(Boolean);
    if (!lines.length) return toast({ title: "No entries", description: "Paste at least one line.", variant: "destructive" });

    const results: BatchResult[] = [];
    setBatchIssueResults([]);
    setBatchIssueProgress({ current: 0, total: lines.length });

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const parts = line.split(',').map(s => s.trim());
      const [holderAddr, sharesStr, priceStr] = parts;
      setBatchIssueProgress({ current: i + 1, total: lines.length });

      if (parts.length < 3 || !/^0x[a-fA-F0-9]{40}$/.test(holderAddr)) {
        results.push({ address: holderAddr ?? line, status: 'failed', error: 'Invalid format (expected: address,shares,price)' });
        continue;
      }
      const sharesN = Number(sharesStr);
      const priceN = Number(priceStr);
      if (!Number.isFinite(sharesN) || sharesN <= 0 || !Number.isFinite(priceN) || priceN <= 0) {
        results.push({ address: holderAddr, status: 'failed', error: 'Shares and price must be positive numbers' });
        continue;
      }

      try {
        const enc = await encryptTwoUint64(BigInt(Math.round(sharesN)), BigInt(Math.round(priceN)), EQUISHIELD_ADDRESS, address);
        await writeContractAsync({
          address: EQUISHIELD_ADDRESS,
          abi: EquiShieldABI,
          functionName: 'issueShares',
          args: [holderAddr as `0x${string}`, enc.handle0, enc.proof, enc.handle1, enc.proof],
        });
        results.push({ address: holderAddr, status: 'success' });
      } catch (err: any) {
        results.push({ address: holderAddr, status: 'failed', error: err.message?.slice(0, 80) });
      }
    }

    setBatchIssueResults(results);
    setBatchIssueProgress(null);
    const succeeded = results.filter(r => r.status === 'success').length;
    toast({
      title: `Batch complete: ${succeeded}/${lines.length} succeeded`,
      variant: succeeded === lines.length ? 'default' : 'destructive',
    });
  }

  // ── Batch Vest ──────────────────────────────────────────────────────────
  async function handleBatchVest() {
    if (!address) return toast({ title: "Wallet not connected", variant: "destructive" });
    const lines = batchVestText.trim().split('\n').filter(Boolean);
    if (!lines.length) return toast({ title: "No entries", description: "Paste at least one line.", variant: "destructive" });

    const results: BatchResult[] = [];
    setBatchVestResults([]);
    setBatchVestProgress({ current: 0, total: lines.length });

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const parts = line.split(',').map(s => s.trim());
      const [holderAddr, amountStr] = parts;
      setBatchVestProgress({ current: i + 1, total: lines.length });

      if (parts.length < 2 || !/^0x[a-fA-F0-9]{40}$/.test(holderAddr)) {
        results.push({ address: holderAddr ?? line, status: 'failed', error: 'Invalid format (expected: address,vestedAmount)' });
        continue;
      }
      const amountN = Number(amountStr);
      if (!Number.isFinite(amountN) || amountN <= 0) {
        results.push({ address: holderAddr, status: 'failed', error: 'Vested amount must be positive' });
        continue;
      }

      try {
        const encAmount = await encryptUint64(BigInt(Math.round(amountN)), EQUISHIELD_ADDRESS, address);
        await writeContractAsync({
          address: EQUISHIELD_ADDRESS,
          abi: EquiShieldABI,
          functionName: 'vestShares',
          args: [holderAddr as `0x${string}`, encAmount.handle, encAmount.proof],
        });
        results.push({ address: holderAddr, status: 'success' });
      } catch (err: any) {
        results.push({ address: holderAddr, status: 'failed', error: err.message?.slice(0, 80) });
      }
    }

    setBatchVestResults(results);
    setBatchVestProgress(null);
    const succeeded = results.filter(r => r.status === 'success').length;
    toast({
      title: `Batch vest complete: ${succeeded}/${lines.length} succeeded`,
      variant: succeeded === lines.length ? 'default' : 'destructive',
    });
  }

  useEffect(() => {
    if (txError) toast({ title: "Transaction Error", description: txError.message, variant: "destructive" });
  }, [txError, toast]);

  const fheNotReady = fheStatus !== 'ready';

  if (owner && address && owner !== address) {
    return (
      <Layout>
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="pt-6 flex flex-col items-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-bold text-destructive mb-2">Access Denied</h2>
            <p className="text-muted-foreground text-center">You are not the contract owner. Only the deployer wallet can access this dashboard.</p>
          </CardContent>
        </Card>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Admin Dashboard</h1>
          <p className="text-muted-foreground">Manage cap table, issue shares, and trigger vesting schedules.</p>
          {fheNotReady && (
            <div className="mt-3 flex items-center gap-2 text-sm text-yellow-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              FHE initializing — encryption will be available shortly.
            </div>
          )}
        </div>

        {/* ── Company Profile ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-primary" />
                <CardTitle>Company Profile</CardTitle>
              </div>
              {!editingProfile ? (
                <Button variant="ghost" size="sm" onClick={() => { setProfileDraft(profile); setEditingProfile(true); }}>
                  <Pencil className="w-4 h-4 mr-1" /> Edit
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditingProfile(false)}>
                    <X className="w-4 h-4 mr-1" /> Cancel
                  </Button>
                  <Button size="sm" onClick={() => { saveProfile(profileDraft); setProfile(profileDraft); setEditingProfile(false); toast({ title: "Profile saved" }); }}>
                    <Save className="w-4 h-4 mr-1" /> Save
                  </Button>
                </div>
              )}
            </div>
            <CardDescription>Off-chain display metadata stored locally — not written to the blockchain.</CardDescription>
          </CardHeader>
          <CardContent>
            {editingProfile ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Company Name</label>
                  <Input
                    placeholder="Acme Corp"
                    value={profileDraft.name}
                    onChange={e => setProfileDraft(d => ({ ...d, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Ticker Symbol</label>
                  <Input
                    placeholder="ACME"
                    value={profileDraft.ticker}
                    onChange={e => setProfileDraft(d => ({ ...d, ticker: e.target.value.toUpperCase() }))}
                    maxLength={10}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Total Authorized Shares</label>
                  <Input
                    placeholder="10,000,000"
                    type="number"
                    min="1"
                    value={profileDraft.totalAuthorized}
                    onChange={e => setProfileDraft(d => ({ ...d, totalAuthorized: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Par Value Per Share ($)</label>
                  <Input
                    placeholder="0.0001"
                    type="number"
                    min="0"
                    step="0.0001"
                    value={profileDraft.parValue}
                    onChange={e => setProfileDraft(d => ({ ...d, parValue: e.target.value }))}
                  />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Company Name', value: profile.name || '—' },
                  { label: 'Ticker Symbol', value: profile.ticker || '—' },
                  { label: 'Authorized Shares', value: profile.totalAuthorized ? Number(profile.totalAuthorized).toLocaleString() : '—' },
                  { label: 'Par Value', value: profile.parValue ? `$${profile.parValue}` : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-muted/40 rounded-md p-4 border border-border">
                    <div className="text-xs text-muted-foreground uppercase tracking-widest mb-1">{label}</div>
                    <div className="font-semibold font-mono text-sm text-foreground">{value}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Single Issue + Vest ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <CardTitle>Issue New Shares</CardTitle>
              <CardDescription>Grant encrypted shares to a new holder.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...issueForm}>
                <form onSubmit={issueForm.handleSubmit(onIssueSubmit)} className="space-y-4">
                  <FormField control={issueForm.control} name="holder" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Holder Address</FormLabel>
                      <FormControl><Input placeholder="0x..." className="font-mono" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={issueForm.control} name="shares" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Shares Amount</FormLabel>
                        <FormControl><Input type="number" placeholder="1000" min="1" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={issueForm.control} name="price" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Price Per Share</FormLabel>
                        <FormControl><Input type="number" placeholder="10" min="1" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <Button type="submit" disabled={isEncrypting || isPending || isConfirming || fheNotReady || !address} className="w-full">
                    {isEncrypting
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Encrypting...</>
                      : isPending
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Confirm in wallet...</>
                      : isConfirming
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Confirming...</>
                      : <><Lock className="mr-2 h-4 w-4" />Encrypt & Issue</>
                    }
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trigger Vesting</CardTitle>
              <CardDescription>Vest a specific amount of shares for a holder.</CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...vestForm}>
                <form onSubmit={vestForm.handleSubmit(onVestSubmit)} className="space-y-4">
                  <FormField control={vestForm.control} name="holder" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Holder Address</FormLabel>
                      <FormControl><Input placeholder="0x..." className="font-mono" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={vestForm.control} name="amount" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Vested Amount</FormLabel>
                      <FormControl><Input type="number" placeholder="500" min="1" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" disabled={isEncrypting || isPending || isConfirming || fheNotReady || !address} variant="secondary" className="w-full">
                    {isEncrypting
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Encrypting...</>
                      : isPending
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Confirm in wallet...</>
                      : isConfirming
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Confirming...</>
                      : <><Lock className="mr-2 h-4 w-4" />Encrypt & Vest</>
                    }
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* ── Batch Issue ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListPlus className="w-5 h-5 text-primary" /> Batch Issue Shares
            </CardTitle>
            <CardDescription>
              Paste multiple entries, one per line: <code className="text-xs bg-muted px-1 py-0.5 rounded">address,shares,pricePerShare</code>
              <br />
              <span className="text-xs text-muted-foreground mt-1 block">Example: 0xABC...,1000,5</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder={"0xAbc1...,1000,5\n0xDef2...,500,10\n0xGhi3...,250,20"}
              rows={5}
              className="font-mono text-xs"
              value={batchIssueText}
              onChange={e => setBatchIssueText(e.target.value)}
              disabled={!!batchIssueProgress}
            />
            {batchIssueProgress && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Processing {batchIssueProgress.current} / {batchIssueProgress.total}...
              </div>
            )}
            {batchIssueResults.length > 0 && (
              <div className="space-y-1">
                {batchIssueResults.map((r, i) => (
                  <div key={i} className={`flex items-center gap-2 text-xs font-mono p-2 rounded ${r.status === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive'}`}>
                    {r.status === 'success' ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <AlertCircle className="w-3 h-3 shrink-0" />}
                    <span className="truncate">{r.address.slice(0, 14)}...</span>
                    {r.error && <span className="text-destructive/80 truncate">{r.error}</span>}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  {batchIssueResults.filter(r => r.status === 'success').length} succeeded,{' '}
                  {batchIssueResults.filter(r => r.status === 'failed').length} failed
                </p>
              </div>
            )}
            <Button onClick={handleBatchIssue} disabled={!batchIssueText.trim() || !!batchIssueProgress || fheNotReady || !address} className="w-full">
              {batchIssueProgress
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing {batchIssueProgress.current}/{batchIssueProgress.total}...</>
                : <><ListPlus className="mr-2 h-4 w-4" />Batch Encrypt & Issue</>
              }
            </Button>
          </CardContent>
        </Card>

        {/* ── Batch Vest ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListPlus className="w-5 h-5 text-primary" /> Batch Vest Shares
            </CardTitle>
            <CardDescription>
              Paste multiple entries, one per line: <code className="text-xs bg-muted px-1 py-0.5 rounded">address,vestedAmount</code>
              <br />
              <span className="text-xs text-muted-foreground mt-1 block">Example: 0xABC...,250</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder={"0xAbc1...,250\n0xDef2...,100"}
              rows={4}
              className="font-mono text-xs"
              value={batchVestText}
              onChange={e => setBatchVestText(e.target.value)}
              disabled={!!batchVestProgress}
            />
            {batchVestProgress && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Processing {batchVestProgress.current} / {batchVestProgress.total}...
              </div>
            )}
            {batchVestResults.length > 0 && (
              <div className="space-y-1">
                {batchVestResults.map((r, i) => (
                  <div key={i} className={`flex items-center gap-2 text-xs font-mono p-2 rounded ${r.status === 'success' ? 'bg-green-500/10 text-green-500' : 'bg-destructive/10 text-destructive'}`}>
                    {r.status === 'success' ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <AlertCircle className="w-3 h-3 shrink-0" />}
                    <span className="truncate">{r.address.slice(0, 14)}...</span>
                    {r.error && <span className="text-destructive/80 truncate">{r.error}</span>}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground pt-1">
                  {batchVestResults.filter(r => r.status === 'success').length} succeeded,{' '}
                  {batchVestResults.filter(r => r.status === 'failed').length} failed
                </p>
              </div>
            )}
            <Button onClick={handleBatchVest} disabled={!batchVestText.trim() || !!batchVestProgress || fheNotReady || !address} variant="secondary" className="w-full">
              {batchVestProgress
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing {batchVestProgress.current}/{batchVestProgress.total}...</>
                : <><ListPlus className="mr-2 h-4 w-4" />Batch Encrypt & Vest</>
              }
            </Button>
          </CardContent>
        </Card>

        {/* ── Cap Table Overview ── */}
        <Card>
          <CardHeader>
            <CardTitle className="flex justify-between items-center">
              <span>Cap Table Overview</span>
              <span className="text-sm font-normal text-muted-foreground">Total Holders: {Number(shareholderCount ?? 0)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Holder Address</TableHead>
                  <TableHead>Total Shares</TableHead>
                  <TableHead>Vested Shares</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Number(shareholderCount ?? 0) === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No shareholders yet. Issue shares above to populate the cap table.
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow>
                    <TableCell className="font-mono text-sm text-muted-foreground">— encrypted on-chain —</TableCell>
                    <TableCell><div className="flex items-center gap-1 text-primary text-xs"><Lock className="w-3 h-3" /> Encrypted</div></TableCell>
                    <TableCell><div className="flex items-center gap-1 text-primary text-xs"><Lock className="w-3 h-3" /> Encrypted</div></TableCell>
                    <TableCell><span className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium bg-green-500/10 text-green-500">Active</span></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* ── Transaction History ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-primary" />
                <CardTitle>Transaction History</CardTitle>
              </div>
              <Button variant="ghost" size="sm" onClick={loadTxHistory} disabled={loadingHistory}>
                {loadingHistory ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Refresh'}
              </Button>
            </div>
            <CardDescription>All SharesIssued and SharesVested events from the contract on Sepolia.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingHistory ? (
              <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading events from chain...
              </div>
            ) : txHistory.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                {historyLoaded ? "No on-chain events found yet. Issue or vest shares to populate this log." : "Loading..."}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Holder Address</TableHead>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Tx Hash</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {txHistory.map((entry) => (
                    <TableRow key={entry.txHash + entry.type}>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          entry.type === 'Issued'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {entry.type}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {entry.holder.slice(0, 10)}...{entry.holder.slice(-6)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—'}
                      </TableCell>
                      <TableCell>
                        <a
                          href={`https://sepolia.etherscan.io/tx/${entry.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-primary hover:underline font-mono"
                        >
                          {entry.txHash.slice(0, 10)}...{entry.txHash.slice(-4)}
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
