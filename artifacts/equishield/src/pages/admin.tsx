import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { EQUISHIELD_ADDRESS } from '@/lib/contract';
import EquiShieldABI from '@/abi/EquiShield.json';
import { encryptUint64 } from '@/lib/fhevm';
import Layout from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Lock, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
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

export default function AdminPage() {
  const { address } = useAccount();
  const { toast } = useToast();
  const { writeContract, data: txHash, error: txError, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

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
      const encryptedShares = await encryptUint64(BigInt(data.shares), EQUISHIELD_ADDRESS, address);
      const encryptedPrice = await encryptUint64(BigInt(data.price), EQUISHIELD_ADDRESS, address);
      
      writeContract({
        address: EQUISHIELD_ADDRESS,
        abi: EquiShieldABI,
        functionName: 'issueShares',
        args: [
          data.holder,
          encryptedShares.handle,
          encryptedShares.proof,
          encryptedPrice.handle,
          encryptedPrice.proof
        ],
      });
    } catch (err: any) {
      toast({ title: "Encryption failed", description: err.message, variant: "destructive" });
    }
  }

  async function onVestSubmit(data: z.infer<typeof vestSharesSchema>) {
    if (!address) return toast({ title: "Wallet not connected", variant: "destructive" });
    try {
      const encryptedAmount = await encryptUint64(BigInt(data.amount), EQUISHIELD_ADDRESS, address);
      
      writeContract({
        address: EQUISHIELD_ADDRESS,
        abi: EquiShieldABI,
        functionName: 'vestShares',
        args: [
          data.holder,
          encryptedAmount.handle,
          encryptedAmount.proof
        ],
      });
    } catch (err: any) {
      toast({ title: "Encryption failed", description: err.message, variant: "destructive" });
    }
  }

  useEffect(() => {
    if (isConfirmed) {
      toast({ title: "Transaction Confirmed", description: "The operation was successful on-chain." });
      issueForm.reset();
      vestForm.reset();
    }
  }, [isConfirmed, toast, issueForm, vestForm]);

  if (owner && address && owner !== address) {
    return (
      <Layout>
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="pt-6 flex flex-col items-center">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-xl font-bold text-destructive mb-2">Access Denied</h2>
            <p className="text-muted-foreground text-center">You are not the contract owner. Only the admin can access this dashboard.</p>
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
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <Card>
            <CardHeader>
              <CardTitle>Issue New Shares</CardTitle>
              <CardDescription>Grant encrypted shares to a new or existing holder.</CardDescription>
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
                        <FormControl><Input type="number" placeholder="1000" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={issueForm.control} name="price" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Price Per Share (USD)</FormLabel>
                        <FormControl><Input type="number" placeholder="10" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                  <Button type="submit" disabled={isPending || isConfirming} className="w-full">
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                    Encrypt & Issue
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
                      <FormControl><Input type="number" placeholder="500" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" disabled={isPending || isConfirming} variant="secondary" className="w-full">
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                    Encrypt & Vest
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex justify-between items-center">
              <span>Cap Table Overview</span>
              <span className="text-sm font-normal text-muted-foreground">Total Holders: {Number(shareholderCount || 0)}</span>
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
                {Number(shareholderCount || 0) === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">No shareholders yet.</TableCell>
                  </TableRow>
                ) : (
                  <TableRow>
                    <TableCell className="font-mono text-sm">0x... (Data fetching TBD)</TableCell>
                    <TableCell><div className="flex items-center gap-1 text-primary"><Lock className="w-3 h-3"/> Encrypted</div></TableCell>
                    <TableCell><div className="flex items-center gap-1 text-primary"><Lock className="w-3 h-3"/> Encrypted</div></TableCell>
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
