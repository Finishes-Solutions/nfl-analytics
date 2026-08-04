import { writeFileSync } from 'node:fs';
import { ALL_TABLES, effectiveColumns } from './tables';
const out = ALL_TABLES.map((t) => ({
  name: t.name,
  appendOnly: !!t.appendOnly,
  columns: effectiveColumns(t).map((c) => ({ name: c.name, kind: c.type.kind, pk: !!c.pk })),
}));
writeFileSync('/home/claude/table_specs.json', JSON.stringify(out, null, 2));
console.log(`dumped ${out.length} table specs`);
