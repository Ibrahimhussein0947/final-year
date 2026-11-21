// Usage: npm run locations:import-admin -w @ethiotalent/api            (dry run, changes nothing)
//        npm run locations:import-admin -w @ethiotalent/api -- --apply  (writes)
//
// Replaces the sample "zones" (mostly cities such as Bole or Adama) with the real zones, and adds every woreda under them.
// Data: prisma/seed/ethiopia-admin.json, built from the OCHA/HDX "Ethiopia - Subnational Administrative Boundaries"
// (COD-AB, version v04), licence CC BY-IGO. Names are English only; Amharic and Afaan Oromoo labels are not in that data.
// The "Contested" area is left out, and the zone HDX calls "Region 14" is named "Addis Ababa".
//
// Anything that points at an old zone (jobs, workers, organizations, ...) is moved to the matching new place:
// a woreda whose name matches, else the region. Each move is printed. Safe to run again.
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma';

type W = { name: string; pcode: string; lat: number | null; lng: number | null };
type Z = { name: string; pcode: string; lat: number | null; lng: number | null; woredas: W[] };
type R = { region: string; zones: Z[] };

const apply = process.argv.includes('--apply');
const data: R[] = JSON.parse(fs.readFileSync(path.join(__dirname, '../../prisma/seed/ethiopia-admin.json'), 'utf8'));
const norm = (s: string) => s.toLowerCase().replace(/\b(sub ?city|town|city|special|zuria)\b/g, '').replace(/[^a-z]/g, '');

async function main() {
  // Every column that references Location(id), read from the database so a table added later is not missed.
  const fks = await prisma.$queryRaw<{ t: string; c: string }[]>`
    SELECT cl.relname AS t, a.attname AS c
    FROM pg_constraint k JOIN pg_class cl ON cl.oid = k.conrelid
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
    WHERE k.contype = 'f' AND k.confrelid = '"Location"'::regclass AND cl.relname <> 'Location'`;
  let created = 0, moved = 0, removed = 0;
  const toRegion: string[] = [];

  for (const r of data) {
    const region = await prisma.location.findFirst({ where: { level: 'REGION', nameEn: r.region, parentId: null } });
    if (!region) { console.log(`! region not in database, skipped: ${r.region}`); continue; }
    const keepZoneIds = new Set<string>();
    const woredaByNorm = new Map<string, { zone: string; woreda: string }[]>();

    for (const z of r.zones) {
      let zone = await prisma.location.findUnique({ where: { parentId_nameEn: { parentId: region.id, nameEn: z.name } } });
      if (!zone) {
        created++;
        if (apply) zone = await prisma.location.create({ data: { level: 'ZONE', nameEn: z.name, parentId: region.id, lat: z.lat, lng: z.lng } });
      } else if (apply) {
        await prisma.location.update({ where: { id: zone.id }, data: { lat: z.lat ?? zone.lat, lng: z.lng ?? zone.lng } });
      }
      if (zone) keepZoneIds.add(zone.id);
      for (const w of z.woredas) {
        const k = norm(w.name);
        woredaByNorm.set(k, [...(woredaByNorm.get(k) ?? []), { zone: z.name, woreda: w.name }]);
        const have = zone && (await prisma.location.findUnique({ where: { parentId_nameEn: { parentId: zone.id, nameEn: w.name } } }));
        if (have) { if (apply) await prisma.location.update({ where: { id: have.id }, data: { lat: w.lat ?? have.lat, lng: w.lng ?? have.lng } }); continue; }
        created++;
        if (apply && zone) await prisma.location.create({ data: { level: 'WOREDA', nameEn: w.name, parentId: zone.id, lat: w.lat, lng: w.lng } });
      }
    }

    // Old sample zones that are not real zones: re-point everything that used them, then delete them.
    const old = await prisma.location.findMany({ where: { parentId: region.id, level: 'ZONE', id: { notIn: [...keepZoneIds] } } });
    for (const o of old) {
      // Places someone added under an old zone would be orphaned by deleting it (the parent link is set to null), so keep that zone.
      if ((await prisma.location.count({ where: { parentId: o.id } })) > 0) { console.log(`! kept old zone ${r.region} > ${o.nameEn}: it has places under it, move them by hand first`); continue; }
      let target: { id: string | null; label: string } = { id: region.id, label: `region ${r.region}` };
      let hits = woredaByNorm.get(norm(o.nameEn)) ?? [];
      if (hits.length > 1) {
        // Several woredas share the name (e.g. Adama, Adama Zuria, Adama Tulu...): prefer the exact one or the town/city.
        const lc = o.nameEn.toLowerCase();
        for (const wanted of [[`${lc} town`, `${lc} city`, `${lc} sub city`], [lc]]) {
          const best = hits.filter((h) => wanted.includes(h.woreda.toLowerCase()));
          if (best.length === 1) { hits = best; break; }
        }
      }
      if (hits.length === 1) {
        const zone = await prisma.location.findUnique({ where: { parentId_nameEn: { parentId: region.id, nameEn: hits[0].zone } } });
        const w = zone && (await prisma.location.findUnique({ where: { parentId_nameEn: { parentId: zone.id, nameEn: hits[0].woreda } } }));
        target = { id: w?.id ?? null, label: `woreda ${hits[0].woreda} (${hits[0].zone} zone)` };
      }
      if (target.id === region.id) toRegion.push(`${r.region} > ${o.nameEn}${hits.length > 1 ? ` (${hits.length} woredas share the name)` : ''}`);
      let refs = 0;
      for (const fk of fks) {
        const n = Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${fk.t}" WHERE "${fk.c}" = $1`, o.id))[0].n);
        refs += n;
        if (apply && n && target.id) await prisma.$executeRawUnsafe(`UPDATE "${fk.t}" SET "${fk.c}" = $1 WHERE "${fk.c}" = $2`, target.id, o.id);
      }
      console.log(`old zone ${r.region} > ${o.nameEn}: ${refs} reference(s) -> ${target.label}`);
      moved += refs;
      removed++;
      if (apply) {
        if (!target.id) throw new Error(`target woreda for ${o.nameEn} was not created`);
        await prisma.location.delete({ where: { id: o.id } });
      }
    }
  }
  console.log(`\n${apply ? 'APPLIED' : 'DRY RUN (nothing written)'}: ${created} places ${apply ? 'created' : 'to create'}, ${moved} reference(s) moved, ${removed} old zone(s) ${apply ? 'removed' : 'to remove'}.`);
  if (toRegion.length) console.log(`No single matching woreda, so these go to the region:\n  ${toRegion.join('\n  ')}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
