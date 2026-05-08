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
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Search, FileText, AlertCircle, Info, ShieldCheck, ShieldOff } from 'lucide-react';

const OWNER_ADDRESS = "0xC552C59aE124d3d1f87d7C7E2B916F396DaB5485";

const auditSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address"),
});

type ShareholderStruct = readonly [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`, boolean];

export default function AuditPage() {
  const { address } = useAccount();
  const [targetAddress, setTargetAddress] = useState<`0x${string}` | null>(null);

  // Public view — anyone can call. Returns the full ShareHolder struct:
  // (holder: address, encryptedShares: bytes32, encryptedVestedShares: bytes32,
  //  encryptedPricePerShare: bytes32, isActive: bool)
  const { data: holderData, isError: holderError, isLoading: holderLoading } = useReadContract({
    address: EQUISHIELD_ADDRESS,
    abi: EquiShieldABI,
    functionName: 'shareholders',
    args: targetAddress ? [targetAddress] : undefined,
    query: { enabled: !!targetAddress },
  });

  // Note: regulatorView() is nonpayable (calls FHE.allow internally — state-changing).
  // It can only be called by the contract owner via a real transaction.
  // We display the raw encrypted handles from the public shareholders() mapping instead.

  const auditForm = useForm<z.infer<typeof auditSchema>>({
    resolver: zodResolver(auditSchema),
    defaultValues: { address: "" },
  });

  function onAuditSubmit(data: z.infer<typeof auditSchema>) {
    setTargetAddress(data.address as `0x${string}`);
  }

  const isPlaceholderContract = EQUISHIELD_ADDRESS === "0x0000000000000000000000000000000000000000";

  const structData = holderData as ShareholderStruct | undefined;
  const isActive   = structData?.[4] ?? false;
  const encShares  = structData?.[1];
  const encVested  = structData?.[2];
  const encPrice   = structData?.[3];
  const hasData    = !!structData;

  return (
    <Layout>
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Audit & Compliance</h1>
          <p className="text-muted-foreground">Verify on-chain shareholder status and encrypted ciphertext handles.</p>
        </div>

        {/* Contract wiring info */}
        <div className="bg-muted/30 border border-border/60 rounded-lg p-4 flex flex-col gap-2 text-xs font-mono max-w-2xl">
          <div className="flex items-center gap-2 text-muted-foreground font-sans text-sm font-medium mb-1">
            <Info className="w-4 h-4" /> Contract Wiring
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-24 shrink-0">Connected:</span>
            <span className="text-foreground break-all">{address ?? "Not connected"}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-24 shrink-0">Contract:</span>
            <span className={isPlaceholderContract ? "text-yellow-500" : "text-green-500"}>
              {EQUISHIELD_ADDRESS}
            </span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-24 shrink-0">Owner:</span>
            <span className="text-foreground break-all">{OWNER_ADDRESS}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-muted-foreground w-24 shrink-0">Network:</span>
            <span className="text-foreground">Ethereum Sepolia (chainId 11155111)</span>
          </div>
        </div>

        {/* Regulator note */}
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 max-w-2xl text-sm">
          <div className="flex items-start gap-3">
            <Info className="w-4 h-4 text-primary mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium text-primary">Regulator Access Note</p>
              <p className="text-muted-foreground">
                This page reads from the <span className="font-mono text-xs">shareholders()</span> public
                mapping — available to any caller without restrictions. It exposes the raw euint64 ciphertext
                handles stored on-chain for each holder.
              </p>
              <p className="text-muted-foreground">
                Full regulator access (<span className="font-mono text-xs">regulatorView()</span>) grants ACL
                decryption rights via <span className="font-mono text-xs">FHE.allow()</span> and requires
                connecting as the contract owner:
              </p>
              <p className="font-mono text-xs text-accent break-all">{OWNER_ADDRESS}</p>
            </div>
          </div>
        </div>

        {/* Lookup form */}
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Holder Lookup</CardTitle>
            <CardDescription>
              Enter a shareholder address to view their status and encrypted ciphertext handles.
              Actual share amounts remain hidden — only the cryptographic handles are shown.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...auditForm}>
              <form onSubmit={auditForm.handleSubmit(onAuditSubmit)} className="flex gap-4">
                <FormField
                  control={auditForm.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormControl>
                        <Input placeholder="0x..." className="font-mono" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit">
                  <Search className="w-4 h-4 mr-2" /> Lookup
                </Button>
              </form>
            </Form>

            {targetAddress && (
              <div className="mt-8 space-y-4">
                {holderLoading ? (
                  <div className="p-4 text-center text-muted-foreground">Querying blockchain...</div>
                ) : holderError ? (
                  <div className="p-4 bg-destructive/10 border border-destructive rounded flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-medium text-destructive">Query Failed</h4>
                      <p className="text-sm text-destructive/80 mt-1">
                        {isPlaceholderContract
                          ? "Contract not yet deployed. Deploy to Sepolia first."
                          : "Could not read holder data. Ensure the contract is deployed on Sepolia."}
                      </p>
                    </div>
                  </div>
                ) : hasData ? (
                  <div className="space-y-4">
                    {/* Active status */}
                    <div className="flex items-center gap-3">
                      {isActive ? (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-green-500/10 border border-green-500/30">
                          <ShieldCheck className="w-4 h-4 text-green-500" />
                          <span className="text-sm font-medium text-green-500">Active Shareholder</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-full bg-muted border border-border">
                          <ShieldOff className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium text-muted-foreground">Not a Shareholder</span>
                        </div>
                      )}
                    </div>

                    {isActive && (
                      <>
                        <h3 className="font-medium flex items-center gap-2 mt-2">
                          <FileText className="w-4 h-4 text-primary" />
                          Encrypted Ciphertext Handles for{' '}
                          {targetAddress.slice(0, 6)}...{targetAddress.slice(-4)}
                        </h3>

                        <div className="grid gap-3">
                          <div className="bg-card border border-border p-3 rounded font-mono text-xs overflow-x-auto">
                            <span className="text-muted-foreground mb-1 block">
                              encryptedShares (euint64 handle):
                            </span>
                            <span className="text-primary/80 break-all">{encShares ?? '—'}</span>
                          </div>
                          <div className="bg-card border border-border p-3 rounded font-mono text-xs overflow-x-auto">
                            <span className="text-muted-foreground mb-1 block">
                              encryptedVestedShares (euint64 handle):
                            </span>
                            <span className="text-primary/80 break-all">{encVested ?? '—'}</span>
                          </div>
                          <div className="bg-card border border-border p-3 rounded font-mono text-xs overflow-x-auto">
                            <span className="text-muted-foreground mb-1 block">
                              encryptedPricePerShare (euint64 handle):
                            </span>
                            <span className="text-primary/80 break-all">{encPrice ?? '—'}</span>
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground mt-2">
                          These are cryptographic ciphertext handles representing FHE-encrypted values on the
                          Zama FHEVM. The underlying amounts are mathematically hidden — they cannot be derived
                          from these handles without the FHE private key held by the Zama KMS.
                          Decryption requires an authorized re-encryption request signed by the holder.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="p-4 text-center text-muted-foreground text-sm">
                    Address not found in the shareholder registry.
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
