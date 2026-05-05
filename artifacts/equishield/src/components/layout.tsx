import { ReactNode } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { Link } from 'wouter';
import { Shield } from 'lucide-react';
import { useFhevmStatus } from '@/hooks/useFhevmStatus';

export default function Layout({ children }: { children: ReactNode }) {
  const fheStatus = useFhevmStatus();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="bg-primary text-primary-foreground text-center py-2 px-4 text-xs font-mono font-medium tracking-wide">
        Built on Zama Protocol — All equity data is FHE-encrypted
      </div>

      <header className="border-b border-border/50 py-4 px-8 flex justify-between items-center bg-card">
        <Link href="/" className="flex items-center gap-2 text-primary font-mono font-bold tracking-tight hover:opacity-80 transition-opacity">
          <Shield className="w-5 h-5" />
          <span>EQUISHIELD</span>
        </Link>

        <div className="flex items-center gap-4">
          <nav className="hidden md:flex items-center gap-6 mr-4 text-sm font-medium">
            <Link href="/admin" className="text-muted-foreground hover:text-primary transition-colors">Admin</Link>
            <Link href="/shareholder" className="text-muted-foreground hover:text-primary transition-colors">Shareholder</Link>
            <Link href="/investor" className="text-muted-foreground hover:text-primary transition-colors">Investor</Link>
            <Link href="/audit" className="text-muted-foreground hover:text-primary transition-colors">Audit</Link>
          </nav>

          <div className="flex items-center gap-1.5 text-xs font-mono px-2 py-1 rounded-md border border-border/60 bg-background">
            {fheStatus === 'ready' ? (
              <>
                <span className="w-2 h-2 rounded-full bg-green-500 animate-none" />
                <span className="text-green-500">FHE Ready</span>
              </>
            ) : fheStatus === 'error' ? (
              <>
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-red-500">FHE Error</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                <span className="text-yellow-500">FHE Init...</span>
              </>
            )}
          </div>

          <ConnectButton />
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto p-8">
        {children}
      </main>
    </div>
  );
}
