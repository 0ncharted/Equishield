import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
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
import { Lock, CheckCircle2, AlertCircle, Loader2, ListPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

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

export default function AdminPage() {
  const { address } = useAccount();
  const { toast } = useToast();
  const fheStatus = useFhevmStatus();

  const { writeContractAsync, data: txHash, error: txError, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

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

  async function onIssueSubmit(data: z.infer<typeof issueSharesSchema>) {
    if (!address) return toast({ title: "Wallet not connected", variant: "destructive" });
    try {
      console.log("[issueShares] encrypting shares:", data.shares, "price:", data.price);
      const enc = await encryptTwoUint64(BigInt(data.shares), BigInt(data.price), EQUISHIELD_ADDRESS, address);
      console.log("[issueShares] encryption successful — handle0:", enc.handle0, "handle1:", enc.handle1);
      await writeContractAsync({
        address: EQUISHIELD_ADDRESS,
        abi: EquiShieldABI,
        functionName: 'issueShares',
        args: [data.holder as `0x${string}`, enc.handle0, enc.proof, enc.handle1, enc.proof],
      });
      toast({ title: "Shares Issued", description: `Transaction submitted for ${data.holder.slice(0, 10)}...` });
      issueForm.reset();
    } catch (err: any) {
      console.error("[issueShares] failed:", err);
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  }

  async function onVestSubmit(data: z.infer<typeof vestSharesSchema>) {
    if (!address) return toast({ title: "Wallet not connected", variant: "destructive" });
    try {
      console.log("[vestShares] encrypting amount:", data.amount);
      const encryptedAmount = await encryptUint64(BigInt(data.amount), EQUISHIELD_ADDRESS, address);
      console.log("[vestShares] encryption successful, handle:", encryptedAmount.handle);
      await writeContractAsync({
        address: EQUISHIELD_ADDRESS,
        abi: EquiShieldABI,
        functionName: 'vestShares',
        args: [data.holder as `0x${string}`, encryptedAmount.handle, encryptedAmount.proof],
      });
      toast({ title: "Vesting Triggered", description: `Transaction submitted for ${data.holder.slice(0, 10)}...` });
      vestForm.reset();
    } catch (err: any) {
      console.error("[vestShares] failed:", err);
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    }
  }

  // --- Batch Issue ---
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

      // Validate
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
        console.log("[batchIssue] encrypting for", holderAddr, "shares:", sharesN, "price:", priceN);
        const enc = await encryptTwoUint64(BigInt(Math.round(sharesN)), BigInt(Math.round(priceN)), EQUISHIELD_ADDRESS, address);
        console.log("[batchIssue] encryption successful for", holderAddr);
        await writeContractAsync({
          address: EQUISHIELD_ADDRESS,
          abi: EquiShieldABI,
          functionName: 'issueShares',
          args: [holderAddr as `0x${string}`, enc.handle0, enc.proof, enc.handle1, enc.proof],
        });
        results.push({ address: holderAddr, status: 'success' });
      } catch (err: any) {
        console.error("[batchIssue] failed for", holderAddr, err);
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

  // --- Batch Vest ---
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

        {/* Single Issue + Vest */}
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
                  <Button type="submit" disabled={isPending || isConfirming || fheNotReady || !address} className="w-full">
                    {isPending || isConfirming
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isConfirming ? 'Confirming...' : 'Encrypting...'}</>
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
                  <Button type="submit" disabled={isPending || isConfirming || fheNotReady || !address} variant="secondary" className="w-full">
                    {isPending || isConfirming
                      ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isConfirming ? 'Confirming...' : 'Encrypting...'}</>
                      : <><Lock className="mr-2 h-4 w-4" />Encrypt & Vest</>
                    }
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        {/* Batch Issue */}
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
                    {r.status === 'success'
                      ? <CheckCircle2 className="w-3 h-3 shrink-0" />
                      : <AlertCircle className="w-3 h-3 shrink-0" />
                    }
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
            <Button
              onClick={handleBatchIssue}
              disabled={!batchIssueText.trim() || !!batchIssueProgress || fheNotReady || !address}
              className="w-full"
            >
              {batchIssueProgress
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing {batchIssueProgress.current}/{batchIssueProgress.total}...</>
                : <><ListPlus className="mr-2 h-4 w-4" />Batch Encrypt & Issue</>
              }
            </Button>
          </CardContent>
        </Card>

        {/* Batch Vest */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListPlus className="w-5 h-5 text-primary" /> Batch Vest Shares
            </CardTitle>
            <CardDescription>
              Paste multiple entries, one per line: <code className="text-xs bg-muted px-1 py-0.5 rounded">address,vestedAmount</code>
              <br />
              <span className="text-xs text-muted-foreground mt-1 block">Example: 0xABC...,250 — negative amounts are rejected</span>
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
                    {r.status === 'success'
                      ? <CheckCircle2 className="w-3 h-3 shrink-0" />
                      : <AlertCircle className="w-3 h-3 shrink-0" />
                    }
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
            <Button
              onClick={handleBatchVest}
              disabled={!batchVestText.trim() || !!batchVestProgress || fheNotReady || !address}
              variant="secondary"
              className="w-full"
            >
              {batchVestProgress
                ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Processing {batchVestProgress.current}/{batchVestProgress.total}...</>
                : <><ListPlus className="mr-2 h-4 w-4" />Batch Encrypt & Vest</>
              }
            </Button>
          </CardContent>
        </Card>

        {/* Cap Table */}
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
      </div>
    </Layout>
  );
}
