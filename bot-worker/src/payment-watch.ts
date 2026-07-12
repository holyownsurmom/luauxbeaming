/**
 * Watch fixed LTC/SOL wallets for matching invoice amounts and auto-confirm.
 */

const SITE_URL = process.env.SITE_URL!;
const WORKER_SECRET = process.env.WORKER_SECRET!;
const SOL_RPC =
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

const headers = {
  "Content-Type": "application/json",
  "x-worker-secret": WORKER_SECRET,
};

type PendingPayment = {
  id: string;
  pay_currency: string;
  pay_amount: number;
  pay_address: string;
  created_at: string;
  price_amount: number;
};

function amountMatch(expected: number, actual: number, currency: string): boolean {
  if (!expected || expected <= 0 || !actual || actual <= 0) return false;
  // Tight band only — never accept arbitrary overpay (would steal larger txs for cheap invoices)
  const tol =
    currency === "sol"
      ? Math.max(0.00005, expected * 0.005)
      : Math.max(0.00001, expected * 0.005);
  return Math.abs(actual - expected) <= tol;
}

async function fetchPending(): Promise<PendingPayment[]> {
  const res = await fetch(`${SITE_URL}/api/bots/worker/payments-pending`, {
    method: "GET",
    headers,
  });
  if (!res.ok) throw new Error(`payments-pending ${res.status}`);
  const data = (await res.json()) as { payments?: PendingPayment[] };
  return data.payments ?? [];
}

async function confirmPayment(
  payment_id: string,
  txid: string,
  confirmations: number,
  raw?: Record<string, unknown>,
) {
  const res = await fetch(`${SITE_URL}/api/bots/worker/payments-confirm`, {
    method: "POST",
    headers,
    body: JSON.stringify({ payment_id, txid, confirmations, raw }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`confirm ${res.status}: ${t}`);
  }
  return res.json();
}

async function findLtcTx(
  address: string,
  expected: number,
  createdAt: number,
): Promise<{ txid: string; amount: number; confirmations: number } | null> {
  const res = await fetch(
    `https://api.blockcypher.com/v1/ltc/main/addrs/${encodeURIComponent(address)}?limit=25`,
  );
  if (!res.ok) {
    console.warn("[pay-watch] blockcypher", res.status);
    return null;
  }
  const j = (await res.json()) as {
    txrefs?: Array<{
      tx_hash: string;
      value: number;
      confirmations: number;
      confirmed?: string;
      received?: string;
      tx_input_n?: number;
    }>;
  };
  const refs = j.txrefs ?? [];
  for (const r of refs) {
    // Only incoming (outputs to address)
    if (typeof r.tx_input_n === "number" && r.tx_input_n >= 0) continue;
    const amount = (r.value || 0) / 1e8;
    const ts = Date.parse(r.confirmed || r.received || "") || 0;
    // Allow txs from 5 min before invoice (clock skew)
    if (ts && ts < createdAt - 5 * 60 * 1000) continue;
    if (!amountMatch(expected, amount, "ltc")) continue;
    if ((r.confirmations ?? 0) < 1) continue;
    return {
      txid: r.tx_hash,
      amount,
      confirmations: r.confirmations ?? 1,
    };
  }
  return null;
}

async function solRpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`sol rpc ${res.status}`);
  const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (j.error) throw new Error(j.error.message || "sol rpc error");
  return j.result;
}

async function findSolTx(
  address: string,
  expected: number,
  createdAt: number,
): Promise<{ txid: string; amount: number; confirmations: number } | null> {
  const sigs = (await solRpc("getSignaturesForAddress", [
    address,
    { limit: 20 },
  ])) as Array<{ signature: string; blockTime?: number | null; err?: unknown }>;

  for (const s of sigs || []) {
    if (s.err) continue;
    const bt = (s.blockTime || 0) * 1000;
    if (bt && bt < createdAt - 5 * 60 * 1000) continue;

    const tx = (await solRpc("getTransaction", [
      s.signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
    ])) as {
      meta?: {
        preBalances?: number[];
        postBalances?: number[];
        err?: unknown;
      };
      transaction?: {
        message?: {
          accountKeys?: Array<string | { pubkey: string }>;
        };
      };
    } | null;

    if (!tx?.meta || tx.meta.err) continue;
    const keys = tx.transaction?.message?.accountKeys ?? [];
    const idx = keys.findIndex((k) => {
      const pk = typeof k === "string" ? k : k.pubkey;
      return pk === address;
    });
    if (idx < 0) continue;
    const pre = tx.meta.preBalances?.[idx] ?? 0;
    const post = tx.meta.postBalances?.[idx] ?? 0;
    const deltaLamports = post - pre;
    if (deltaLamports <= 0) continue;
    const amount = deltaLamports / 1e9;
    if (!amountMatch(expected, amount, "sol")) continue;
    return { txid: s.signature, amount, confirmations: 1 };
  }
  return null;
}

export async function scanPendingPayments() {
  let payments: PendingPayment[];
  try {
    payments = await fetchPending();
  } catch (e) {
    console.error("[pay-watch] list failed:", e);
    return;
  }
  if (!payments.length) return;

  console.log(`[pay-watch] checking ${payments.length} waiting payment(s)`);

  for (const p of payments) {
    try {
      const created = Date.parse(p.created_at) || Date.now() - 3600_000;
      const cur = String(p.pay_currency).toLowerCase();
      const expected = Number(p.pay_amount);
      const addr = p.pay_address;

      let hit: { txid: string; amount: number; confirmations: number } | null = null;
      if (cur === "ltc") hit = await findLtcTx(addr, expected, created);
      else if (cur === "sol") hit = await findSolTx(addr, expected, created);
      else continue;

      if (!hit) continue;

      console.log(
        `[pay-watch] match payment ${p.id}: ${hit.amount} ${cur} tx=${hit.txid}`,
      );
      await confirmPayment(p.id, hit.txid, hit.confirmations, {
        detected_amount: hit.amount,
        expected_amount: expected,
      });
      console.log(`[pay-watch] fulfilled ${p.id}`);
    } catch (e) {
      console.error(`[pay-watch] payment ${p.id} error:`, e);
    }
  }
}
