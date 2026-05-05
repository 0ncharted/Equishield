import { useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { EQUISHIELD_ADDRESS } from '@/lib/contract';
import EquiShieldABI from '@/abi/EquiShield.json';
import Layout from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, FileText, AlertCircle } from 'lucide-react';

const auditSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
});

export default function AuditPage() {
  const { address } = useAccount();
  const [targetAddress, setTargetAddress] = useState<string | null>(null);

  const { data: regulatorData, isError, isLoading } = useReadContract({
    address: EQUISHIELD_ADDRESS,
    abi: EquiShieldABI,
    functionName: 'regulatorView',
    args: targetAddress ? [targetAddress as `0x${string}`] : undefined,
    query: {
      enabled: !!targetAddress,
    }
  });

  const auditForm = useForm<z.infer<typeof auditSchema>>({
    resolver: zodResolver(auditSchema),
    defaultValues: { address: "" },
  });

  function onAuditSubmit(data: z.infer<typeof auditSchema>) {
    setTargetAddress(data.address);
  }

  const [encShares, encVested, encPrice] = (regulatorData as [bigint, bigint, bigint]) || [null, null, null];

  return (
    <Layout>
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Audit & Compliance</h1>
          <p className="text-muted-foreground">Authorized regulators can verify on-chain metadata.</p>
        </div>

        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Verify Holder Identity</CardTitle>
            <CardDescription>Input a shareholder address to view their FHE ciphertexts. Actual amounts remain encrypted.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...auditForm}>
              <form onSubmit={auditForm.handleSubmit(onAuditSubmit)} className="flex gap-4">
                <FormField control={auditForm.control} name="address" render={({ field }) => (
                  <FormItem className="flex-1">
                    <FormControl><Input placeholder="0x..." className="font-mono" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <Button type="submit">
                  <Search className="w-4 h-4 mr-2" /> Lookup
                </Button>
              </form>
            </Form>

            {targetAddress && (
              <div className="mt-8 space-y-4">
                {isLoading ? (
                  <div className="p-4 text-center text-muted-foreground">Querying blockchain...</div>
                ) : isError ? (
                  <div className="p-4 bg-destructive/10 border border-destructive rounded flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-destructive">Query Failed</h4>
                      <p className="text-sm text-destructive/80">Are you authorized as a regulator? Or the address might not be a shareholder.</p>
                    </div>
                  </div>
                ) : regulatorData ? (
                  <div className="space-y-4">
                    <h3 className="font-medium flex items-center gap-2">
                      <FileText className="w-4 h-4 text-primary" /> On-Chain Ciphertexts for {targetAddress.slice(0, 6)}...{targetAddress.slice(-4)}
                    </h3>
                    
                    <div className="grid gap-3">
                      <div className="bg-card border border-border p-3 rounded font-mono text-xs overflow-x-auto">
                        <span className="text-muted-foreground mb-1 block">Encrypted Total Shares (euint64 handle):</span>
                        <span className="text-primary/80 break-all">{encShares?.toString() || '0'}</span>
                      </div>
                      
                      <div className="bg-card border border-border p-3 rounded font-mono text-xs overflow-x-auto">
                        <span className="text-muted-foreground mb-1 block">Encrypted Vested Shares (euint64 handle):</span>
                        <span className="text-primary/80 break-all">{encVested?.toString() || '0'}</span>
                      </div>

                      <div className="bg-card border border-border p-3 rounded font-mono text-xs overflow-x-auto">
                        <span className="text-muted-foreground mb-1 block">Encrypted Price/Share (euint64 handle):</span>
                        <span className="text-primary/80 break-all">{encPrice?.toString() || '0'}</span>
                      </div>
                    </div>
                    
                    <p className="text-xs text-muted-foreground mt-4">
                      Note: These are cryptographic handles representing fully homomorphic encrypted values. 
                      They can be used for zero-knowledge proofs and compliance verification without exposing the underlying amounts.
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
