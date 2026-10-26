"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import "../merchant.css";
import "./billing.css";

export const taka = (value: number) =>
  `৳${(value / 100).toLocaleString("en-BD", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const localDate = (value: string) =>
  new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" });
export function paisa(value: string) {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value))
    throw new Error(
      "Enter a positive taka amount with at most two decimal places.",
    );
  const [whole, fraction = ""] = value.split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount < 1)
    throw new Error("Amount must be greater than zero.");
  return amount;
}
export function BillingShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="merchant-shell billing-shell">
      <nav aria-label="Merchant sections">
        <Link href="/merchant">← Merchant dashboard</Link>
        <Link href="/merchant/links">Payment links</Link>
        <Link href="/merchant/invoices">Invoices</Link>
        <Link href="/merchant/finance">Finance</Link>
      </nav>
      <p className="merchant-notice">
        DEMO MODE: fictional payments only. No money, emails or SMS are sent.
      </p>
      <h1>{title}</h1>
      {children}
    </main>
  );
}
export function BillingError({ message }: { message: string }) {
  return message ? (
    <p className="form-error" role="alert">
      {message} <Link href="/merchant">Merchant sign in</Link>
    </p>
  ) : null;
}
