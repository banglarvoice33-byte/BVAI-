import pg from 'pg';
const {SUPABASE_DB_URL,NEWSROOM_INGEST_KEY,SUPABASE_DB_CA} = process.env;
if (!SUPABASE_DB_URL || !NEWSROOM_INGEST_KEY || NEWSROOM_INGEST_KEY.length < 32) throw new Error('New DB URL and strong ingest key required');
const connection = new URL(SUPABASE_DB_URL);
// Explicit TLS verification; URL sslmode parameters must not override this boundary.
for(const name of ['sslmode','sslcert','sslkey','sslrootcert']) connection.searchParams.delete(name);
const client = new pg.Client({connectionString:connection.href,ssl:{rejectUnauthorized:true,...(SUPABASE_DB_CA ? {ca:SUPABASE_DB_CA} : {})}});
try {
 await client.connect(); await client.query('begin');
 const created=await client.query('select vault.create_secret($1,$2,$3) as id',[NEWSROOM_INGEST_KEY,'NEWSROOM_INGEST_KEY','New deployment ingest credential']);
 await client.query(`insert into public.api_vault(service_name,key_encrypted,environment,is_active)
 values ('NEWSROOM_INGEST_KEY',$1,'prod',true)
 on conflict (service_name,environment) do update set key_encrypted=excluded.key_encrypted,is_active=true,updated_at=now()`,[created.rows[0].id]);
 await client.query('commit'); console.log('New ingest secret stored in Vault; value not printed.');
} catch(error){await client.query('rollback').catch(()=>{}); console.error('Vault bootstrap failed; verify DB TLS and schema before retrying.');process.exitCode=1;}
finally{await client.end();}
