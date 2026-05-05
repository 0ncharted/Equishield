import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Link } from 'wouter';
import { Shield, ChevronRight } from 'lucide-react';

export default function IndexPage() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="bg-primary text-primary-foreground text-center py-2 px-4 text-xs font-mono font-medium tracking-wide">
        Built on Zama Protocol — All equity data is FHE-encrypted
      </div>
      
      <header className="border-b border-border/50 py-4 px-8 flex justify-between items-center">
        <div className="flex items-center gap-2 text-primary font-mono font-bold tracking-tight">
          <Shield className="w-5 h-5" />
          <span>EQUISHIELD</span>
        </div>
        <ConnectButton />
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-8 max-w-4xl mx-auto w-full">
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 tracking-tight">Confidential Cap Table Management</h1>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Institutional-grade equity tracking built on Fully Homomorphic Encryption.
            Your cap table remains mathematically hidden while verifiable on-chain.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
          <Link href="/admin" className="block group">
            <div className="border border-border bg-card hover:bg-muted/50 p-6 rounded-lg transition-all h-full">
              <h2 className="text-xl font-semibold mb-2 flex items-center justify-between">
                Admin Dashboard
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </h2>
              <p className="text-muted-foreground text-sm">Issue shares, manage vesting, and create governance proposals.</p>
            </div>
          </Link>
          
          <Link href="/shareholder" className="block group">
            <div className="border border-border bg-card hover:bg-muted/50 p-6 rounded-lg transition-all h-full">
              <h2 className="text-xl font-semibold mb-2 flex items-center justify-between">
                Shareholder View
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </h2>
              <p className="text-muted-foreground text-sm">Decrypt your holdings, transfer shares, and vote on proposals.</p>
            </div>
          </Link>
          
          <Link href="/investor" className="block group">
            <div className="border border-border bg-card hover:bg-muted/50 p-6 rounded-lg transition-all h-full">
              <h2 className="text-xl font-semibold mb-2 flex items-center justify-between">
                Investor View
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </h2>
              <p className="text-muted-foreground text-sm">Track your vested amounts and portfolio performance.</p>
            </div>
          </Link>
          
          <Link href="/audit" className="block group">
            <div className="border border-border bg-card hover:bg-muted/50 p-6 rounded-lg transition-all h-full">
              <h2 className="text-xl font-semibold mb-2 flex items-center justify-between">
                Audit & Compliance
                <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
              </h2>
              <p className="text-muted-foreground text-sm">Regulatory overview of FHE-encrypted events and metadata.</p>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
