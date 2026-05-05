import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { sepolia } from "wagmi/chains";
import { http } from "wagmi";

export const SEPOLIA_CHAIN_ID = 11155111;

// Use public Sepolia RPC endpoints that allow CORS from browser
// User can set VITE_INFURA_API_KEY to use Infura instead
const sepoliaTransport = import.meta.env.VITE_INFURA_API_KEY
  ? http(`https://sepolia.infura.io/v3/${import.meta.env.VITE_INFURA_API_KEY}`)
  : http("https://ethereum-sepolia-rpc.publicnode.com");

export const wagmiConfig = getDefaultConfig({
  appName: "EquiShield — FHE Cap Table",
  projectId: "b5d67a6b4c8a1234567890abcdef1234",
  chains: [sepolia],
  transports: { [sepolia.id]: sepoliaTransport },
  ssr: false,
});

export { sepolia };
