import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Full translation of the MongoDB collections into Convex tables.
//
// Migration strategy: the app relates documents by their original string ids
// (org_id, user_id, customer_id, product_id, ...). We KEEP those string ids as
// regular indexed fields (not Convex's _id), so every existing relationship
// keeps working without rewriting references. `schemaValidation: false` lets the
// one-shot Mongo import tolerate field drift; functions below stay strongly typed.
export default defineSchema(
  {
    users: defineTable({
      user_id: v.string(),
      email: v.string(),
      phone: v.optional(v.string()),
      name: v.optional(v.union(v.string(), v.null())),
      picture: v.optional(v.union(v.string(), v.null())),
      role: v.optional(v.union(v.string(), v.null())),
      employee_type: v.optional(v.union(v.string(), v.null())),
      org_id: v.optional(v.union(v.string(), v.null())),
      consent_at: v.optional(v.union(v.string(), v.null())),
      last_location: v.optional(v.any()),
      created_at: v.optional(v.string()),
    })
      .index("by_user_id", ["user_id"])
      .index("by_email", ["email"])
      .index("by_phone", ["phone"])
      .index("by_org", ["org_id"]),

    otp_requests: defineTable({
      phone: v.string(),
      created_ms: v.number(),
      attempts: v.optional(v.number()),
      code_hash: v.optional(v.string()),
      expires_ms: v.optional(v.number()),
    }).index("by_phone", ["phone"]),

    user_sessions: defineTable({
      session_token: v.string(),
      user_id: v.string(),
      device_id: v.optional(v.string()),
      device: v.optional(v.string()),
      platform: v.optional(v.string()),
      last_seen_at: v.optional(v.string()),
      expires_at: v.optional(v.union(v.string(), v.number())),
      created_at: v.optional(v.union(v.string(), v.number())),
      // Set when the session was opened by a fresh SMS code: allows (re)setting the password for 15 min.
      pw_reset_until: v.optional(v.number()),
    })
      .index("by_token", ["session_token"])
      .index("by_user", ["user_id"]),

    // Password credentials live in their own table so they can never leak through user documents.
    user_passwords: defineTable({
      user_id: v.string(),
      hash: v.string(),
      salt: v.string(),
      failed: v.optional(v.number()),
      locked_until_ms: v.optional(v.number()),
      updated_at: v.optional(v.string()),
    }).index("by_user", ["user_id"]),

    organizations: defineTable({
      id: v.string(),
      name: v.optional(v.string()),
      owner_id: v.optional(v.string()),
      owner_email: v.optional(v.string()),
      status: v.optional(v.string()),
      plan: v.optional(v.string()),
      plan_name: v.optional(v.string()),
      plan_tier: v.optional(v.string()),
      modules: v.optional(v.array(v.string())),
      max_distributors: v.optional(v.union(v.number(), v.null())),
      max_customers: v.optional(v.union(v.number(), v.null())),
      plan_id: v.optional(v.string()),
      grace_until: v.optional(v.union(v.string(), v.null())),
      max_employees: v.optional(v.number()),
      expires_at: v.optional(v.string()),
      created_at: v.optional(v.string()),
      logo_path: v.optional(v.string()),
      logo_type: v.optional(v.string()),
      currency: v.optional(v.string()),
      alt_currency: v.optional(v.string()),
      exchange_rate: v.optional(v.number()),
      phone: v.optional(v.string()),
      email: v.optional(v.string()),
      address: v.optional(v.string()),
      tax_no: v.optional(v.string()),
      cr_no: v.optional(v.string()),
      invoice_footer: v.optional(v.string()),
      phone_country_code: v.optional(v.string()),
      last_debt_digest_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_status", ["status"]),

    licenses: defineTable({
      id: v.string(),
      code: v.string(),
      org_name: v.optional(v.string()),
      days: v.optional(v.number()),
      max_employees: v.optional(v.number()),
      status: v.optional(v.string()),
      org_id: v.optional(v.string()),
      used_by: v.optional(v.string()),
      activated_at: v.optional(v.string()),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_code", ["code"]),

    invitations: defineTable({
      id: v.string(),
      org_id: v.string(),
      code: v.string(),
      name: v.optional(v.string()),
      employee_type: v.optional(v.string()),
      used: v.optional(v.boolean()),
      user_id: v.optional(v.string()),
      used_at: v.optional(v.string()),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_code", ["code"])
      .index("by_org", ["org_id"]),

    products: defineTable({
      id: v.string(),
      org_id: v.string(),
      name: v.string(),
      category: v.optional(v.string()),
      unit: v.optional(v.string()),
      cost_price: v.optional(v.number()),
      sale_price: v.optional(v.number()),
      stock: v.optional(v.number()),
      min_stock: v.optional(v.number()),
      // Dual unit + currency support.
      price_currency: v.optional(v.string()), // "SYP" | "USD" — currency of sale_price/cost_price (piece)
      pieces_per_package: v.optional(v.number()), // pieces inside one package/carton
      package_unit: v.optional(v.string()), // label for the package unit (e.g. "كرتونة")
      package_price: v.optional(v.number()), // optional cached package sale price (piece * ppp)
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"]),

    customers: defineTable({
      id: v.string(),
      org_id: v.string(),
      name: v.optional(v.string()),
      phone: v.optional(v.string()),
      address: v.optional(v.string()),
      location: v.optional(v.string()),
      type_id: v.optional(v.union(v.string(), v.null())),
      lat: v.optional(v.union(v.number(), v.null())),
      lng: v.optional(v.union(v.number(), v.null())),
      balance: v.optional(v.number()),
      distributor_id: v.optional(v.string()),
      distributor_name: v.optional(v.union(v.string(), v.null())),
      created_by: v.optional(v.string()),
      last_reminder_at: v.optional(v.union(v.string(), v.null())),
      last_reminder_by: v.optional(v.union(v.string(), v.null())),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"])
      .index("by_distributor", ["distributor_id"]),

    customer_types: defineTable({
      id: v.string(),
      org_id: v.string(),
      name: v.optional(v.string()),
      prices: v.optional(v.any()),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"]),

    sales: defineTable({
      id: v.string(),
      org_id: v.string(),
      invoice_no: v.optional(v.string()),
      customer_id: v.optional(v.string()),
      customer_name: v.optional(v.string()),
      distributor_id: v.optional(v.string()),
      distributor_name: v.optional(v.union(v.string(), v.null())),
      items: v.optional(v.any()),
      subtotal: v.optional(v.number()),
      discount_type: v.optional(v.string()),
      discount_value: v.optional(v.number()),
      discount_amount: v.optional(v.number()),
      total: v.optional(v.number()),
      paid_amount: v.optional(v.number()),
      remaining: v.optional(v.number()),
      payment_type: v.optional(v.string()),
      notes: v.optional(v.string()),
      // Historical currency snapshot — immutable once the invoice is created.
      exchange_rate: v.optional(v.number()),
      currency: v.optional(v.string()),
      lat: v.optional(v.union(v.number(), v.null())),
      lng: v.optional(v.union(v.number(), v.null())),
      client_created_at: v.optional(v.union(v.string(), v.null())),
      voided: v.optional(v.boolean()),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"])
      .index("by_distributor", ["distributor_id"])
      .index("by_customer", ["customer_id"]),

    collections: defineTable({
      id: v.string(),
      org_id: v.string(),
      receipt_no: v.optional(v.string()),
      customer_id: v.optional(v.string()),
      customer_name: v.optional(v.string()),
      amount: v.optional(v.number()),
      notes: v.optional(v.string()),
      // Historical currency snapshot.
      exchange_rate: v.optional(v.number()),
      currency: v.optional(v.string()),
      amount_input: v.optional(v.number()),
      input_currency: v.optional(v.string()),
      collector_id: v.optional(v.string()),
      collector_name: v.optional(v.union(v.string(), v.null())),
      lat: v.optional(v.union(v.number(), v.null())),
      lng: v.optional(v.union(v.number(), v.null())),
      client_created_at: v.optional(v.union(v.string(), v.null())),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"])
      .index("by_collector", ["collector_id"])
      .index("by_customer", ["customer_id"]),

    sales_returns: defineTable({
      id: v.string(),
      org_id: v.string(),
      return_no: v.optional(v.string()),
      customer_id: v.optional(v.string()),
      customer_name: v.optional(v.string()),
      distributor_id: v.optional(v.string()),
      distributor_name: v.optional(v.union(v.string(), v.null())),
      items: v.optional(v.any()),
      total: v.optional(v.number()),
      reason: v.optional(v.string()),
      lat: v.optional(v.union(v.number(), v.null())),
      lng: v.optional(v.union(v.number(), v.null())),
      client_created_at: v.optional(v.union(v.string(), v.null())),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"])
      .index("by_distributor", ["distributor_id"])
      .index("by_customer", ["customer_id"]),

    payment_vouchers: defineTable({
      id: v.string(),
      org_id: v.string(),
      voucher_no: v.optional(v.string()),
      customer_id: v.optional(v.string()),
      customer_name: v.optional(v.string()),
      amount: v.optional(v.number()),
      notes: v.optional(v.string()),
      // Historical currency snapshot.
      exchange_rate: v.optional(v.number()),
      currency: v.optional(v.string()),
      amount_input: v.optional(v.number()),
      input_currency: v.optional(v.string()),
      distributor_id: v.optional(v.string()),
      distributor_name: v.optional(v.union(v.string(), v.null())),
      lat: v.optional(v.union(v.number(), v.null())),
      lng: v.optional(v.union(v.number(), v.null())),
      client_created_at: v.optional(v.union(v.string(), v.null())),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"])
      .index("by_distributor", ["distributor_id"])
      .index("by_customer", ["customer_id"]),

    purchases: defineTable({
      id: v.string(),
      org_id: v.string(),
      product_id: v.optional(v.string()),
      product_name: v.optional(v.string()),
      quantity: v.optional(v.number()),
      unit_cost: v.optional(v.number()),
      total: v.optional(v.number()),
      supplier: v.optional(v.string()),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"]),

    purchase_returns: defineTable({
      id: v.string(),
      org_id: v.string(),
      product_id: v.optional(v.string()),
      product_name: v.optional(v.string()),
      quantity: v.optional(v.number()),
      unit_cost: v.optional(v.number()),
      total: v.optional(v.number()),
      supplier: v.optional(v.string()),
      reason: v.optional(v.string()),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"]),

    suppliers: defineTable({
      id: v.string(),
      org_id: v.string(),
      name: v.string(),
      phone: v.optional(v.string()),
      updated_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"]),

    supplier_payments: defineTable({
      id: v.string(),
      org_id: v.string(),
      voucher_no: v.optional(v.string()),
      supplier: v.string(),
      amount: v.number(), // base currency (SYP)
      amount_input: v.optional(v.number()),
      input_currency: v.optional(v.string()),
      exchange_rate: v.optional(v.number()),
      currency: v.optional(v.string()),
      notes: v.optional(v.string()),
      created_by_name: v.optional(v.union(v.string(), v.null())),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"]),

    deliveries: defineTable({
      id: v.string(),
      org_id: v.string(),
      distributor_id: v.optional(v.string()),
      distributor_name: v.optional(v.union(v.string(), v.null())),
      items: v.optional(v.any()),
      notes: v.optional(v.string()),
      status: v.optional(v.string()),
      confirmed_at: v.optional(v.string()),
      reject_reason: v.optional(v.string()),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"])
      .index("by_distributor", ["distributor_id"]),

    warehouse_returns: defineTable({
      id: v.string(),
      org_id: v.string(),
      return_no: v.optional(v.string()),
      distributor_id: v.optional(v.string()),
      distributor_name: v.optional(v.union(v.string(), v.null())),
      items: v.optional(v.any()),
      notes: v.optional(v.string()),
      status: v.optional(v.string()),
      handled_at: v.optional(v.string()),
      handled_by: v.optional(v.union(v.string(), v.null())),
      reject_reason: v.optional(v.string()),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"])
      .index("by_distributor", ["distributor_id"]),

    distributor_inventory: defineTable({
      org_id: v.optional(v.string()),
      distributor_id: v.string(),
      product_id: v.string(),
      product_name: v.optional(v.string()),
      quantity: v.optional(v.number()),
    })
      .index("by_distributor", ["distributor_id"])
      .index("by_dist_product", ["distributor_id", "product_id"])
      .index("by_org", ["org_id"]),

    stock_movements: defineTable({
      org_id: v.string(),
      product_id: v.optional(v.string()),
      product_name: v.optional(v.string()),
      type: v.optional(v.string()),
      qty: v.optional(v.number()),
      by: v.optional(v.union(v.string(), v.null())),
      by_role: v.optional(v.string()),
      at: v.optional(v.string()),
    })
      .index("by_org", ["org_id"])
      .index("by_product", ["product_id"]),

    stock_requests: defineTable({
      id: v.string(),
      org_id: v.string(),
      distributor_id: v.optional(v.string()),
      distributor_name: v.optional(v.union(v.string(), v.null())),
      items: v.optional(v.any()),
      status: v.optional(v.string()),
      notes: v.optional(v.string()),
      handled_at: v.optional(v.string()),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"])
      .index("by_distributor", ["distributor_id"]),

    counters: defineTable({
      org_id: v.string(),
      kind: v.string(),
      n: v.optional(v.number()),
    }).index("by_org_kind", ["org_id", "kind"]),

    routes: defineTable({
      id: v.string(),
      org_id: v.string(),
      distributor_id: v.optional(v.string()),
      distributor_name: v.optional(v.union(v.string(), v.null())),
      date: v.optional(v.string()),
      stops: v.optional(v.any()),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"])
      .index("by_distributor", ["distributor_id"])
      .index("by_dist_date", ["distributor_id", "date"]),

    agent_locations: defineTable({
      org_id: v.string(),
      user_id: v.string(),
      lat: v.optional(v.number()),
      lng: v.optional(v.number()),
      accuracy: v.optional(v.union(v.number(), v.null())),
      at: v.optional(v.string()),
    })
      .index("by_user", ["user_id"])
      .index("by_org_user", ["org_id", "user_id"]),

    sales_targets: defineTable({
      org_id: v.string(),
      distributor_id: v.string(),
      month: v.string(),
      amount: v.number(),
      created_at: v.optional(v.string()),
      updated_at: v.optional(v.string()),
    }).index("by_org_month", ["org_id", "month"]),

    plans: defineTable({
      id: v.string(),
      name: v.optional(v.string()),
      description: v.optional(v.string()),
      price: v.optional(v.number()),
      promo_price: v.optional(v.union(v.number(), v.null())),
      promo_until: v.optional(v.union(v.string(), v.null())),
      currency: v.optional(v.string()),
      days: v.optional(v.number()),
      trial_days: v.optional(v.number()),
      grace_days: v.optional(v.number()),
      max_employees: v.optional(v.number()),
      max_distributors: v.optional(v.union(v.number(), v.null())),
      max_customers: v.optional(v.union(v.number(), v.null())),
      tier: v.optional(v.string()),
      modules: v.optional(v.array(v.string())),
      features: v.optional(v.any()),
      active: v.optional(v.boolean()),
      recommended: v.optional(v.boolean()),
      sort_order: v.optional(v.number()),
      yearly_price: v.optional(v.union(v.number(), v.null())),
      // Draft → publish workflow: owners only ever see `published` (a snapshot of the fields above).
      status: v.optional(v.string()), // draft | published | changed | archived
      published: v.optional(v.any()),
      version: v.optional(v.number()),
      created_at: v.optional(v.string()),
      updated_at: v.optional(v.string()),
    }).index("by_biz_id", ["id"]),

    plan_versions: defineTable({
      plan_id: v.string(),
      version: v.number(),
      snapshot: v.any(),
      published_by: v.optional(v.string()),
      published_at: v.string(),
    }).index("by_plan", ["plan_id", "version"]),

    payment_methods: defineTable({
      id: v.string(),
      name: v.string(),
      kind: v.optional(v.string()), // bank | wallet | cash | other
      description: v.optional(v.string()),
      recipient: v.optional(v.string()),
      account: v.optional(v.string()),
      currency: v.optional(v.string()),
      instructions: v.optional(v.string()),
      require_reference: v.optional(v.boolean()),
      require_receipt: v.optional(v.boolean()),
      min_amount: v.optional(v.union(v.number(), v.null())),
      max_amount: v.optional(v.union(v.number(), v.null())),
      plan_ids: v.optional(v.array(v.string())),
      org_ids: v.optional(v.array(v.string())),
      active: v.optional(v.boolean()),
      archived: v.optional(v.boolean()),
      sort_order: v.optional(v.number()),
      qr_storage: v.optional(v.union(v.string(), v.null())),
      qr_type: v.optional(v.string()),
      created_at: v.optional(v.string()),
      updated_at: v.optional(v.string()),
    }).index("by_biz_id", ["id"]),

    audit_logs: defineTable({
      actor_id: v.optional(v.string()),
      actor_role: v.optional(v.string()),
      action: v.string(),
      org_id: v.optional(v.string()),
      target: v.optional(v.string()),
      before: v.optional(v.any()),
      after: v.optional(v.any()),
      note: v.optional(v.string()),
      created_at: v.string(),
    }).index("by_org", ["org_id"]),

    app_settings: defineTable({
      key: v.string(),
      payment_address: v.optional(v.string()),
      whatsapp: v.optional(v.string()),
      instructions: v.optional(v.string()),
      data: v.optional(v.any()),
    }).index("by_key", ["key"]),

    upgrade_requests: defineTable({
      id: v.string(),
      org_id: v.string(),
      ref_code: v.optional(v.string()),
      idem_key: v.optional(v.string()),
      owner_id: v.optional(v.string()),
      method_id: v.optional(v.string()),
      method_name: v.optional(v.string()),
      amount: v.optional(v.number()),
      amount_mismatch: v.optional(v.boolean()),
      receipt_storage: v.optional(v.union(v.string(), v.null())),
      receipt_type: v.optional(v.string()),
      receipt_size: v.optional(v.number()),
      history: v.optional(v.any()),
      reviewer_id: v.optional(v.string()),
      grace_days: v.optional(v.number()),
      max_customers: v.optional(v.union(v.number(), v.null())),
      tier: v.optional(v.string()),
      modules: v.optional(v.array(v.string())),
      max_distributors: v.optional(v.union(v.number(), v.null())),
      org_name: v.optional(v.string()),
      owner_email: v.optional(v.string()),
      plan_id: v.optional(v.string()),
      plan_name: v.optional(v.string()),
      billing: v.optional(v.string()),
      price: v.optional(v.number()),
      currency: v.optional(v.string()),
      days: v.optional(v.number()),
      max_employees: v.optional(v.number()),
      payment_ref: v.optional(v.string()),
      notes: v.optional(v.string()),
      status: v.optional(v.string()),
      review_note: v.optional(v.string()),
      reviewed_at: v.optional(v.string()),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"])
      .index("by_status", ["status"]),

    notifications: defineTable({
      id: v.optional(v.string()),
      user_id: v.string(),
      type: v.optional(v.string()),
      title: v.optional(v.string()),
      body: v.optional(v.string()),
      read: v.optional(v.boolean()),
      created_at: v.optional(v.string()),
    }).index("by_user", ["user_id"]),

    deletion_requests: defineTable({
      id: v.string(),
      org_id: v.optional(v.string()),
      org_name: v.optional(v.string()),
      requested_by: v.optional(v.string()),
      status: v.optional(v.string()),
      note: v.optional(v.string()),
      created_at: v.optional(v.string()),
    })
      .index("by_biz_id", ["id"])
      .index("by_org", ["org_id"]),

    app_versions: defineTable({
      id: v.optional(v.string()),
      platform: v.optional(v.string()),
      min_version: v.optional(v.string()),
      latest_version: v.optional(v.string()),
      url: v.optional(v.string()),
      message: v.optional(v.string()),
      created_at: v.optional(v.string()),
    }).index("by_platform", ["platform"]),

    price_history: defineTable({
      org_id: v.string(),
      product_id: v.optional(v.string()),
      product_name: v.optional(v.string()),
      old_price: v.optional(v.number()),
      new_price: v.optional(v.number()),
      by: v.optional(v.union(v.string(), v.null())),
      at: v.optional(v.string()),
    })
      .index("by_org", ["org_id"])
      .index("by_product", ["product_id"]),
  },
  { schemaValidation: false },
);
