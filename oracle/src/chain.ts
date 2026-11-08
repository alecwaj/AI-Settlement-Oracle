import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseEventLogs,
  type Account,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Transport,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  MARKET_STATUS,
  OUTCOME,
  rulesHashFor,
  rulesTextFor,
  settlementOracleAbi,
  type Address,
  type Hex,
  type MarketSpec,
  type MarketStatus,
  type Outcome,
} from '@oracle/shared';

export class ChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainError';
  }
}

export interface OnChainMarket {
  marketId: bigint;
  question: string;
  rules: string;
  rulesHash: Hex;
  resolutionTime: bigint;
  confidenceThresholdBps: number;
  status: MarketStatus;
  outcome: Outcome;
  delayCount: number;
  delayedUntil: bigint;
  attempts: number;
}

export interface ChainContext {
  chain: Chain;
  publicClient: PublicClient;
  deployer: WalletClient<Transport, Chain, Account>;
  oracleAccount: Account;
  contract: Address;
  /** market slug → on-chain id */
  marketIds: Map<string, bigint>;
}

interface DeploymentFile {
  chainId: number;
  contract: Address;
  markets: Record<string, string>;
}

function loadArtifactBytecode(outDir: string): Hex {
  const path = join(outDir, 'SettlementOracle.sol', 'SettlementOracle.json');
  if (!existsSync(path)) {
    throw new ChainError(`contract artifact not found at ${path}; run "forge build" in contracts/ first`);
  }
  const artifact = JSON.parse(readFileSync(path, 'utf8')) as { bytecode?: { object?: string } };
  const bytecode = artifact.bytecode?.object;
  if (!bytecode || bytecode === '0x') throw new ChainError('contract artifact has no bytecode');
  return bytecode as Hex;
}

export interface BootstrapOptions {
  rpcUrl: string;
  deployerKey: Hex;
  oracleKey: Hex;
  contractAddress: Hex | undefined;
  retryDelaySeconds: number;
  dataDir: string;
  contractsOutDir: string;
  markets: MarketSpec[];
  log: (msg: string) => void;
}

/**
 * Connects to the chain, deploys SettlementOracle if needed (local chains only), makes sure the
 * oracle key is authorized and registers every market's rules on-chain.
 */
export async function bootstrapChain(opts: BootstrapOptions): Promise<ChainContext> {
  const probe = createPublicClient({ transport: http(opts.rpcUrl) });
  let chainId: number;
  try {
    chainId = await probe.getChainId();
  } catch {
    throw new ChainError(`cannot reach an Ethereum node at ${opts.rpcUrl} (start one with "anvil")`);
  }
  const chain = defineChain({
    id: chainId,
    name: chainId === 31337 ? 'Anvil' : `chain-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [opts.rpcUrl] } },
  });
  const publicClient = createPublicClient({ chain, transport: http(opts.rpcUrl) }) as PublicClient;
  const deployer = createWalletClient({ chain, transport: http(opts.rpcUrl), account: privateKeyToAccount(opts.deployerKey) });
  const oracleAccount = privateKeyToAccount(opts.oracleKey);

  mkdirSync(opts.dataDir, { recursive: true });
  const deploymentPath = join(opts.dataDir, `deployment.${chainId}.json`);
  let deployment: DeploymentFile | null = existsSync(deploymentPath)
    ? (JSON.parse(readFileSync(deploymentPath, 'utf8')) as DeploymentFile)
    : null;

  let contract: Address | undefined = opts.contractAddress ?? deployment?.contract;
  if (contract) {
    const code = await publicClient.getCode({ address: contract });
    if (!code || code === '0x') {
      if (opts.contractAddress) throw new ChainError(`no contract code at CONTRACT_ADDRESS ${contract}`);
      opts.log(`No contract at ${contract} (chain was reset); redeploying`);
      contract = undefined;
      deployment = null;
    }
  }

  if (!contract) {
    if (chainId !== 31337) {
      throw new ChainError('automatic deployment is only done on a local Anvil chain; set CONTRACT_ADDRESS');
    }
    const hash = await deployer.deployContract({
      abi: settlementOracleAbi,
      bytecode: loadArtifactBytecode(opts.contractsOutDir),
      args: [oracleAccount.address, BigInt(opts.retryDelaySeconds)],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new ChainError('deployment receipt has no contract address');
    contract = receipt.contractAddress;
    deployment = { chainId, contract, markets: {} };
    opts.log(`Deployed SettlementOracle at ${contract}`);
  }

  const authorized = await publicClient.readContract({
    address: contract,
    abi: settlementOracleAbi,
    functionName: 'authorizedOracles',
    args: [oracleAccount.address],
  });
  if (!authorized) {
    const owner = await publicClient.readContract({ address: contract, abi: settlementOracleAbi, functionName: 'owner' });
    if (owner.toLowerCase() !== deployer.account.address.toLowerCase()) {
      throw new ChainError(`oracle ${oracleAccount.address} is not authorized and the deployer key is not the owner`);
    }
    const hash = await deployer.writeContract({
      address: contract,
      abi: settlementOracleAbi,
      functionName: 'setOracle',
      args: [oracleAccount.address, true],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    opts.log(`Authorized oracle signer ${oracleAccount.address}`);
  }

  const marketIds = new Map<string, bigint>();
  const saved = deployment?.contract === contract ? deployment.markets : {};
  for (const spec of opts.markets) {
    const expectedHash = rulesHashFor(spec);
    const savedId = saved[spec.slug];
    if (savedId) {
      try {
        const m = await publicClient.readContract({
          address: contract,
          abi: settlementOracleAbi,
          functionName: 'getMarket',
          args: [BigInt(savedId)],
        });
        if (m.rulesHash === expectedHash) {
          marketIds.set(spec.slug, BigInt(savedId));
          continue;
        }
        opts.log(`Rules for ${spec.slug} changed; registering a new market`);
      } catch {
        opts.log(`Market ${savedId} for ${spec.slug} not found; registering it`);
      }
    }
    const hash = await deployer.writeContract({
      address: contract,
      abi: settlementOracleAbi,
      functionName: 'createMarket',
      args: [
        spec.question,
        rulesTextFor(spec),
        BigInt(Math.floor(Date.parse(spec.resolutionTime) / 1000)),
        Math.round(spec.confidenceThreshold * 10_000),
      ],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const [created] = parseEventLogs({ abi: settlementOracleAbi, eventName: 'MarketCreated', logs: receipt.logs });
    if (!created) throw new ChainError(`createMarket for ${spec.slug} emitted no MarketCreated event`);
    marketIds.set(spec.slug, created.args.marketId);
    opts.log(`Registered market ${spec.slug} as #${created.args.marketId}`);
  }

  const file: DeploymentFile = {
    chainId,
    contract,
    markets: Object.fromEntries([...marketIds].map(([k, v]) => [k, v.toString()])),
  };
  writeFileSync(deploymentPath, JSON.stringify(file, null, 2));

  return { chain, publicClient, deployer, oracleAccount, contract, marketIds };
}

export async function readMarket(ctx: ChainContext, marketId: bigint): Promise<OnChainMarket> {
  const m = await ctx.publicClient.readContract({
    address: ctx.contract,
    abi: settlementOracleAbi,
    functionName: 'getMarket',
    args: [marketId],
  });
  return {
    marketId,
    question: m.question,
    rules: m.rules,
    rulesHash: m.rulesHash,
    resolutionTime: m.resolutionTime,
    confidenceThresholdBps: m.confidenceThresholdBps,
    status: MARKET_STATUS[m.status] ?? 'NONE',
    outcome: OUTCOME[m.outcome] ?? 'NONE',
    delayCount: m.delayCount,
    delayedUntil: m.delayedUntil,
    attempts: m.attempts,
  };
}

export async function chainTime(ctx: ChainContext): Promise<bigint> {
  const block = await ctx.publicClient.getBlock();
  return block.timestamp;
}
