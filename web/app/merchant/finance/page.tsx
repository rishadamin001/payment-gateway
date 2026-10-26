"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { merchantCall } from "../page";
import {
  BillingError,
  BillingShell,
  localDate,
  paisa,
  taka,
} from "../links/billing-ui";
import "./finance.css";

type Entry = {
  account: string;
  side: "DEBIT" | "CREDIT";
  amount_paisa: number;
};
type Settlement = {
  id: string;
  amount_paisa: number;
  status: "READY" | "PAID_OUT";
  created_at: string;
  payout_id: string | null;
};
type Payout = {
  id: string;
  settlement_id: string;
  amount_paisa: number;
  status: string;
  created_at: string;
};
type Finance = {
  balances: {
    available_paisa: number;
    reserved_paisa: number;
    clearing_paisa: number;
  };
  settlements: Settlement[];
  payouts: Payout[];
  journals: {
    id: string;
    source_type: string;
    source_id: string;
    amount_paisa: number;
    created_at: string;
    entries: Entry[];
  }[];
};
type Reconciliation = {
  status: "MATCHED" | "REVIEW_REQUIRED";
  payment_total_paisa: number;
  refund_total_paisa: number;
  ledger_payment_paisa: number;
  ledger_refund_paisa: number;
  payout_total_paisa: number;
  clearing_paisa: number;
  expected_clearing_paisa: number;
  imbalance_paisa: number;
  unknown_legacy_refunds: number;
  discrepancies: string[];
};

export default function FinancePage() {
  const [finance, setFinance] = useState<Finance | null>(null);
  const [report, setReport] = useState<Reconciliation | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(""),
    [amount, setAmount] = useState("");
  const settlementAttempt = useRef<{ body: string; key: string } | null>(null);
  const payoutAttempts = useRef(new Map<string, string>());
  const load = useCallback(async () => {
    const [nextFinance, nextReport] = await Promise.all([
      merchantCall("finance"),
      merchantCall("finance/reconciliation"),
    ]);
    setFinance(nextFinance);
    setReport(nextReport);
  }, []);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      merchantCall("finance"),
      merchantCall("finance/reconciliation"),
    ])
      .then(([nextFinance, nextReport]) => {
        if (!cancelled) {
          setFinance(nextFinance);
          setReport(nextReport);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function settle(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setNotice("");
    try {
      const body = amount.trim() ? { amount_paisa: paisa(amount.trim()) } : {};
      const serialized = JSON.stringify(body);
      if (
        !settlementAttempt.current ||
        settlementAttempt.current.body !== serialized
      )
        settlementAttempt.current = {
          body: serialized,
          key: crypto.randomUUID(),
        };
      setBusy("settlement");
      await merchantCall(
        "finance/settlements",
        body,
        settlementAttempt.current.key,
      );
      await load();
      settlementAttempt.current = null;
      setAmount("");
      setNotice(
        "Simulated settlement created. Its reserved balance is ready for a demo payout.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function payout(id: string) {
    if (busy) return;
    setError("");
    setNotice("");
    setBusy(id);
    if (!payoutAttempts.current.has(id))
      payoutAttempts.current.set(id, crypto.randomUUID());
    try {
      await merchantCall(
        `finance/settlements/${id}/payout`,
        {},
        payoutAttempts.current.get(id),
      );
      await load();
      payoutAttempts.current.delete(id);
      setNotice(
        "Simulated payout recorded. No bank or wallet was contacted and no money moved.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <BillingShell title="Ledger, settlements & payouts">
      <BillingError message={error} />
      {notice && <p role="status">{notice}</p>}
      <p>
        Follow the fictional money from successful payment to refund, settlement
        and payout. All balances are demo balances.
      </p>
      <button
        className="button secondary"
        disabled={!!busy}
        onClick={() => {
          setError("");
          void load().catch((e) => setError(e.message));
        }}
      >
        Refresh finance
      </button>
      {!finance && !error && <p>Loading finance…</p>}
      {finance && (
        <>
          <section
            className="merchant-metrics finance-metrics"
            aria-label="Demo balances"
          >
            <article>
              <small>Available for settlement</small>
              <h2 data-balance="available">
                {taka(finance.balances.available_paisa)}
              </h2>
            </article>
            <article>
              <small>Reserved for payout</small>
              <h2 data-balance="reserved">
                {taka(finance.balances.reserved_paisa)}
              </h2>
            </article>
            <article>
              <small>Remaining clearing balance</small>
              <h2 data-balance="clearing">
                {taka(finance.balances.clearing_paisa)}
              </h2>
            </article>
          </section>
          {finance.balances.available_paisa < 0 && (
            <p className="finance-caution">
              Refunds after settlement can make the available balance negative.
              New settlements require a positive available balance.
            </p>
          )}
          <section className="merchant-card">
            <h2>Create a simulated settlement</h2>
            <p>
              A settlement reserves available funds. A separate simulated payout
              completes it. No bank details are needed.
            </p>
            <form className="finance-settle" onSubmit={settle}>
              <label>
                Settlement amount (taka, blank = all available)
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="All available demo funds"
                />
              </label>
              <button
                className="button primary"
                disabled={
                  !!busy ||
                  finance.balances.available_paisa <= 0 ||
                  !!report?.unknown_legacy_refunds
                }
              >
                {busy === "settlement"
                  ? "Creating settlement…"
                  : "Create simulated settlement"}
              </button>
            </form>
            {!!report?.unknown_legacy_refunds && (
              <p className="finance-caution">
                Older partial refunds have no recorded amount. Settlements are
                blocked until those amounts can be established; PayBD will not
                guess them.
              </p>
            )}
          </section>
          {report && (
            <section
              className="merchant-card"
              aria-label="Reconciliation report"
            >
              <header>
                <h2>Reconciliation report</h2>
                <strong
                  className={`finance-report ${report.status === "MATCHED" ? "matched" : "review"}`}
                  data-reconciliation-status={report.status}
                >
                  {report.status === "MATCHED" ? "MATCHED" : "REVIEW REQUIRED"}
                </strong>
              </header>
              <p>
                Compares source payments and refunds with the ledger. Unpaid,
                failed, cancelled and expired requests have no financial
                posting.
              </p>
              <div className="merchant-table">
                <table>
                  <thead>
                    <tr>
                      <th>Measure</th>
                      <th>Source records</th>
                      <th>Ledger</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th>Successful payments</th>
                      <td>{taka(report.payment_total_paisa)}</td>
                      <td>{taka(report.ledger_payment_paisa)}</td>
                    </tr>
                    <tr>
                      <th>Known refunds</th>
                      <td>{taka(report.refund_total_paisa)}</td>
                      <td>{taka(report.ledger_refund_paisa)}</td>
                    </tr>
                    <tr>
                      <th>Clearing after refunds and payouts</th>
                      <td>{taka(report.expected_clearing_paisa)}</td>
                      <td>{taka(report.clearing_paisa)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                Payout total: {taka(report.payout_total_paisa)} · Debit/credit
                difference: {taka(report.imbalance_paisa)}
              </p>
              <p>
                Legacy partial refunds with unknown amounts:{" "}
                <strong>{report.unknown_legacy_refunds}</strong>
              </p>
              {report.discrepancies.length ? (
                <ul className="finance-caution">
                  {report.discrepancies.map((item, index) => (
                    <li key={index}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>
                  {report.status === "MATCHED"
                    ? "All recorded totals agree."
                    : "Review is required before treating these balances as reconciled."}
                </p>
              )}
            </section>
          )}
          <section className="merchant-card">
            <h2>Settlement history</h2>
            {!finance.settlements.length ? (
              <p>
                No settlements yet. Complete a demo payment to create an
                available balance.
              </p>
            ) : (
              <div className="finance-list">
                {finance.settlements.map((settlement) => (
                  <article
                    className="finance-history"
                    data-settlement-id={settlement.id}
                    key={settlement.id}
                  >
                    <header>
                      <strong>{taka(settlement.amount_paisa)}</strong>
                      <span data-settlement-status={settlement.status}>
                        {settlement.status}
                      </span>
                    </header>
                    <p>
                      <code>{settlement.id}</code>
                    </p>
                    <small>{localDate(settlement.created_at)} (Dhaka)</small>
                    {settlement.status === "READY" && (
                      <p>
                        <button
                          className="button primary"
                          disabled={!!busy}
                          onClick={() => void payout(settlement.id)}
                        >
                          {busy === settlement.id
                            ? "Recording payout…"
                            : "Simulate payout"}
                        </button>
                      </p>
                    )}
                    {settlement.payout_id && (
                      <p>
                        Payout: <code>{settlement.payout_id}</code>
                      </p>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
          <section className="merchant-card">
            <h2>Payout history</h2>
            {!finance.payouts.length ? (
              <p>No simulated payouts recorded.</p>
            ) : (
              <div className="merchant-table">
                <table>
                  <thead>
                    <tr>
                      <th>Payout</th>
                      <th>Amount</th>
                      <th>Status</th>
                      <th>Created (Dhaka)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finance.payouts.map((item) => (
                      <tr key={item.id} data-payout-id={item.id}>
                        <td>
                          <code>{item.id}</code>
                          <small className="finance-id">
                            Settlement: {item.settlement_id}
                          </small>
                        </td>
                        <td>{taka(item.amount_paisa)}</td>
                        <td>{item.status}</td>
                        <td>{localDate(item.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="merchant-card">
            <h2>Double-entry journal</h2>
            <p>
              Each posting has equal debits and credits. Open a journal to see
              the accounts and its source record.
            </p>
            {!finance.journals.length ? (
              <p>No financial postings yet.</p>
            ) : (
              finance.journals.map((journal) => (
                <details
                  className="finance-journal"
                  key={journal.id}
                  data-journal-id={journal.id}
                >
                  <summary>
                    {journal.source_type} · {taka(journal.amount_paisa)} ·{" "}
                    {localDate(journal.created_at)}
                  </summary>
                  <p>
                    Source: <code>{journal.source_id}</code>
                  </p>
                  <div className="merchant-table">
                    <table>
                      <thead>
                        <tr>
                          <th>Account</th>
                          <th>Debit</th>
                          <th>Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {journal.entries.map((entry, index) => (
                          <tr key={index}>
                            <td>{entry.account.replaceAll("_", " ")}</td>
                            <td>
                              {entry.side === "DEBIT"
                                ? taka(entry.amount_paisa)
                                : "—"}
                            </td>
                            <td>
                              {entry.side === "CREDIT"
                                ? taka(entry.amount_paisa)
                                : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))
            )}
          </section>
        </>
      )}
    </BillingShell>
  );
}
