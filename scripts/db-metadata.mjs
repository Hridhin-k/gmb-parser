import nextEnv from '@next/env';
const {loadEnvConfig}=nextEnv;
import pg from 'pg';
import {writeFileSync} from 'node:fs';
loadEnvConfig(process.cwd());
const db = new pg.Client({connectionString:process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL});
await db.connect();
const tables={};
for (const row of (await db.query(`select table_name,column_name,udt_name from information_schema.columns where table_schema='public' order by table_name,ordinal_position`)).rows) {
  (tables[row.table_name]??={columns:{},relations:[]}).columns[row.column_name]=row.udt_name;
}
const foreignKeys=(await db.query(`select con.conname as name,cl.relname as source,ref.relname as target,
 array(select a.attname from unnest(con.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.num order by k.ord)::text[] as columns,
 array(select a.attname from unnest(con.confkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.num order by k.ord)::text[] as references,
 exists(select 1 from pg_constraint u where u.conrelid=con.conrelid and u.contype in ('p','u') and u.conkey=con.conkey) as unique
 from pg_constraint con join pg_class cl on cl.oid=con.conrelid join pg_class ref on ref.oid=con.confrelid
 join pg_namespace n on n.oid=cl.relnamespace join pg_namespace rn on rn.oid=ref.relnamespace
 where con.contype='f' and n.nspname='public' and rn.nspname='public' order by con.conname`)).rows;
for(const fk of foreignKeys){
 if (fk.columns.length > 1 && fk.columns.includes("workspace_id")) continue;
 tables[fk.source].relations.push({name:fk.name,table:fk.target,columns:fk.columns,references:fk.references,many:false});
 tables[fk.target].relations.push({name:fk.name,table:fk.source,columns:fk.references,references:fk.columns,many:!fk.unique});
}
const functions={};
for(const f of (await db.query(`select p.proname as name,p.proretset as set, t.typname as type,p.proargnames[1:p.pronargs] as args from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_type t on t.oid=p.prorettype where n.nspname='public' and p.proname like 'grm_%' and t.typname <> 'trigger' order by p.proname`)).rows) functions[f.name]={set:f.set,type:f.type,args:f.args};
writeFileSync('lib/db/metadata.json',JSON.stringify({tables,functions},null,2)+'\n');
await db.end(); console.log(`Generated metadata for ${Object.keys(tables).length} tables.`);
