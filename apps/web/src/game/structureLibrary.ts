import { z } from 'zod';
import { readGameSave } from './structuralState';

const recordSchema = z.object({
  format: z.literal('dof-structure-record'), version: z.literal(1),
  id: z.string().regex(/^\d{2}-[a-z-]+$/), name: z.string(), family: z.string(),
  purpose: z.string(), complexity: z.enum(['small', 'medium', 'large']),
  memberCount: z.number().int().positive(), nodeCount: z.number().int().positive(),
  extentMetres: z.tuple([z.number(), z.number(), z.number()]),
  expectation: z.object({ stability: z.enum(['stable', 'mechanism', 'floating', 'unsupported', 'review']), basis: z.string() }),
  preview: z.string().regex(/^previews\/\d{2}-[a-z-]+\.png$/), save: z.unknown(),
}).transform(record => ({ ...record, save: readGameSave(record.save, 'library').save }));
const catalogSchema = z.object({ format: z.literal('dof-structure-library'), version: z.literal(1), records: z.array(recordSchema).min(1) });
export type StructureRecord = z.infer<typeof recordSchema>;
/** Validate downloaded fixtures before letting their geometry enter the store. */
export function parseStructureLibrary(value: unknown): StructureRecord[] {
  const { records } = catalogSchema.parse(value);
  if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('Duplicate structure IDs.');
  return records;
}
export const structureAsset = (path: string) => `${import.meta.env.BASE_URL}structures/${path}`;
