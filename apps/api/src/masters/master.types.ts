import type { PermissionModule } from '@costing/config';
import type { PrismaService } from '../prisma/prisma.service';
import type { MasterChange } from '../recalc/change-bus';

export interface SchemaLike {
  safeParse(v: unknown): { success: true; data: any } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

export interface MasterReference {
  /** Prisma delegate name of the referencing model */
  model: string;
  field: string;
  label: string;
  /** referencing model uses deletedAt soft delete */
  soft?: boolean;
  /** extra filter on the referencing model (e.g. ignore rows of soft-deleted parents) */
  where?: Record<string, unknown>;
}

export interface MasterConfig {
  path: string;
  /** Prisma delegate name, e.g. "itemGroup" */
  model: string;
  entity: string;
  module: PermissionModule;
  schema: SchemaLike;
  searchFields: string[];
  /** query params mapped to equality filters */
  filters?: string[];
  sortable: string[];
  include?: Record<string, unknown>;
  references: MasterReference[];
  /** extra cross-field / cross-record validation; throw BadRequestException */
  validate?: (data: any, ctx: { prisma: PrismaService; id?: string }) => Promise<void>;
  /** split nested collections out of the payload and persist them inside the write transaction */
  nested?: {
    keys: string[];
    save: (tx: any, id: string, nested: Record<string, any[]>, data: any) => Promise<void>;
  };
  /** adjust data right before persisting (e.g. derive fields) */
  normalize?: (data: any) => any;
  hasCode?: boolean;
  /** compare a record before and after an edit and name the changes costings depend on */
  watch?: (before: any, after: any) => Omit<MasterChange, 'actorId'>[];
  /** changes a newly created record announces (e.g. a new company expense reaches every live costing) */
  watchCreate?: (created: any) => Omit<MasterChange, 'actorId'>[];
}
