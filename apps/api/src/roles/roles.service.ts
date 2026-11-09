import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthUser } from '../common/decorators';
import { CreateRoleDto, UpdateRoleDto } from '../users/users.dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async list() {
    const roles = await this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { permissions: { select: { permission: { select: { key: true } } } }, _count: { select: { users: true } } },
    });
    return roles.map(({ permissions, _count, ...r }) => ({ ...r, userCount: _count.users, permissionKeys: permissions.map((p) => p.permission.key).sort() }));
  }

  catalog() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }], select: { key: true, module: true, action: true } });
  }

  async create(actor: AuthUser, dto: CreateRoleDto) {
    if (await this.prisma.role.findUnique({ where: { name: dto.name } })) throw new ConflictException('Role name already exists');
    if (!actor.isSuperAdmin && dto.permissionKeys?.some((k) => !actor.permissions.has(k))) throw new ForbiddenException('You cannot grant access you do not hold yourself');
    const role = await this.prisma.role.create({ data: { name: dto.name, description: dto.description } });
    if (dto.permissionKeys?.length) await this.setPermissions(actor, role.id, dto.permissionKeys, false);
    await this.audit.log({ userId: actor.id, action: 'create', entity: 'Role', entityId: role.id, metadata: { name: dto.name } });
    return role;
  }

  async update(actor: AuthUser, id: string, dto: UpdateRoleDto) {
    const role = await this.mustFind(id);
    if (role.isSystem && dto.name && dto.name !== role.name) throw new BadRequestException('System roles cannot be renamed');
    const updated = await this.prisma.role.update({ where: { id }, data: dto });
    await this.audit.log({ userId: actor.id, action: 'update', entity: 'Role', entityId: id, metadata: { ...dto } });
    return updated;
  }

  async setPermissions(actor: AuthUser, id: string, keys: string[], doAudit = true) {
    await this.mustFind(id);
    const perms = await this.prisma.permission.findMany({ where: { key: { in: keys } } });
    if (perms.length !== new Set(keys).size) throw new BadRequestException('Unknown permission key');
    if (!actor.isSuperAdmin) {
      // a role's existing grants may stay; anything new must be access the actor holds themselves
      const held = new Set((await this.prisma.rolePermission.findMany({ where: { roleId: id }, select: { permission: { select: { key: true } } } })).map((p) => p.permission.key));
      const added = keys.filter((k) => !held.has(k) && !actor.permissions.has(k));
      if (added.length) throw new ForbiddenException(`You cannot grant access you do not hold yourself: ${added.slice(0, 5).join(', ')}`);
    }
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      this.prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId: id, permissionId: p.id })) }),
    ]);
    if (doAudit) await this.audit.log({ userId: actor.id, action: 'set_permissions', entity: 'Role', entityId: id, metadata: { keys } });
    return { id, permissionKeys: keys };
  }

  async remove(actor: AuthUser, id: string) {
    const role = await this.mustFind(id);
    if (role.isSystem) throw new BadRequestException('System roles cannot be deleted');
    if (await this.prisma.userRole.count({ where: { roleId: id } })) throw new ConflictException('Role is assigned to users');
    await this.prisma.role.delete({ where: { id } });
    await this.audit.log({ userId: actor.id, action: 'delete', entity: 'Role', entityId: id, metadata: { name: role.name } });
    return { id };
  }

  private async mustFind(id: string) {
    const r = await this.prisma.role.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Role not found');
    return r;
  }
}
