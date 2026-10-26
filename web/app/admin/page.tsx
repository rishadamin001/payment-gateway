"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import "../merchant/merchant.css";
import "./admin.css";

type Admin = { id: string; email: string };
type Merchant = {
  id: string;
  business_name: string;
  email: string;
  status: string;
  approval_status: string;
  approved_at: string | null;
  created_at: string;
};
type Payment = {
  id: string;
  merchant_id: string;
  business_name: string;
  merchant_order_id: string;
  amount_paisa: number;
  status: string;
  created_at: string;
  risk_flags: string[];
};
type Risk = {
  merchant_id: string;
  business_name: string;
  code: string;
  description: string;
  payment_id?: string;
  amount_paisa?: number;
  failure_count?: number;
};
type AuditEvent = {
  id: string;
  actor_type: string;
  actor_id: string | null;
  merchant_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
};
type Page<T, K extends string> = { total: number; page: number } & Record<
  K,
  T[]
>;
const taka = (n: number) =>
  `৳${(n / 100).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (value: string) =>
  new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" });
export async function adminCall(path: string, body?: unknown) {
  const response = await fetch(`/api/admin/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.message ?? "Admin service unavailable");
  return result;
}
function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <p className="form-error" role="alert">
      {message}
    </p>
  ) : null;
}
function Pages({
  page,
  total,
  change,
}: {
  page: number;
  total: number;
  change: (n: number) => void;
}) {
  return (
    <div className="admin-pagination">
      <button disabled={page <= 1} onClick={() => change(page - 1)}>
        Previous page
      </button>
      <span>
        Page {page} · {total} records
      </span>
      <button disabled={page * 25 >= total} onClick={() => change(page + 1)}>
        Next page
      </button>
    </div>
  );
}
function Merchants() {
  const [data, setData] = useState<Page<Merchant, "merchants"> | null>(null),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(""),
    [reasons, setReasons] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try {
      setData(await adminCall(`merchants?${query}&page=${page}`));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [query, page]);
  useEffect(() => {
    let cancelled = false;
    adminCall(`merchants?${query}&page=${page}`)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [query, page]);
  async function changeStatus(merchant: Merchant, status: string) {
    if (busy) return;
    const reason = reasons[merchant.id]?.trim();
    if (!reason) {
      setError("Add a reason before approving or suspending a merchant.");
      return;
    }
    setBusy(merchant.id);
    setError("");
    setNotice("");
    try {
      await adminCall(`merchants/${merchant.id}/status`, { status, reason });
      setNotice(
        status === "ACTIVE"
          ? "Merchant approved for simulated payments."
          : "Merchant suspended. New payments are blocked; existing records remain available.",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="merchant-card">
      <h2>Merchant review</h2>
      <p>
        Classroom accounts start active so the demo can run immediately. Record
        formal approval here, or suspend a merchant to block new simulated
        payments.
      </p>
      <ErrorNotice message={error} />
      {notice && (
        <p role="status" className="admin-success">
          {notice}
        </p>
      )}
      <form
        className="merchant-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery(
            new URLSearchParams(
              Object.fromEntries(new FormData(e.currentTarget)) as Record<
                string,
                string
              >,
            ).toString(),
          );
          setPage(1);
        }}
      >
        <label>
          Search merchants
          <input name="search" placeholder="Business name or email" />
        </label>
        <label>
          Merchant status
          <select name="status">
            <option value="">All statuses</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="SUSPENDED">SUSPENDED</option>
            <option value="PENDING">PENDING</option>
          </select>
        </label>
        <button className="button primary">Filter merchants</button>
      </form>
      <div className="merchant-table">
        <table>
          <thead>
            <tr>
              <th>Merchant</th>
              <th>Status / review</th>
              <th>Admin action</th>
            </tr>
          </thead>
          <tbody>
            {data?.merchants.map((m) => (
              <tr key={m.id} data-merchant-id={m.id}>
                <td>
                  <strong>{m.business_name}</strong>
                  <small>{m.email}</small>
                  <code>{m.id}</code>
                </td>
                <td>
                  <span className="admin-badge" data-merchant-status={m.status}>
                    {m.status}
                  </span>
                  <small>{m.approval_status}</small>
                  {m.approved_at && (
                    <small>Approved {date(m.approved_at)}</small>
                  )}
                </td>
                <td>
                  <label>
                    Reason
                    <input
                      value={reasons[m.id] ?? ""}
                      maxLength={300}
                      placeholder="Fictional review outcome"
                      onChange={(e) =>
                        setReasons({ ...reasons, [m.id]: e.target.value })
                      }
                    />
                  </label>
                  <div className="admin-actions">
                    <button
                      disabled={Boolean(busy)}
                      className="button primary"
                      onClick={() => void changeStatus(m, "ACTIVE")}
                    >
                      Approve merchant
                    </button>
                    <button
                      disabled={Boolean(busy)}
                      className="button secondary"
                      onClick={() => void changeStatus(m, "SUSPENDED")}
                    >
                      Suspend merchant
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data ? (
        <>
          <Pages page={page} total={data.total} change={setPage} />
          {!data.merchants.length && <p>No merchants match these filters.</p>}
        </>
      ) : (
        !error && <p>Loading merchants…</p>
      )}
    </section>
  );
}
function Transactions() {
  const [data, setData] = useState<Page<Payment, "payments"> | null>(null),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    adminCall(`transactions?${query}&page=${page}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [query, page]);
  return (
    <section className="merchant-card">
      <h2>All demo transactions</h2>
      <ErrorNotice message={error} />
      <form
        className="merchant-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          setQuery(
            new URLSearchParams(
              Object.fromEntries(new FormData(e.currentTarget)) as Record<
                string,
                string
              >,
            ).toString(),
          );
          setPage(1);
        }}
      >
        <label>
          Search transactions
          <input name="search" placeholder="Order or payment ID" />
        </label>
        <label>
          Payment status
          <select name="status">
            <option value="">All statuses</option>
            {[
              "PENDING",
              "PAID",
              "FAILED",
              "CANCELLED",
              "EXPIRED",
              "PARTIALLY_REFUNDED",
              "REFUNDED",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Merchant ID
          <input name="merchant_id" placeholder="Optional merchant UUID" />
        </label>
        <button className="button primary">Filter transactions</button>
      </form>
      <div className="merchant-table">
        <table>
          <thead>
            <tr>
              <th>Payment / order</th>
              <th>Merchant</th>
              <th>Amount</th>
              <th>Status / risk</th>
              <th>Created (Dhaka)</th>
            </tr>
          </thead>
          <tbody>
            {data?.payments.map((p) => (
              <tr key={p.id} data-admin-payment-id={p.id}>
                <td>
                  <strong>{p.merchant_order_id}</strong>
                  <code>{p.id}</code>
                </td>
                <td>
                  {p.business_name}
                  <code>{p.merchant_id}</code>
                </td>
                <td>{taka(p.amount_paisa)}</td>
                <td>
                  <span className="admin-badge">{p.status}</span>
                  {p.risk_flags?.map((flag) => (
                    <small key={flag} className="admin-risk">
                      {flag}
                    </small>
                  ))}
                </td>
                <td>{date(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data ? (
        <>
          <Pages page={page} total={data.total} change={setPage} />
          {!data.payments.length && <p>No matching transactions.</p>}
        </>
      ) : (
        !error && <p>Loading transactions…</p>
      )}
    </section>
  );
}
function Risks() {
  const [data, setData] = useState<{
      flags: Risk[];
      threshold_paisa: number;
      failure_threshold: number;
      window_hours: number;
    } | null>(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await adminCall("risk"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    adminCall("risk")
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <section className="merchant-card">
      <header>
        <h2>Simple risk flags</h2>
        <button className="button secondary" onClick={() => void load()}>
          Refresh risk flags
        </button>
      </header>
      <ErrorNotice message={error} />
      <p>
        These classroom rules highlight transactions for review. They are not a
        real fraud assessment and do not automatically reject payments.
      </p>
      {data && (
        <>
          <p>
            Unusual amount: at least {taka(data.threshold_paisa)}. Repeated
            failures: at least {data.failure_threshold} failed attempts in{" "}
            {data.window_hours} hours.
          </p>
          <div className="admin-risk-list">
            {data.flags.map((flag, i) => (
              <article
                className="admin-risk-card"
                key={`${flag.code}-${flag.payment_id ?? flag.merchant_id}-${i}`}
                data-risk-code={flag.code}
              >
                <h3>{flag.business_name}</h3>
                <span className="admin-badge">{flag.code}</span>
                <p>{flag.description}</p>
                {flag.amount_paisa !== undefined && (
                  <p>Amount: {taka(flag.amount_paisa)}</p>
                )}
                {flag.failure_count !== undefined && (
                  <p>Failed attempts: {flag.failure_count}</p>
                )}
                <small>
                  Merchant <code>{flag.merchant_id}</code>
                </small>
                {flag.payment_id && (
                  <small>
                    Payment <code>{flag.payment_id}</code>
                  </small>
                )}
              </article>
            ))}
          </div>
          {!data.flags.length && (
            <p>
              No current risk flags. Large demo payments or repeated simulated
              failures will appear here.
            </p>
          )}
        </>
      )}
      {!data && !error && <p>Loading risk flags…</p>}
    </section>
  );
}
function Audit() {
  const [data, setData] = useState<Page<AuditEvent, "events"> | null>(null),
    [page, setPage] = useState(1),
    [query, setQuery] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    adminCall(`audit?${query}&page=${page}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [query, page]);
  return (
    <section className="merchant-card">
      <h2>Audit log</h2>
      <p>
        Important actions are recorded without passwords, keys or session
        tokens. Audit entries are retained and cannot be edited through the
        dashboard.
      </p>
      <ErrorNotice message={error} />
      <form
        className="merchant-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          setQuery(
            new URLSearchParams(
              Object.fromEntries(new FormData(e.currentTarget)) as Record<
                string,
                string
              >,
            ).toString(),
          );
          setPage(1);
        }}
      >
        <label>
          Audit action
          <input name="action" placeholder="Optional action filter" />
        </label>
        <label>
          Audit merchant ID
          <input name="merchant_id" placeholder="Optional merchant UUID" />
        </label>
        <button className="button primary">Filter audit</button>
      </form>
      <div className="merchant-table">
        <table>
          <thead>
            <tr>
              <th>Time (Dhaka)</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Record</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {data?.events.map((event) => (
              <tr key={event.id} data-audit-id={event.id}>
                <td>{date(event.created_at)}</td>
                <td>{event.action}</td>
                <td>
                  {event.actor_type}
                  {event.actor_id && <code>{event.actor_id}</code>}
                </td>
                <td>
                  {event.entity_type}
                  <code>{event.entity_id}</code>
                  {event.merchant_id && (
                    <small>
                      Merchant <code>{event.merchant_id}</code>
                    </small>
                  )}
                </td>
                <td>
                  {Object.entries(event.metadata ?? {}).map(([key, value]) => (
                    <small key={key}>
                      {key}:{" "}
                      {typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)}
                    </small>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data ? (
        <>
          <Pages page={page} total={data.total} change={setPage} />
          {!data.events.length && <p>No matching audit entries.</p>}
        </>
      ) : (
        !error && <p>Loading audit history…</p>
      )}
    </section>
  );
}
export default function AdminPage() {
  const [me, setMe] = useState<Admin | null>(null),
    [setup, setSetup] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("Merchants");
  useEffect(() => {
    Promise.all([adminCall("setup-status"), adminCall("me").catch(() => null)])
      .then(([status, admin]) => {
        setSetup(status.setup_required);
        setMe(admin);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);
  async function authenticate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      await adminCall(
        setup ? "setup" : "login",
        Object.fromEntries(new FormData(form)),
      );
      form.reset();
      setMe(await adminCall("me"));
      setSetup(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="merchant-shell admin-shell">
      <nav>
        <Link href="/">PayBD Demo</Link>
        <Link href="/merchant">Merchant dashboard</Link>
        <Link href="/shop">Demo shop</Link>
      </nav>
      <p className="merchant-notice">
        DEMO MODE: fictional merchants and money only. No real providers, cards,
        PINs or OTPs.
      </p>
      <ErrorNotice message={error} />
      {!loaded ? (
        <p>Loading admin workspace…</p>
      ) : !me ? (
        <section className="merchant-card auth">
          <h1>{setup ? "Create demo admin" : "Admin sign in"}</h1>
          <p>
            {setup
              ? "Choose the first administrator account for this local classroom database. Your password is hashed; it is never displayed or shared."
              : "Admin access uses a separate account and session from the merchant dashboard."}
          </p>
          <form onSubmit={authenticate}>
            <label>
              Admin email
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                maxLength={254}
              />
            </label>
            <label>
              Admin password
              <input
                name="password"
                type="password"
                required
                minLength={12}
                maxLength={128}
                autoComplete={setup ? "new-password" : "current-password"}
              />
            </label>
            <small>
              Use a unique demo-only password of at least 12 characters.
            </small>
            <button className="button primary" disabled={busy}>
              {setup ? "Create admin account" : "Sign in as admin"}
            </button>
          </form>
        </section>
      ) : (
        <>
          <header>
            <div>
              <h1>Demo administration</h1>
              <p>Signed in as {me.email}</p>
            </div>
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await adminCall("logout", {});
                  setMe(null);
                  setError("");
                  setTab("Merchants");
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Sign out admin
            </button>
          </header>
          <div
            className="admin-tabs"
            role="tablist"
            aria-label="Administration sections"
          >
            {["Merchants", "All transactions", "Risk flags", "Audit log"].map(
              (name) => (
                <button
                  key={name}
                  role="tab"
                  aria-selected={tab === name}
                  onClick={() => setTab(name)}
                >
                  {name}
                </button>
              ),
            )}
          </div>
          {tab === "Merchants" ? (
            <Merchants />
          ) : tab === "All transactions" ? (
            <Transactions />
          ) : tab === "Risk flags" ? (
            <Risks />
          ) : (
            <Audit />
          )}
        </>
      )}
    </main>
  );
}
