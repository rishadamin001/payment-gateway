import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { pool } from '../db.js';
import { MerchantService } from '../merchant/merchant.service.js';
import {
  checkoutBaseUrl,
  DEMO_NOTICE,
  validateIdempotencyKey,
} from '../payments/payment-utils.js';
import {
  amount,
  date,
  fields,
  invoiceItems,
  text,
  uuid,
  type InvoiceItem,
} from './billing-utils.js';

type LinkRow = {
  id: string;
  merchant_id: string;
  title: string;
  amount_paisa: number;
  reusable: boolean;
  expires_at: Date;
  settled_payment_id: string | null;
  created_at: Date;
  merchant_name?: string;
  merchant_status?: string;
  expired: boolean;
};
type InvoiceRow = {
  id: string;
  merchant_id: string;
  customer_name: string;
  customer_email: string;
  due_at: Date;
  items: InvoiceItem[];
  amount_paisa: number;
  status: string;
  link_id: string | null;
  created_at: Date;
  sent_at: Date | null;
  paid_at: Date | null;
  merchant_name: string;
};
@Injectable()
export class BillingService {
  constructor(private readonly merchants: MerchantService) {}
  private readonly origin = checkoutBaseUrl(
    process.env.PAYBD_CHECKOUT_BASE_URL,
  );
  private async active(cookie: string) {
    const m = await this.merchants.identity(cookie);
    if (m.status !== 'ACTIVE')
      throw new ForbiddenException(
        'Merchant is not approved for simulated payments',
      );
    return m;
  }
  private async transaction<T>(
    work: (db: PoolClient) => Promise<T>,
  ): Promise<T> {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const result = await work(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    } finally {
      db.release();
    }
  }
  private presentLink(r: LinkRow) {
    const status =
      !r.reusable && r.settled_payment_id
        ? 'PAID'
        : r.expired
          ? 'EXPIRED'
          : 'ACTIVE';
    return {
      id: r.id,
      title: r.title,
      amount_paisa: Number(r.amount_paisa),
      currency: 'BDT',
      reusable: r.reusable,
      expires_at: r.expires_at,
      created_at: r.created_at,
      status,
      payment_url: new URL(`/pay/${r.id}`, this.origin).toString(),
      test_mode: true,
      notice: DEMO_NOTICE,
    };
  }
  async links(cookie: string) {
    const m = await this.merchants.identity(cookie);
    const rows = await pool.query<LinkRow>(
      'SELECT *,amount_paisa::float8 AS amount_paisa,expires_at<=clock_timestamp() AS expired FROM payment_links WHERE merchant_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',
      [m.id],
    );
    return {
      links: rows.rows.map((r) => this.presentLink(r)),
      test_mode: true,
    };
  }
  async createLink(cookie: string, body: unknown) {
    const m = await this.active(cookie),
      b = fields(body, ['title', 'amount_paisa', 'reusable', 'expires_at']);
    if (typeof b.reusable !== 'boolean')
      throw new BadRequestException('Choose a one-time or reusable link');
    const result = await pool.query<LinkRow>(
      'INSERT INTO payment_links(merchant_id,title,amount_paisa,reusable,expires_at) VALUES($1,$2,$3,$4,$5) RETURNING *,amount_paisa::float8 AS amount_paisa,expires_at<=clock_timestamp() AS expired',
      [
        m.id,
        text(b.title, 'Title', 120),
        amount(b.amount_paisa),
        b.reusable,
        date(b.expires_at, 'Expiry'),
      ],
    );
    return this.presentLink(result.rows[0]);
  }
  async qr(cookie: string, id: string) {
    const m = await this.merchants.identity(cookie);
    uuid(id);
    const r = await pool.query(
      'SELECT id FROM payment_links WHERE id=$1 AND merchant_id=$2',
      [id, m.id],
    );
    if (!r.rowCount) throw new NotFoundException('Payment link not found');
    return QRCode.toBuffer(new URL(`/pay/${id}`, this.origin).toString(), {
      type: 'png',
      width: 320,
      margin: 4,
      errorCorrectionLevel: 'M',
    });
  }
  async publicLink(id: string) {
    uuid(id);
    const r = await pool.query<LinkRow>(
      'SELECT l.*,l.amount_paisa::float8 AS amount_paisa,l.expires_at<=clock_timestamp() AS expired,m.business_name AS merchant_name,m.status AS merchant_status FROM payment_links l JOIN merchants m ON m.id=l.merchant_id WHERE l.id=$1',
      [id],
    );
    if (!r.rowCount) throw new NotFoundException('Payment link not found');
    const row = r.rows[0],
      link = this.presentLink(row);
    return {
      ...link,
      merchant_name: row.merchant_name,
      can_pay: link.status === 'ACTIVE' && row.merchant_status === 'ACTIVE',
    };
  }
  async checkout(id: string, keyHeader: string, body: unknown) {
    uuid(id);
    fields(body ?? {}, []);
    const key = validateIdempotencyKey(keyHeader);
    return this.transaction(async (db) => {
      const result = await db.query<LinkRow>(
        'SELECT *,amount_paisa::float8 AS amount_paisa,expires_at<=clock_timestamp() AS expired FROM payment_links WHERE id=$1 FOR UPDATE',
        [id],
      );
      const link = result.rows[0];
      if (!link) throw new NotFoundException('Payment link not found');
      const merchant = await db.query(
        'SELECT status FROM merchants WHERE id=$1',
        [link.merchant_id],
      );
      if (merchant.rows[0]?.status !== 'ACTIVE')
        throw new ForbiddenException(
          'Merchant is not approved for simulated payments',
        );
      const idempotency =
        'link:' +
        createHash('sha256')
          .update(id + ':' + key)
          .digest('hex');
      const prior = await db.query<{ id: string; status: string }>(
        'SELECT id,status FROM payments WHERE merchant_id=$1 AND idempotency_key=$2',
        [link.merchant_id, idempotency],
      );
      const present = (p: { id: string; status: string }) => ({
        id: p.id,
        status: p.status,
        amount_paisa: Number(link.amount_paisa),
        currency: 'BDT',
        checkout_url: new URL(`/checkout/${p.id}`, this.origin).toString(),
        test_mode: true,
        notice: DEMO_NOTICE,
      });
      if (prior.rows[0]) return present(prior.rows[0]);
      if (link.expired)
        throw new ConflictException('This payment link has expired');
      if (!link.reusable && link.settled_payment_id)
        throw new ConflictException(
          'This one-time payment link has already been paid',
        );
      if (!link.reusable) {
        // Read an existing checkout without locking its payment row. Checkout
        // completion locks payment then link, so inverse locks would deadlock.
        const pending = await db.query<{ id: string; status: string }>(
          "SELECT id,status FROM payments WHERE payment_link_id=$1 AND status='PENDING' AND expires_at>clock_timestamp() ORDER BY created_at DESC LIMIT 1",
          [id],
        );
        if (pending.rows[0]) return present(pending.rows[0]);
      }
      const redirect = new URL(`/pay/${id}`, this.origin).toString();
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({ link_id: id, amount_paisa: link.amount_paisa }),
        )
        .digest('hex');
      const p = await db.query<{ id: string; status: string }>(
        `INSERT INTO payments(merchant_id,merchant_order_id,amount_paisa,currency,status,success_url,cancel_url,idempotency_key,request_fingerprint,payment_link_id,expires_at)
        VALUES($1,$2,$3,'BDT','PENDING',$4,$4,$5,$6,$7,LEAST($8::timestamptz,clock_timestamp()+interval '2 minutes')) RETURNING id,status`,
        [
          link.merchant_id,
          `LINK-${id.slice(0, 8)}-${randomUUID().slice(0, 8)}`,
          link.amount_paisa,
          redirect,
          idempotency,
          fingerprint,
          id,
          link.expires_at,
        ],
      );
      return present(p.rows[0]);
    });
  }
  private readonly invoiceColumns = `i.id,i.merchant_id,i.customer_name,i.customer_email,i.due_at,i.items,i.amount_paisa::float8 AS amount_paisa,
    CASE WHEN i.status='SENT' AND i.due_at<clock_timestamp() THEN 'OVERDUE' ELSE i.status END AS status,i.link_id,i.created_at,i.sent_at,i.paid_at,m.business_name AS merchant_name`;
  private presentInvoice(r: InvoiceRow) {
    return {
      ...r,
      amount_paisa: Number(r.amount_paisa),
      payment_url: r.link_id
        ? new URL(`/pay/${r.link_id}`, this.origin).toString()
        : null,
      test_mode: true,
      notice: DEMO_NOTICE,
    };
  }
  async invoices(cookie: string) {
    const m = await this.merchants.identity(cookie);
    const r = await pool.query<InvoiceRow>(
      `SELECT ${this.invoiceColumns} FROM invoices i JOIN merchants m ON m.id=i.merchant_id WHERE i.merchant_id=$1 ORDER BY i.created_at DESC,i.id DESC LIMIT 100`,
      [m.id],
    );
    return {
      invoices: r.rows.map((row) => this.presentInvoice(row)),
      test_mode: true,
    };
  }
  async invoice(cookie: string, id: string) {
    const m = await this.merchants.identity(cookie);
    uuid(id);
    const r = await pool.query<InvoiceRow>(
      `SELECT ${this.invoiceColumns} FROM invoices i JOIN merchants m ON m.id=i.merchant_id WHERE i.id=$1 AND i.merchant_id=$2`,
      [id, m.id],
    );
    if (!r.rows[0]) throw new NotFoundException('Invoice not found');
    const reminders = await pool.query<{
      id: string;
      message: string;
      created_at: Date;
    }>(
      'SELECT id,message,created_at FROM invoice_reminders WHERE invoice_id=$1 ORDER BY created_at DESC,id DESC',
      [id],
    );
    return { ...this.presentInvoice(r.rows[0]), reminders: reminders.rows };
  }
  async createInvoice(cookie: string, body: unknown) {
    const m = await this.active(cookie),
      b = fields(body, ['customer_name', 'customer_email', 'due_at', 'items']);
    const email = text(b.customer_email, 'Customer email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new BadRequestException('Use a fictional customer email');
    const normalized = invoiceItems(b.items);
    const r = await pool.query<{ id: string }>(
      'INSERT INTO invoices(merchant_id,customer_name,customer_email,due_at,items,amount_paisa) VALUES($1,$2,$3,$4,$5::jsonb,$6) RETURNING id',
      [
        m.id,
        text(b.customer_name, 'Customer name', 120),
        email,
        date(b.due_at, 'Due date'),
        JSON.stringify(normalized.items),
        normalized.total,
      ],
    );
    return this.invoice(cookie, r.rows[0].id);
  }
  async send(cookie: string, id: string, body: unknown) {
    const m = await this.active(cookie);
    uuid(id);
    fields(body ?? {}, []);
    await this.transaction(async (db) => {
      const r = await db.query<InvoiceRow>(
        'SELECT * FROM invoices WHERE id=$1 AND merchant_id=$2 FOR UPDATE',
        [id, m.id],
      );
      const inv = r.rows[0];
      if (!inv) throw new NotFoundException('Invoice not found');
      if (inv.status !== 'DRAFT') return;
      const link = await db.query<{ id: string }>(
        `INSERT INTO payment_links(merchant_id,title,amount_paisa,reusable,expires_at) VALUES($1,$2,$3,false,GREATEST($4::timestamptz+interval '30 days',clock_timestamp()+interval '365 days')) RETURNING id`,
        [m.id, `Invoice ${id.slice(0, 8)}`, inv.amount_paisa, inv.due_at],
      );
      await db.query(
        "UPDATE invoices SET status='SENT',link_id=$1,sent_at=now() WHERE id=$2",
        [link.rows[0].id, id],
      );
    });
    return this.invoice(cookie, id);
  }
  async remind(cookie: string, id: string, body: unknown) {
    const m = await this.merchants.identity(cookie);
    uuid(id);
    fields(body ?? {}, []);
    await this.transaction(async (db) => {
      const r = await db.query<InvoiceRow>(
        'SELECT * FROM invoices WHERE id=$1 AND merchant_id=$2 FOR UPDATE',
        [id, m.id],
      );
      if (!r.rows[0]) throw new NotFoundException('Invoice not found');
      if (r.rows[0].status !== 'SENT')
        throw new ConflictException(
          'Only sent or overdue invoices need a reminder',
        );
      await db.query(
        'INSERT INTO invoice_reminders(invoice_id,message) VALUES($1,$2)',
        [
          id,
          'Demo reminder recorded in-app. Please complete the simulated invoice payment; no email or SMS was sent.',
        ],
      );
    });
    return this.invoice(cookie, id);
  }
  async pdf(cookie: string, id: string) {
    const inv = await this.invoice(cookie, id);
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: { Title: 'PayBD Demo Invoice', Author: 'PayBD Demo' },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.font('Helvetica-Bold').fontSize(20).text('PayBD Demo invoice');
      doc.fontSize(11).fillColor('#b04020').text('DEMO MODE - NO REAL MONEY');
      doc
        .fillColor('black')
        .font('Helvetica')
        .fontSize(10)
        .text(`Invoice: ${inv.id}`)
        .text(`Merchant: ${inv.merchant_name}`)
        .text(`Customer: ${inv.customer_name}`)
        .text(`Fictional email: ${inv.customer_email}`)
        .text(`Status: ${inv.status}`)
        .text(
          `Due: ${new Date(inv.due_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka' })} (Dhaka)`,
        );
      doc.moveDown();
      for (const item of inv.items) {
        if (doc.y > 700) doc.addPage();
        doc.font('Helvetica-Bold').text(item.description);
        doc
          .font('Helvetica')
          .text(
            `${item.quantity} x BDT ${(item.unit_amount_paisa / 100).toFixed(2)} = BDT ${((item.quantity * item.unit_amount_paisa) / 100).toFixed(2)}`,
          )
          .moveDown(0.6);
      }
      doc
        .moveDown()
        .font('Helvetica-Bold')
        .fontSize(13)
        .text(`Total: BDT ${(inv.amount_paisa / 100).toFixed(2)}`);
      if (inv.payment_url)
        doc
          .moveDown()
          .font('Helvetica')
          .fontSize(9)
          .text(`Simulated payment: ${inv.payment_url}`, {
            link: inv.payment_url,
          });
      doc
        .moveDown()
        .font('Helvetica')
        .fontSize(9)
        .text(
          'This document is a fictional MIS465 classroom invoice. No actual payment is requested.',
        );
      doc.end();
    });
  }
}
