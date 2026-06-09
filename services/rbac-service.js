// services/rbac-service.js
// ─────────────────────────────────────────────────────────────────────────────
// Role-Based Access Control (RBAC) System
// ─────────────────────────────────────────────────────────────────────────────

const PERMISSION_MATRIX = {
  SUPER_ADMIN: ['*'],
  ADMIN: [
    'accounts:view', 'accounts:manage',
    'scheduler:view', 'scheduler:manage',
    'calendar:view', 'calendar:manage',
    'rules:view', 'rules:manage',
    'reports:view', 'analytics:view',
    'ai_insights:view', 'ai_insights:manage',
    'profile:view', 'password:change'
  ],
  OPERATOR: [
    'accounts:view',
    'scheduler:view', 'scheduler:run',
    'calendar:view', 'rules:view',
    'reports:view', 'analytics:view',
    'profile:view', 'password:change'
  ],
  STUDENT: [
    'student:own_data',
    'profile:view', 'password:change'
  ]
};

const RbacService = {
  /**
   * Cek apakah role tertentu memiliki izin akses
   */
  hasPermission: (role, permission) => {
    if (!role) return false;
    const permissions = PERMISSION_MATRIX[role];
    if (!permissions) return false;
    if (permissions.includes('*')) return true;
    return permissions.includes(permission);
  },

  /**
   * Middleware Express untuk membatasi akses route berdasarkan izin
   */
  requirePermission: (permission) => {
    return (req, res, next) => {
      // req.user di-populate oleh requireAuth middleware
      if (!req.user || !req.user.role) {
        return res.status(401).json({ success: false, message: 'Unauthorized. Harap login terlebih dahulu.' });
      }

      if (req.user.status === 'disabled') {
        return res.status(403).json({ success: false, message: 'Akun Anda telah dinonaktifkan.' });
      }

      if (RbacService.hasPermission(req.user.role, permission)) {
        return next();
      }

      return res.status(403).json({
        success: false,
        message: `Forbidden. Role Anda (${req.user.role}) tidak memiliki izin untuk akses ini.`
      });
    };
  },

  getPermissionMatrix: () => PERMISSION_MATRIX
};

module.exports = RbacService;
