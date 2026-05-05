import { useState } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { EQUISHIELD_ADDRESS } from '@/lib/contract';
import EquiShieldABI from '@/abi/EquiShield.json';
import { encryptUint64, decryptUint64 } from '@/lib/fhevm';
import Layout from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Lock, Unlock, Loader2, Send } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const transferSchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
  amount: z.string().min(1, "Amount is required"),
});

export default function ShareholderPage() {
  const { address } = useAccount();
  const { toast } = useToast();
  const [decryptedShares, setDecryptedShares] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: mySharesHandle } = useReadContract({
    address: EQUISHIELD_ADDRESS,
    abi: EquiShieldABI,
    functionName: 'getMyShares',
    account: address,
  });

  const transferForm = useForm<z.infer<typeof transferSchema>>({
    resolver: zodResolver(transferSchema),
    defaultValues: { to: "", amount: "" },
  });

  async function handleDecrypt() {
    if (!address || !mySharesHandle || !window.ethereum) return;
    setIsDecrypting(true);
    try {
      const decrypted = await decryptUint64(mySharesHandle as bigint, EQUISHIELD_ADDRESS, address, window.ethereum);
      setDecryptedShares(decrypted.toString());
      toast({ title: "Decryption Successful", description: "Your shares are now visible." });
    } catch (err: any) {
      toast({ title: "Decryption Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsDecrypting(false);
    }
  }

  async function onTransferSubmit(data: z.infer<typeof transferSchema>) {
    if (!address) return toast({ title: "Wallet not connected", variant: "destructive" });
    try {
      const encryptedAmount = await encryptUint64(BigInt(data.amount), EQUISHIELD_ADDRESS, address);
      
      writeContract({
        address: EQUISHIELD_ADDRESS,
        abi: EquiShieldABI,
        functionName: 'transferShares',
        args: [
          data.to,
          encryptedAmount.handle,
          encryptedAmount.proof
        ],
      });
    } catch (err: any) {
      toast({ title: "Encryption failed", description: err.message, variant: "destructive" });
    }
  }

  return (
    <Layout>
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Shareholder Dashboard</h1>
          <p className="text-muted-foreground">View your encrypted position and manage your holdings.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
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
                    <div className="text-4xl font-bold font-mono text-foreground mb-2">{decryptedShares}</div>
                    <div className="text-sm text-muted-foreground uppercase tracking-widest">Decrypted Shares</div>
                    <Button variant="outline" size="sm" className="mt-4" onClick={() => setDecryptedShares(null)}>Hide</Button>
                  </div>
                ) : (
                  <div className="text-center">
                    <Lock className="w-12 h-12 text-primary/50 mx-auto mb-4" />
                    <div className="text-2xl font-bold font-mono text-muted-foreground mb-2 blur-sm select-none">******</div>
                    <div className="text-sm text-primary uppercase tracking-widest flex items-center justify-center gap-2 mb-6">
                      <Lock className="w-4 h-4" /> FHE Encrypted
                    </div>
                    <Button onClick={handleDecrypt} disabled={!mySharesHandle || isDecrypting}>
                      {isDecrypting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Unlock className="mr-2 h-4 w-4" />}
                      Decrypt Balance
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

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
                      <FormControl><Input type="number" placeholder="100" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="submit" disabled={isPending || isConfirming} className="w-full">
                    {isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Encrypt & Transfer
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
