import { isAllowedRole } from '@/types/auth';
import { hashServerPassword } from '@/lib/auth/server';
export const userSelect = { id: true, email: true, displayName: true, role: true, avatarInitials: true, avatarDataUrl: true, bdManagerFullName: true, enabled: true } as const;
export async function userPatch(body: any, create = false) {
  const patch: any = {};
  for (const field of ['email', 'displayName', 'avatarInitials', 'bdManagerFullName']) {
    if (field in body) {
      if (body[field] === null && field === 'bdManagerFullName') { patch[field] = null; continue; }
      if (typeof body[field] !== 'string' || body[field].length > 320) throw new Error('账号字段无效');
      patch[field] = body[field].trim();
    }
  }
  if ('email' in patch) {
    patch.email = patch.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) throw new Error('邮箱无效');
  }
  if ('displayName' in patch && !patch.displayName) throw new Error('请填写姓名');
  if ('role' in body) { if (!isAllowedRole(body.role)) throw new Error('角色无效'); patch.role = body.role; }
  if ('enabled' in body) { if (typeof body.enabled !== 'boolean') throw new Error('状态无效'); patch.enabled = body.enabled; }
  if ('avatarDataUrl' in body) {
    if (body.avatarDataUrl !== null && (typeof body.avatarDataUrl !== 'string' || body.avatarDataUrl.length > 40000 || !/^data:image\/(png|jpeg|webp);base64,/.test(body.avatarDataUrl))) throw new Error('头像格式无效或过大');
    patch.avatarDataUrl = body.avatarDataUrl;
  }
  if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.length < 12 || body.password.length > 1024) throw new Error('密码需要 12 至 1024 个字符');
    patch.passwordHash = await hashServerPassword(body.password);
  }
  if (create && (!patch.email || !patch.displayName || !patch.passwordHash || !patch.role)) throw new Error('请填写邮箱、姓名、角色及至少12位密码');
  if (create) patch.avatarInitials ||= patch.displayName.slice(0, 2).toUpperCase();
  if (!Object.keys(patch).length) throw new Error('没有要更新的字段');
  return patch;
}
