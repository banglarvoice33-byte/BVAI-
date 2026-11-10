BVAI Trusted-Source Gate patch — ১০/১১ নভেম্বর ২০২৬ (UTC)
APPLIED (BVAI, rtejxeamxeycnpcwnseo): migration 20261110233227_trusted_source_video_gate; scheduler bvai-newsroom-14m ACTIVE (23:33:01 UTC).
Code (এই zip-এ): scripts/pipeline/source-evidence.mjs (assertEditorial + videoGateBasis), নতুন test ৫টি pass। পুরোনো reliability assertion ৬টিও হাতে চালিয়ে pass।
NOT DONE / OPEN:
1) Facebook/Instagram credential নেই; TikTok audit/consent বাকি; YouTube pilot হয়নি।
2) প্রথম cycle-এ ৫টি article pending: image_not_related ×৩, identical_run ×১, ai_rewrite_deadline ×১ — quality gate শিথিল করা হয়নি।
3) Live DB-তে trg_field_report_to_pending_article/function অনুপস্থিত (migration list-এ আছে) → reporter→admin queue চলবে না। Admin/Studio অ্যাপ human_verified/verification_status লেখে এমন কোড source-এ পাওয়া যায়নি।
4) DB SQL contract test (continuity-contract.test.sql) এই gate অনুযায়ী আপডেট করা হয়নি; PostgreSQL এখানে নেই।
5) বাকি পুরোনো test ফাইল npm dependency ছাড়া এখানে চালানো যায়নি (network বন্ধ)।
Rollback: supabase/rollbacks/*.rollback.sql ; scheduler বন্ধ: supabase/operations/*.sql-এর শেষ লাইন।
