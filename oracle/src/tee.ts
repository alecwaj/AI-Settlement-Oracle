/**
 * TEE identity: where the oracle's signing key lives and how it proves that.
 *
 * dstack mode (production): runs inside an Intel TDX confidential VM managed by dstack / Phala Cloud.
 *   - The secp256k1 signing key is *derived inside the enclave* by the dstack guest agent from the
 *     app's KMS root. It never exists outside the CVM, and the host/operator cannot read it.
 *   - At boot we request a TDX quote whose 64-byte report_data commits to the signer address. The quote
 *     is signed by Intel-rooted hardware keys and contains the measurements (MRTD, RTMR0-3) of the
 *     exact VM image + docker-compose that is running. Verifying the quote therefore proves:
 *     "this address belongs to an enclave running this exact code".
 *   - Each resolution also gets its own quote with report_data = the EIP-712 digest that was signed.
 *
 * dev mode (local only): a private key from the environment and no quote. Every API response and the
 * UI label this clearly as NOT running in a TEE.
 */
import { DstackClient, type GetQuoteResponse } from '@phala/dstack-sdk';
import { toViemAccountSecure } from '@phala/dstack-sdk/viem';
import { privateKeyToAccount, type LocalAccount } from 'viem/accounts';
import { concat, keccak256, toBytes, toHex, type Address, type Hex } from 'viem';
import type { OracleConfig } from './config.js';

export const SIGNER_KEY_PATH = 'ai-settlement-oracle/resolution-signer/v1';
const REPORT_DATA_DOMAIN = 'ai-settlement-oracle:signer:v1';

export interface Quote {
  quote: Hex;
  eventLog: string;
  reportData: Hex;
  quoteHash: Hex; // keccak256(quote) — the value registered on-chain
}

export interface AttestationInfo {
  mode: 'tdx' | 'tdx-simulator' | 'dev';
  inTee: boolean;
  signer: Address;
  bootQuote: Quote | null;
  appId: string | null;
  instanceId: string | null;
  composeHash: Hex | null;
  appCompose: string | null;
  tcb: { mrtd: string; rtmr0: string; rtmr1: string; rtmr2: string; rtmr3: string } | null;
  keyPath: string | null;
  verification: string[];
}

/** report_data for the boot quote: keccak256("ai-settlement-oracle:signer:v1" ‖ signerAddress), right-padded to 64 bytes. */
export function signerReportData(signer: Address): Hex {
  const commitment = keccak256(concat([toBytes(REPORT_DATA_DOMAIN), toBytes(signer)]));
  return toHex(concat([toBytes(commitment), new Uint8Array(32)]));
}

function toQuote(res: GetQuoteResponse, reportData: Hex): Quote {
  const quote = (res.quote.startsWith('0x') ? res.quote : `0x${res.quote}`) as Hex;
  return { quote, eventLog: res.event_log, reportData, quoteHash: keccak256(quote) };
}

export class TeeIdentity {
  private constructor(
    readonly account: LocalAccount,
    readonly info: AttestationInfo,
    private readonly client: DstackClient | null,
  ) {}

  get inTee(): boolean {
    return this.info.inTee;
  }

  static async init(cfg: OracleConfig): Promise<TeeIdentity> {
    if (cfg.teeMode === 'dev') {
      if (!cfg.devPrivateKey) throw new Error('TEE_MODE=dev requires ORACLE_DEV_PRIVATE_KEY');
      const account = privateKeyToAccount(cfg.devPrivateKey);
      console.warn('⚠️  TEE_MODE=dev — signing key comes from the environment. This is NOT running in a TEE.');
      return new TeeIdentity(
        account,
        {
          mode: 'dev',
          inTee: false,
          signer: account.address,
          bootQuote: null,
          appId: null,
          instanceId: null,
          composeHash: null,
          appCompose: null,
          tcb: null,
          keyPath: null,
          verification: ['Dev mode: no hardware attestation. Do not register this signer on a production contract.'],
        },
        null,
      );
    }

    const client = new DstackClient();
    if (!(await client.isReachable())) {
      throw new Error(
        'dstack guest agent not reachable. Inside a CVM mount /var/run/dstack.sock; locally set DSTACK_SIMULATOR_ENDPOINT or use TEE_MODE=dev.',
      );
    }
    const simulated = Boolean(process.env.DSTACK_SIMULATOR_ENDPOINT);

    const key = await client.getKey(SIGNER_KEY_PATH, 'ethereum');
    const account = toViemAccountSecure(key);
    const reportData = signerReportData(account.address);
    const bootQuote = toQuote(await client.getQuote(toBytes(reportData)), reportData);
    const meta = await client.info();

    // Extend RTMR3 with the signer address so it's part of the measured event log as well.
    await client.emitEvent('ai-settlement-oracle.signer', account.address).catch(() => undefined);

    console.log(`🔐 TEE identity ready (${simulated ? 'dstack SIMULATOR' : 'Intel TDX'}) — signer ${account.address}`);
    return new TeeIdentity(
      account,
      {
        mode: simulated ? 'tdx-simulator' : 'tdx',
        inTee: !simulated,
        signer: account.address,
        bootQuote,
        appId: meta.app_id,
        instanceId: meta.instance_id,
        composeHash: (meta.compose_hash ? `0x${meta.compose_hash.replace(/^0x/, '')}` : null) as Hex | null,
        appCompose: meta.tcb_info?.app_compose ?? null,
        tcb: meta.tcb_info
          ? {
              mrtd: meta.tcb_info.mrtd,
              rtmr0: meta.tcb_info.rtmr0,
              rtmr1: meta.tcb_info.rtmr1,
              rtmr2: meta.tcb_info.rtmr2,
              rtmr3: meta.tcb_info.rtmr3,
            }
          : null,
        keyPath: SIGNER_KEY_PATH,
        verification: [
          '1. Verify bootQuote.quote is a valid Intel TDX quote (e.g. https://proof.t16z.com or dcap-qvl).',
          '2. Check the quote report_data equals signerReportData(signer) — this binds the key to the enclave.',
          '3. Check composeHash / RTMR3 matches the docker-compose.yml + image digest published in the repo.',
          '4. Check the contract: enclaveSigners(signer) is active with quoteHash == keccak256(bootQuote.quote).',
        ],
      },
      client,
    );
  }

  /** A fresh quote whose report_data is the 32-byte EIP-712 digest of a resolution (null in dev mode). */
  async quoteForDigest(digest: Hex): Promise<Quote | null> {
    if (!this.client) return null;
    const reportData = toHex(concat([toBytes(digest), new Uint8Array(32)]));
    return toQuote(await this.client.getQuote(toBytes(reportData)), reportData);
  }
}
