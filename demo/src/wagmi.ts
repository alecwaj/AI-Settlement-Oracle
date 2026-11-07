import { createConfig, http } from 'wagmi'
import { foundry } from 'wagmi/chains'
import { getDefaultConfig } from '@rainbow-me/rainbowkit'

export const config = getDefaultConfig({
  appName: 'AI Settlement Oracle',
  projectId: 'YOUR_PROJECT_ID', // Get from WalletConnect
  chains: [foundry],
  transports: {
    [foundry.id]: http('http://localhost:8545'),
  },
})
