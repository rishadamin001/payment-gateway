// A local, credential-free contract for the classroom API. Tests compare its
// operation inventory with every Nest controller so newly added routes stay visible.
type Schema = Record<string, unknown>;
type Operation = Record<string, unknown>;
const ref = (name: string): Schema => ({
  $ref: `#/components/schemas/${name}`,
});
const str = (description?: string): Schema => ({
  type: 'string',
  ...(description ? { description } : {}),
});
const id: Schema = { type: 'string', format: 'uuid' };
const time: Schema = { type: 'string', format: 'date-time' };
const paisa: Schema = {
  type: 'integer',
  format: 'int64',
  minimum: 1,
  maximum: 100000000000,
  description: 'Integer paisa; 100 paisa = BDT 1.00. No real money.',
};
const array = (items: Schema): Schema => ({ type: 'array', items });
const object = (
  properties: Record<string, Schema>,
  required: string[] = [],
  strict = false,
): Schema => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  ...(strict ? { additionalProperties: false } : {}),
});
const status = {
  type: 'string',
  enum: [
    'PENDING',
    'PAID',
    'FAILED',
    'CANCELLED',
    'EXPIRED',
    'REFUNDED',
    'PARTIALLY_REFUNDED',
  ],
};
const demo = {
  test_mode: { type: 'boolean', enum: [true] },
  notice: str('DEMO MODE: no real money'),
};
const empty = object({}, [], true);
const login = object(
  {
    email: { type: 'string', format: 'email', maxLength: 200 },
    password: {
      type: 'string',
      format: 'password',
      minLength: 12,
      maxLength: 128,
      writeOnly: true,
    },
  },
  ['email', 'password'],
  true,
);
const inputPayment = object(
  {
    amount_paisa: paisa,
    currency: { type: 'string', enum: ['BDT'] },
    merchant_order_id: { type: 'string', minLength: 1, maxLength: 100 },
    success_url: {
      type: 'string',
      format: 'uri',
      maxLength: 2048,
      description: 'HTTP(S) URL without embedded credentials.',
    },
    cancel_url: { type: 'string', format: 'uri', maxLength: 2048 },
  },
  [
    'amount_paisa',
    'currency',
    'merchant_order_id',
    'success_url',
    'cancel_url',
  ],
  true,
);
const payment = object({
  id,
  merchant_id: id,
  merchant_order_id: str(),
  amount_paisa: paisa,
  amount_display: str('Bangladeshi taka for display'),
  currency: { type: 'string', enum: ['BDT'] },
  status,
  checkout_url: { type: 'string', format: 'uri' },
  created_at: time,
  updated_at: time,
  expires_at: time,
  history: array(
    object({
      from_status: { ...status, nullable: true },
      to_status: status,
      reason: str(),
      changed_at: time,
    }),
  ),
  ...demo,
});
const line = object(
  {
    description: { type: 'string', minLength: 1, maxLength: 200 },
    quantity: { type: 'integer', minimum: 1, maximum: 10000 },
    unit_amount_paisa: paisa,
  },
  ['description', 'quantity', 'unit_amount_paisa'],
  true,
);
const link = object({
  id,
  title: str(),
  amount_paisa: paisa,
  currency: { type: 'string', enum: ['BDT'] },
  reusable: { type: 'boolean' },
  expires_at: time,
  created_at: time,
  status: { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'PAID'] },
  payment_url: { type: 'string', format: 'uri' },
  merchant_name: str(),
  can_pay: { type: 'boolean' },
  ...demo,
});
const invoice = object({
  id,
  merchant_id: id,
  customer_name: str(),
  customer_email: { type: 'string', format: 'email' },
  due_at: time,
  items: array(line),
  amount_paisa: paisa,
  status: { type: 'string', enum: ['DRAFT', 'SENT', 'PAID', 'OVERDUE'] },
  link_id: { ...id, nullable: true },
  payment_url: { type: 'string', format: 'uri', nullable: true },
  reminders: array(object({ id, message: str(), created_at: time })),
  ...demo,
});
const schemas: Record<string, Schema> = {
  Error: object({
    statusCode: { type: 'integer' },
    message: str(),
    error: str(),
  }),
  Empty: empty,
  Credentials: login,
  NewPayment: inputPayment,
  Payment: payment,
  PaymentList: object({
    payments: array(ref('Payment')),
    merchant: object({ id, business_name: str() }),
    ...demo,
  }),
  Merchant: object({
    id,
    business_name: str(),
    email: { type: 'string', format: 'email' },
    status: { type: 'string', enum: ['PENDING', 'ACTIVE', 'SUSPENDED'] },
    created_at: time,
    approved_at: { ...time, nullable: true },
    approval_status: { type: 'string', enum: ['PENDING_REVIEW', 'APPROVED'] },
  }),
  LoginResult: object({ ok: { type: 'boolean' } }),
  MerchantTransactions: object({
    payments: array(ref('Payment')),
    total: { type: 'integer' },
    page: { type: 'integer' },
    summary: object({
      total: { type: 'integer' },
      successful: { type: 'integer' },
      gross_paisa: { type: 'integer' },
    }),
    chart: array(
      object({
        day: { type: 'string', format: 'date' },
        gross_paisa: { type: 'integer' },
        total: { type: 'integer' },
        successful: { type: 'integer' },
      }),
    ),
  }),
  Checkout: object({
    id,
    merchant_name: str(),
    merchant_order_id: str(),
    amount_paisa: paisa,
    amount_display: str(),
    currency: { type: 'string', enum: ['BDT'] },
    status,
    expires_at: time,
    server_time: time,
    shop_order_id: { ...id, nullable: true },
    payment_link_id: { ...id, nullable: true },
    method: {
      type: 'string',
      nullable: true,
      enum: ['card', 'bkash', 'nagad', 'rocket', 'bank', null],
    },
    ...demo,
  }),
  Challenge: object({
    challenge_id: id,
    method: str(),
    fake_code: {
      type: 'string',
      enum: ['000000'],
      description: 'Public practice code; not a real OTP. No SMS is sent.',
    },
    expires_at: time,
    ...demo,
  }),
  Link: link,
  Invoice: invoice,
  RefundResult: object({
    id,
    status: { type: 'string', enum: ['SUCCEEDED'] },
    ...demo,
  }),
  Refunds: object({
    totals_known: { type: 'boolean' },
    refunded_paisa: { type: 'integer', nullable: true },
    remaining_paisa: { type: 'integer', nullable: true },
    payment_status: status,
    refunds: array(
      object({
        id,
        amount_paisa: paisa,
        reason: str(),
        status: { type: 'string', enum: ['SUCCEEDED'] },
        created_at: time,
        history: array(
          object({
            status: { type: 'string', enum: ['REQUESTED', 'SUCCEEDED'] },
            changed_at: time,
          }),
        ),
      }),
    ),
  }),
  WebhookSettings: object({
    enabled: { type: 'boolean' },
    receiver_mode: {
      type: 'string',
      enum: ['success', 'fail_twice', 'always_fail'],
    },
    destination: str('Built-in loopback receiver only'),
    signing: str(),
    max_attempts: { type: 'integer', enum: [5] },
  }),
  WebhookEvents: object({
    events: array(
      object({
        id,
        event_type: str(),
        payload: object({}),
        status: {
          type: 'string',
          enum: ['PENDING', 'RETRY', 'DELIVERED', 'FAILED'],
        },
        attempts: { type: 'integer' },
        created_at: time,
        next_attempt_at: time,
        deliveries: array(
          object({
            attempt: { type: 'integer' },
            http_status: { type: 'integer', nullable: true },
            result: str(),
            signature_valid: { type: 'boolean' },
            created_at: time,
          }),
        ),
      }),
    ),
  }),
  Settlement: object({
    id,
    amount_paisa: paisa,
    status: { type: 'string', enum: ['READY', 'PAID_OUT'] },
    created_at: time,
    payout_id: { ...id, nullable: true },
    ...demo,
  }),
  Payout: object({
    id,
    settlement_id: id,
    amount_paisa: paisa,
    status: { type: 'string', enum: ['SUCCEEDED'] },
    created_at: time,
    ...demo,
  }),
  Finance: object({
    balances: object({
      available_paisa: { type: 'integer' },
      reserved_paisa: { type: 'integer' },
      clearing_paisa: { type: 'integer' },
    }),
    settlements: array(ref('Settlement')),
    payouts: array(ref('Payout')),
    journals: array(
      object({
        id,
        source_type: {
          type: 'string',
          enum: ['PAYMENT', 'REFUND', 'LEGACY_REFUND', 'SETTLEMENT', 'PAYOUT'],
        },
        source_id: id,
        amount_paisa: paisa,
        created_at: time,
        entries: array(
          object({
            account: {
              type: 'string',
              enum: ['CLEARING', 'MERCHANT_PAYABLE', 'SETTLEMENT_PAYABLE'],
            },
            side: { type: 'string', enum: ['DEBIT', 'CREDIT'] },
            amount_paisa: paisa,
          }),
        ),
      }),
    ),
    ...demo,
  }),
  Reconciliation: object({
    status: { type: 'string', enum: ['MATCHED', 'REVIEW_REQUIRED'] },
    payment_total_paisa: { type: 'integer' },
    refund_total_paisa: { type: 'integer' },
    ledger_payment_paisa: { type: 'integer' },
    ledger_refund_paisa: { type: 'integer' },
    payout_total_paisa: { type: 'integer' },
    clearing_paisa: { type: 'integer' },
    expected_clearing_paisa: { type: 'integer' },
    imbalance_paisa: { type: 'integer' },
    unknown_legacy_refunds: { type: 'integer' },
    discrepancies: array(str()),
    ...demo,
  }),
  Risk: object({
    threshold_paisa: { type: 'integer', enum: [10000000] },
    failure_threshold: { type: 'integer', enum: [3] },
    window_hours: { type: 'integer', enum: [24] },
    flags: array(
      object({
        merchant_id: id,
        business_name: str(),
        code: { type: 'string', enum: ['UNUSUAL_AMOUNT', 'REPEATED_FAILURES'] },
        description: str(),
        payment_id: id,
        amount_paisa: paisa,
        failure_count: { type: 'integer' },
      }),
    ),
    ...demo,
  }),
  Audit: object({
    total: { type: 'integer' },
    page: { type: 'integer' },
    events: array(
      object({
        id: str(),
        actor_type: { type: 'string', enum: ['ADMIN', 'SYSTEM'] },
        actor_id: { ...id, nullable: true },
        merchant_id: { ...id, nullable: true },
        action: str(),
        entity_type: str(),
        entity_id: str(),
        metadata: object({}),
        created_at: time,
      }),
    ),
    ...demo,
  }),
};
const paths: Record<string, Record<string, Operation>> = {};
const header = (name: string, schema: Schema, description: string) => ({
  in: 'header',
  name,
  required: true,
  schema,
  description,
});
const idem = header(
  'Idempotency-Key',
  {
    type: 'string',
    minLength: 8,
    maxLength: 128,
    pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$',
  },
  'Reuse the same key for the same logical request. Changed details return409. Generate a fresh key for a new operation.',
);
const origin = header(
  'Origin',
  { type: 'string', format: 'uri' },
  'Merchant/admin writes require the configured web origin, default http://localhost:3001 or http://127.0.0.1:3001. Browser Origin cannot be overridden; use the web app for writes.',
);
const query = (name: string, schema: Schema, description = '') => ({
  in: 'query',
  name,
  required: false,
  schema,
  description,
});
const page = query(
  'page',
  { type: 'integer', minimum: 1, default: 1 },
  '25 records per page.',
);
const search = query(
  'search',
  { type: 'string', maxLength: 100 },
  'Partial order, payment ID or merchant-name match as applicable.',
);
const statusQuery = query('status', status);
const filters = [
  search,
  statusQuery,
  query(
    'from',
    { type: 'string', format: 'date' },
    'Inclusive Dhaka calendar date.',
  ),
  query(
    'to',
    { type: 'string', format: 'date' },
    'Inclusive Dhaka calendar date.',
  ),
];
function add(
  method: 'get' | 'post',
  path: string,
  tag: string,
  summary: string,
  options: {
    auth?: 'TestKey' | 'MerchantSession' | 'AdminSession';
    body?: Schema;
    output?: Schema;
    parameters?: unknown[];
    code?: number;
    description?: string;
    media?: string;
    headers?: Record<string, unknown>;
  } = {},
) {
  const code = options.code ?? (method === 'post' ? 201 : 200);
  const parameters = [
    ...(path.includes('{id}')
      ? [{ in: 'path', name: 'id', required: true, schema: id }]
      : []),
    ...(options.parameters ?? []),
  ];
  if (
    method === 'post' &&
    (path.startsWith('/v1/merchant/') || path.startsWith('/v1/admin/'))
  )
    parameters.push(origin);
  paths[path] ??= {};
  paths[path][method] = {
    operationId: method + path.replace(/[^A-Za-z0-9]/g, '_'),
    tags: [tag],
    summary,
    description:
      options.description ??
      'All data and money movements are simulated for MIS465.',
    security: options.auth ? [{ [options.auth]: [] }] : [],
    ...(parameters.length ? { parameters } : {}),
    ...(options.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: options.body } },
          },
        }
      : {}),
    responses: {
      [code]: {
        description: code === 201 ? 'Created or idempotent replay' : 'Success',
        ...(options.headers ? { headers: options.headers } : {}),
        content: {
          [options.media ?? 'application/json']: {
            schema: options.output ?? object({}),
          },
        },
      },
      400: {
        description: 'Invalid input',
        content: { 'application/json': { schema: ref('Error') } },
      },
      ...(options.auth
        ? {
            401: { description: 'Missing, expired or invalid credentials' },
            403: { description: 'Invalid origin or inactive merchant' },
          }
        : {}),
      ...(method === 'post'
        ? {
            403: { description: 'Invalid origin or inactive merchant' },
            409: {
              description:
                'Idempotency, current state, balance, expiry or one-time-use conflict',
            },
            429: {
              description: 'Sign-in or fake verification attempt limit reached',
            },
          }
        : {}),
      404: {
        description:
          'Resource unavailable or outside the authenticated account',
      },
      500: {
        description:
          'Sanitized internal error; no credential values are returned',
      },
    },
  };
}
const merchant = (
  method: 'get' | 'post',
  suffix: string,
  summary: string,
  options: Parameters<typeof add>[4] = {},
) =>
  add(method, '/v1/merchant/' + suffix, 'Merchant dashboard', summary, {
    auth: 'MerchantSession',
    ...options,
  });
const admin = (
  method: 'get' | 'post',
  suffix: string,
  summary: string,
  options: Parameters<typeof add>[4] = {},
) =>
  add(method, '/v1/admin/' + suffix, 'Administration', summary, {
    auth: 'AdminSession',
    ...options,
  });
add('get', '/', 'System', 'API greeting', {
  media: 'text/html',
  output: str(),
});
add('get', '/health', 'System', 'Check API and PostgreSQL connectivity', {
  output: object({
    status: { type: 'string', enum: ['ok', 'error'] },
    database: { type: 'string', enum: ['connected', 'unreachable'] },
    demo_mode: { type: 'boolean' },
    notice: str(),
  }),
});
add(
  'get',
  '/merchants',
  'System',
  'Legacy public fictional merchant directory',
  {
    output: array(ref('Merchant')),
    description:
      'Preserved M1 endpoint. Lists fictional merchant display/contact data; no passwords or keys.',
  },
);
add(
  'get',
  '/v1/payments',
  'Payments API',
  'List latest100 payments for a test key',
  { auth: 'TestKey', output: ref('PaymentList') },
);
add(
  'post',
  '/v1/payments',
  'Payments API',
  'Create an idempotent pending payment',
  {
    auth: 'TestKey',
    body: ref('NewPayment'),
    output: ref('Payment'),
    parameters: [idem],
    description:
      'Concurrent requests with the same merchant/key create one payment. Same normalized details replay the original PENDING creation response. Different details return409.',
  },
);
add(
  'get',
  '/v1/payments/{id}',
  'Payments API',
  'Get a merchant-scoped payment and state history',
  { auth: 'TestKey', output: ref('Payment') },
);
add(
  'get',
  '/v1/checkout/{id}',
  'Hosted checkout',
  'Read checkout receipt and expire overdue pending payments',
  {
    output: ref('Checkout'),
    description:
      'Random checkout UUID is a capability link. No real payment details are accepted.',
  },
);
add(
  'post',
  '/v1/checkout/{id}/challenge',
  'Hosted checkout',
  'Start a fake verification step',
  {
    code: 200,
    body: object(
      {
        method: {
          type: 'string',
          enum: ['card', 'bkash', 'nagad', 'rocket', 'bank'],
        },
      },
      ['method'],
      true,
    ),
    output: ref('Challenge'),
  },
);
add(
  'post',
  '/v1/checkout/{id}/confirm',
  'Hosted checkout',
  'Simulate success or failure using the public practice code',
  {
    code: 200,
    body: object(
      {
        challenge_id: id,
        code: {
          type: 'string',
          pattern: '^\\d{6}$',
          description:
            'Use displayed practice code000000. Never use a real OTP.',
        },
        outcome: { type: 'string', enum: ['success', 'failure'] },
      },
      ['challenge_id', 'code', 'outcome'],
      true,
    ),
    output: ref('Checkout'),
  },
);
for (const action of ['cancel', 'expire'])
  add(
    'post',
    `/v1/checkout/{id}/${action}`,
    'Hosted checkout',
    `Simulate ${action}`,
    { code: 200, body: empty, output: ref('Checkout') },
  );
add(
  'get',
  '/v1/shop/catalog',
  'Demo shop',
  'Get server-priced fictional products',
  {
    output: object({
      products: array(object({ id: str(), name: str(), price_paisa: paisa })),
      ...demo,
    }),
  },
);
add(
  'post',
  '/v1/shop/orders',
  'Demo shop',
  'Create a cart order with authoritative server prices',
  {
    auth: 'TestKey',
    parameters: [idem],
    body: object(
      {
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: object(
            {
              product_id: str(),
              quantity: { type: 'integer', minimum: 1, maximum: 10 },
            },
            ['product_id', 'quantity'],
            true,
          ),
        },
      },
      ['items'],
      true,
    ),
    output: object({
      ...(payment.properties as Record<string, Schema>),
      items: array(
        object({
          product_id: str(),
          name: str(),
          quantity: { type: 'integer' },
          unit_price_paisa: paisa,
          line_total_paisa: paisa,
        }),
      ),
    }),
  },
);
add(
  'get',
  '/v1/shop/orders/{id}',
  'Demo shop',
  'Read the immutable order snapshot and actual payment result',
  {
    auth: 'TestKey',
    output: object({
      ...(payment.properties as Record<string, Schema>),
      items: array(object({})),
    }),
  },
);
merchant('post', 'signup', 'Create a classroom merchant and session', {
  auth: undefined,
  body: object(
    {
      ...(login.properties as Record<string, Schema>),
      business_name: { type: 'string', minLength: 1, maxLength: 100 },
    },
    ['email', 'password', 'business_name'],
    true,
  ),
  output: ref('LoginResult'),
});
for (const area of ['merchant', 'admin'] as const) {
  const fn = area === 'merchant' ? merchant : admin;
  fn('post', 'login', `Sign in to the ${area} account`, {
    auth: undefined,
    body: ref('Credentials'),
    output: ref('LoginResult'),
    headers: {
      'Set-Cookie': {
        description:
          'HttpOnly, SameSite=Strict session;8 hours. Secure when configured HTTPS.',
        schema: str(),
      },
    },
  });
  fn('post', 'logout', 'Revoke the current server session', {
    body: empty,
    output: ref('LoginResult'),
  });
  fn('get', 'me', 'Read current signed-in account', {
    output:
      area === 'merchant'
        ? ref('Merchant')
        : object({ id, email: { type: 'string', format: 'email' } }),
  });
}
merchant('get', 'payments', 'Search transactions and aggregate charts', {
  parameters: [...filters, page],
  output: ref('MerchantTransactions'),
  description:
    'Gross paid volume is before refunds. Success rate counts paid/refunded states over all matching requests. Chart shows latest60 active days.',
});
merchant(
  'get',
  'payments/export',
  'Download a filtered CSV (up to10000 rows)',
  {
    parameters: filters,
    media: 'text/csv',
    output: str(),
    description:
      'Spreadsheet formula prefixes are neutralized. Narrow filters if more than10000 rows match.',
  },
);
merchant('get', 'payments/{id}', 'Read payment details and state timeline', {
  output: ref('Payment'),
});
merchant('post', 'demo-payment', 'Create an own-account demo checkout', {
  body: ref('NewPayment'),
  parameters: [idem],
  output: object({ id }),
});
merchant('get', 'keys', 'List key metadata; live mode remains disabled', {
  output: object({
    keys: array(
      object({
        id,
        name: str(),
        mode: { type: 'string', enum: ['TEST'] },
        revoked_at: { ...time, nullable: true },
      }),
    ),
    live_enabled: { type: 'boolean', enum: [false] },
  }),
});
merchant('post', 'keys', 'Generate a test API key, returned exactly once', {
  body: empty,
  output: object({
    api_key: str(
      'One-time secret; copy securely. Do not place it in source, logs or screenshots.',
    ),
    notice: str(),
  }),
});
merchant('post', 'keys/{id}/revoke', 'Revoke an own-account test key', {
  body: empty,
  output: ref('LoginResult'),
});
merchant(
  'get',
  'payments/{id}/refunds',
  'Read refund records and remaining balance',
  { output: ref('Refunds') },
);
merchant(
  'post',
  'payments/{id}/refunds',
  'Record a full remaining or partial simulated refund',
  {
    body: object(
      {
        amount_paisa: paisa,
        reason: { type: 'string', minLength: 1, maxLength: 200 },
      },
      ['reason'],
      true,
    ),
    parameters: [idem],
    output: ref('RefundResult'),
    description:
      'Omit amount_paisa for all remaining balance. Payment-row locks and DB guards prevent over-refunds. Unknown legacy partial amounts block further refunds. Each successful simulation records REQUESTED→SUCCEEDED.',
  },
);
merchant(
  'get',
  'webhooks',
  'Read local webhook settings without signing material',
  { output: ref('WebhookSettings') },
);
merchant(
  'post',
  'webhooks',
  'Enable or pause the built-in receiver and select a scenario',
  {
    body: object(
      {
        enabled: { type: 'boolean' },
        receiver_mode: {
          type: 'string',
          enum: ['success', 'fail_twice', 'always_fail'],
        },
      },
      ['enabled', 'receiver_mode'],
      true,
    ),
    output: ref('WebhookSettings'),
    description:
      'Arbitrary destination URLs are rejected. Disabling pauses existing events and stops new events. Automatic attempts use2/4/8/16-second delays; five attempts per batch.',
  },
);
merchant(
  'get',
  'webhooks/events',
  'Read latest100 own-account events and delivery attempts',
  { output: ref('WebhookEvents') },
);
merchant(
  'post',
  'webhooks/events/{id}/retry',
  'Queue another retry batch for a failed/retry event',
  { body: empty, output: ref('LoginResult') },
);
add(
  'post',
  '/v1/demo/webhook-receiver',
  'Signed webhooks',
  'Built-in HMAC receiver used by the local worker',
  {
    code: 200,
    parameters: [
      header('X-PayBD-Event', id, 'Persisted event UUID.'),
      header(
        'X-PayBD-Timestamp',
        { type: 'string', pattern: '^\\d{10}$' },
        'Unix seconds within five minutes of server time.',
      ),
      header(
        'X-PayBD-Signature',
        { type: 'string', pattern: '^[a-f0-9]{64}$' },
        'HMAC-SHA256(timestamp + dot + exact raw body), hexadecimal. Private signing material is never returned.',
      ),
    ],
    body: object({
      id,
      type: str(),
      created_at: time,
      data: object({}),
      test_mode: { type: 'boolean', enum: [true] },
    }),
    output: object({
      accepted: { type: 'boolean' },
      test_mode: { type: 'boolean', enum: [true] },
    }),
    description:
      'Local worker signs delivery. Receiver verifies constant-time HMAC, timestamp and event ID; deduplicates receipts. Invalid signature401, configured simulated failure503, success200. No external provider is contacted.',
  },
);
paths['/v1/demo/webhook-receiver'].post.responses = {
  ...(paths['/v1/demo/webhook-receiver'].post.responses as Record<
    string,
    unknown
  >),
  401: { description: 'Invalid or stale HMAC signature' },
  503: { description: 'Configured fake receiver failure; worker retries' },
};
merchant('get', 'links', 'List latest100 payment links', {
  output: object({ links: array(ref('Link')), ...demo }),
});
merchant('post', 'links', 'Create a one-time or reusable shareable link', {
  body: object(
    {
      title: { type: 'string', minLength: 1, maxLength: 120 },
      amount_paisa: paisa,
      expires_at: time,
      reusable: { type: 'boolean' },
    },
    ['title', 'amount_paisa', 'expires_at', 'reusable'],
    true,
  ),
  output: ref('Link'),
});
merchant('get', 'links/{id}/qr', 'Download the link QR image', {
  media: 'image/png',
  output: { type: 'string', format: 'binary' },
});
add(
  'get',
  '/v1/pay/{id}',
  'Payment links',
  'Read safe public payment-link information',
  { output: ref('Link') },
);
add(
  'post',
  '/v1/pay/{id}/checkout',
  'Payment links',
  'Start or reuse a link checkout',
  {
    body: empty,
    parameters: [idem],
    output: ref('Payment'),
    description:
      'One-time links share a pending checkout and remain used after successful payment, even after refund. Failed/cancelled attempts can be retried. Reusable links create new payments for fresh keys. Payment expiry never exceeds link expiry.',
  },
);
merchant('get', 'invoices', 'List latest100 invoice summaries', {
  output: object({ invoices: array(ref('Invoice')), ...demo }),
});
merchant('post', 'invoices', 'Create a draft with server-computed totals', {
  body: object(
    {
      customer_name: { type: 'string', minLength: 1, maxLength: 120 },
      customer_email: { type: 'string', format: 'email', maxLength: 254 },
      due_at: time,
      items: { type: 'array', minItems: 1, maxItems: 30, items: line },
    },
    ['customer_name', 'customer_email', 'due_at', 'items'],
    true,
  ),
  output: ref('Invoice'),
});
merchant(
  'get',
  'invoices/{id}',
  'Read an invoice with reminders and derived overdue status',
  { output: ref('Invoice') },
);
merchant(
  'post',
  'invoices/{id}/send',
  'Send in-app and create its one-time payment link',
  {
    body: empty,
    output: ref('Invoice'),
    description:
      'No email or SMS is sent. Repeated send reuses the invoice link. Successful payment marks PAID; sent invoices past due display OVERDUE.',
  },
);
merchant(
  'post',
  'invoices/{id}/remind',
  'Record an in-app reminder for an unpaid sent invoice',
  { body: empty, output: ref('Invoice') },
);
merchant('get', 'invoices/{id}/pdf', 'Download a fictional invoice PDF', {
  media: 'application/pdf',
  output: { type: 'string', format: 'binary' },
});
merchant(
  'get',
  'finance',
  'Read balances, latest100 journals, settlements and payouts',
  { output: ref('Finance') },
);
merchant(
  'get',
  'finance/reconciliation',
  'Compare payment, refund, payout and ledger totals',
  { output: ref('Reconciliation') },
);
merchant('post', 'finance/settlements', 'Reserve available fictional balance', {
  body: object({ amount_paisa: paisa }, [], true),
  parameters: [idem],
  output: ref('Settlement'),
  description:
    'Omit amount for all positive available balance. Unknown legacy refund amounts block settlement. Debits and credits are enforced by database constraints.',
});
merchant(
  'post',
  'finance/settlements/{id}/payout',
  'Record one simulated payout for a settlement',
  {
    body: empty,
    parameters: [idem],
    output: ref('Payout'),
    description:
      'Requires sufficient reserved and clearing balances. No bank-account details or real transfer are used.',
  },
);
admin(
  'get',
  'setup-status',
  'Check whether the first administrator must be created',
  { auth: undefined, output: object({ setup_required: { type: 'boolean' } }) },
);
admin('post', 'setup', 'Create the first local demo administrator', {
  auth: undefined,
  body: ref('Credentials'),
  output: ref('LoginResult'),
  description:
    'Allowed only while no admin account exists; concurrent setup has one winner. Choose your own demo-only password. No preset credentials exist.',
});
admin('get', 'merchants', 'Search and review all merchants', {
  parameters: [
    search,
    query('status', {
      type: 'string',
      enum: ['ACTIVE', 'SUSPENDED', 'PENDING'],
    }),
    page,
  ],
  output: object({
    merchants: array(ref('Merchant')),
    total: { type: 'integer' },
    page: { type: 'integer' },
    ...demo,
  }),
});
admin(
  'post',
  'merchants/{id}/status',
  'Approve or suspend a merchant with an audit reason',
  {
    body: object(
      {
        status: { type: 'string', enum: ['ACTIVE', 'SUSPENDED'] },
        reason: { type: 'string', minLength: 1, maxLength: 200 },
      },
      ['status', 'reason'],
      true,
    ),
    output: ref('Merchant'),
    description:
      'Classroom signup is automatically active. Approval records review; suspension blocks new payments and pending checkout completion. Records and refunds remain available.',
  },
);
admin(
  'get',
  'transactions',
  'Search all transactions with rule-based risk flags',
  {
    parameters: [search, statusQuery, query('merchant_id', id), page],
    output: object({
      payments: array(
        object({
          ...(payment.properties as Record<string, Schema>),
          business_name: str(),
          risk_flags: array(str()),
        }),
      ),
      total: { type: 'integer' },
      page: { type: 'integer' },
      ...demo,
    }),
  },
);
admin('get', 'risk', 'Inspect unusual amounts and repeated failures', {
  output: ref('Risk'),
});
admin('get', 'audit', 'Read immutable safe-field audit events', {
  parameters: [
    query('action', { type: 'string', pattern: '^[a-z_.]{1,80}$' }),
    query('merchant_id', id),
    page,
  ],
  output: ref('Audit'),
});
merchant(
  'post',
  'demo-data',
  'Load repeatable fictional examples into your own dashboard',
  {
    body: empty,
    output: object({ created: { type: 'boolean' }, ...demo }),
    description:
      'Adds one set of realistic examples for the signed-in active merchant. Concurrent/repeated requests do not duplicate samples or overwrite existing work.',
  },
);

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'PayBD Demo API',
    version: '1.0.0-m8',
    description:
      'DEMO MODE: no real money. MIS465 classroom gateway. Never submit real cards, PINs, OTPs or provider credentials. Monetary values are integer paisa; the UI displays Bangladeshi taka. This local Swagger explorer permits GET requests only: perform authenticated mutations in the web app on port3001, or use an API client with the required Origin/header/cookie. Sessions are HttpOnly; sign in through the web app on the same hostname to inspect session-protected GETs. API keys are generated once in the merchant dashboard and must not be logged or shared. There is no live mode. Swagger assets are served locally; no CDN or external validator is used.',
  },
  servers: [
    { url: '/', description: 'Current origin: hosted website or local API' },
  ],
  tags: [
    { name: 'System' },
    { name: 'Payments API' },
    { name: 'Hosted checkout' },
    { name: 'Demo shop' },
    { name: 'Merchant dashboard' },
    { name: 'Signed webhooks' },
    { name: 'Payment links' },
    { name: 'Administration' },
  ],
  paths,
  components: {
    schemas,
    securitySchemes: {
      TestKey: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'PayBD test API key',
        description:
          'A generated paybd_test_ key. Live keys are disabled; do not use a real provider key.',
      },
      MerchantSession: {
        type: 'apiKey',
        in: 'cookie',
        name: 'paybd_session',
        description:
          'HttpOnly cookie set by merchant signup/login; browser cannot set this manually through Swagger.',
      },
      AdminSession: {
        type: 'apiKey',
        in: 'cookie',
        name: 'paybd_admin_session',
        description: 'Separate HttpOnly administrator session.',
      },
    },
  },
};
