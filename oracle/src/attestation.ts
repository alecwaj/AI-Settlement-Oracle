import { createWalletClient, http, publicActions, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';

// Resolution attestation using EIP-712
export interface Resolution {
  marketId: `0x${string}`;
  outcome: `0x${string}`;
  timestamp: bigint;
  reasoning: string;
}

export interface Attestation {
  resolution: Resolution;
  signature: Hex;
}

const RESOLUTION_TYPES = {
  Resolution: [
    { name: 'marketId', type: 'bytes32' },
    { name: 'outcome', type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'reasoning', type: 'string' },
  ],
} as const;

export class AttestationSigner {
  private walletClient;
  private account;

  constructor(privateKey: Hex) {
    this.account = privateKeyToAccount(privateKey);
    this.walletClient = createWalletClient({
      account: this.account,
      chain: foundry,
      transport: http(),
    }).extend(publicActions);
  }

  getAddress(): `0x${string}` {
    return this.account.address;
  }

  async signResolution(resolution: Resolution): Promise<Hex> {
    const signature = await this.walletClient.signTypedData({
      domain: {
        name: 'SettlementOracle',
        version: '1',
        chainId: 31337n, // Foundry local chain
      },
      types: RESOLUTION_TYPES,
      primaryType: 'Resolution',
      message: resolution,
    });

    return signature;
  }

  async createAttestation(resolution: Resolution): Promise<Attestation> {
    const signature = await this.signResolution(resolution);
    return {
      resolution,
      signature,
    };
  }

  async verifyAttestation(
    attestation: Attestation,
    expectedSigner: `0x${string}`
  ): Promise<boolean> {
    try {
      const valid = await this.walletClient.verifyTypedData({
        domain: {
          name: 'SettlementOracle',
          version: '1',
          chainId: 31337n,
        },
        types: RESOLUTION_TYPES,
        primaryType: 'Resolution',
        message: attestation.resolution,
        address: expectedSigner,
        signature: attestation.signature,
      });
      return valid;
    } catch {
      return false;
    }
  }
}
