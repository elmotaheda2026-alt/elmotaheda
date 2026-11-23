import assert from 'node:assert/strict';
import test from 'node:test';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret-with-enough-entropy';

const { requireAuth, requirePermission } = await import('./auth.js');
const {
  clearNonAdminUserPermissionOverrides,
  resetUserAuthSnapshotForTests,
  setRolePermissions,
  setUserAuthSnapshot,
} = await import('../permissions.js');

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

test('requireAuth rejects requests without bearer tokens', () => {
  const req = { headers: {} } as any;
  const res = createResponse();
  let nextCalled = false;

  requireAuth(req, res as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(req.user, undefined);
});

test('requireAuth rejects malformed and expired bearer tokens', () => {
  for (const authorization of [
    'Bearer not-a-jwt',
    `Bearer ${jwt.sign({ userId: 'u1', role: 'admin', name: 'Admin' }, process.env.JWT_SECRET!, { expiresIn: -1 })}`,
  ]) {
    const req = { headers: { authorization } } as any;
    const res = createResponse();
    let nextCalled = false;

    requireAuth(req, res as any, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.equal(req.user, undefined);
  }
});

test('requireAuth rejects valid JWTs with invalid authorization payloads', () => {
  const token = jwt.sign({ userId: 'u1', role: 'superadmin', name: 'Admin' }, process.env.JWT_SECRET!);
  const req = { headers: { authorization: `Bearer ${token}` } } as any;
  const res = createResponse();
  let nextCalled = false;

  requireAuth(req, res as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(req.user, undefined);
});

test('requireAuth accepts valid JWTs and preserves explicit permissions', () => {
  const token = jwt.sign(
    { userId: 'u1', role: 'user', name: 'User', permissions: ['sales:read'] },
    process.env.JWT_SECRET!,
  );
  const req = { headers: { authorization: `Bearer ${token}` } } as any;
  const res = createResponse();
  let nextCalled = false;

  requireAuth(req, res as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(req.user.userId, 'u1');
  assert.equal(req.user.role, 'user');
  assert.equal(req.user.name, 'User');
  assert.deepEqual(req.user.permissions, ['sales:read']);
});

test('requirePermission denies unauthenticated requests instead of falling back to admin', () => {
  const req = {} as any;
  const res = createResponse();
  let nextCalled = false;

  requirePermission('users:manage')(req, res as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(req.user, undefined);
});

test('requirePermission denies authenticated users without the required permission', () => {
  const req = { user: { userId: 'u1', role: 'user', name: 'User', permissions: ['sales:read'] } } as any;
  const res = createResponse();
  let nextCalled = false;

  requirePermission('users:manage')(req, res as any, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('requireAuth uses live user snapshot permissions and active status instead of stale JWT claims', () => {
  try {
    setUserAuthSnapshot([
      {
        id: 'u-live',
        name: 'Accountant Live',
        role: 'accountant',
        isActive: true,
        permissions: undefined,
      },
    ]);

    const staleToken = jwt.sign(
      { userId: 'u-live', role: 'user', name: 'Old Name', permissions: ['dashboard:view'] },
      process.env.JWT_SECRET!,
    );
    const req = { headers: { authorization: `Bearer ${staleToken}` } } as any;
    const res = createResponse();
    let nextCalled = false;

    requireAuth(req, res as any, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(req.user.role, 'accountant');
    assert.equal(req.user.name, 'Accountant Live');
    assert.equal(req.user.permissions, undefined);

    setUserAuthSnapshot([
      {
        id: 'u-live',
        name: 'Accountant Live',
        role: 'accountant',
        isActive: false,
        permissions: undefined,
      },
    ]);

    const inactiveReq = { headers: { authorization: `Bearer ${staleToken}` } } as any;
    const inactiveRes = createResponse();
    let inactiveNext = false;
    requireAuth(inactiveReq, inactiveRes as any, () => {
      inactiveNext = true;
    });
    assert.equal(inactiveNext, false);
    assert.equal(inactiveRes.statusCode, 401);
  } finally {
    resetUserAuthSnapshotForTests();
  }
});

test('setRolePermissions + clearNonAdminUserPermissionOverrides updates permissions on existing JWT sessions immediately', () => {
  try {
    setRolePermissions({
      accountant: ['dashboard:view', 'sales:read', 'sales:reschedule', 'payments:early_settlement', 'closing:write'],
    });
    setUserAuthSnapshot([
      {
        id: 'u-acc',
        name: 'Mohamed',
        role: 'accountant',
        isActive: true,
        permissions: ['dashboard:view'],
      },
    ]);
    clearNonAdminUserPermissionOverrides();

    const staleToken = jwt.sign(
      { userId: 'u-acc', role: 'accountant', name: 'Mohamed', permissions: ['dashboard:view'] },
      process.env.JWT_SECRET!,
    );
    const req = { headers: { authorization: `Bearer ${staleToken}` } } as any;
    const res = createResponse();
    let authPassed = false;
    requireAuth(req, res as any, () => {
      authPassed = true;
    });
    assert.equal(authPassed, true);

    for (const perm of ['sales:reschedule', 'payments:early_settlement', 'closing:write'] as const) {
      const permRes = createResponse();
      let permPassed = false;
      requirePermission(perm)(req, permRes as any, () => {
        permPassed = true;
      });
      assert.equal(permPassed, true, `expected ${perm} to be granted`);
    }

    setRolePermissions({
      accountant: ['dashboard:view', 'sales:read'],
    });
    const revokedRes = createResponse();
    let revokedPassed = false;
    requirePermission('sales:reschedule')(req, revokedRes as any, () => {
      revokedPassed = true;
    });
    assert.equal(revokedPassed, false);
    assert.equal(revokedRes.statusCode, 403);
  } finally {
    setRolePermissions(null);
    resetUserAuthSnapshotForTests();
  }
});
