export type Permission = keyof UserPermissions;

/**
 * Checks if the current authenticated user has the given permission.
 */
export const hasPermission = (user: User | null, permission: Permission): boolean => {
  if (!user) return false;
  return !!user.permissions?.[permission];
};
