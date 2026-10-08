import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const checks = [
  ["splits", "split_id,title,total_amount,amount_per_person,num_payers,creator,tx_hash,created_at,status,settled_count,contract_address,group_id"],
  ["split_payments", "split_id,payer_address,paid_at,tx_hash,amount"],
  ["split_participants", "split_id,wallet_address,display_name,username_snapshot,status,tx_hash,created_at"],
  ["activities", "id,from_address,to_address,address,type,title,amount,timestamp,is_positive,tx_hash,split_id,counterparty,status"],
  ["profiles", "wallet_address,username,created_at"],
  ["groups", "id,organizer_wallet_address,name,created_at,updated_at"],
  ["group_members", "group_id,wallet_address,username_snapshot,created_at"],
  ["rate_limits", "bucket_key,window_start,request_count"],
];

let failed = false;
for (const [table, columns] of checks) {
  const { error } = await supabase.from(table).select(columns).limit(1);
  if (error) {
    failed = true;
    console.log(`FAIL ${table}: ${error.code || "unknown"} ${error.message}`);
  } else {
    console.log(`OK   ${table}`);
  }
}

const { error: rateLimitError } = await supabase.rpc("consume_rate_limit", {
  p_bucket_key: `diagnostic:${Date.now()}`,
  p_limit: 2,
  p_window_start: Math.floor(Date.now() / 60_000) * 60_000,
  p_reset_at: Math.floor(Date.now() / 60_000) * 60_000 + 60_000,
});
if (rateLimitError) {
  failed = true;
  console.log(`FAIL consume_rate_limit: ${rateLimitError.code || "unknown"} ${rateLimitError.message}`);
} else {
  console.log("OK   consume_rate_limit");
}

process.exitCode = failed ? 1 : 0;
