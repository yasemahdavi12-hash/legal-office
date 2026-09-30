const db = require('../db/connection');
const { AppError } = require('../utils/response');
const { hashPassword } = require('../utils/password');
const { mapUserOut } = require('../utils/mappers');
const { writeAudit, diffObjects } = require('./audit.service');
const { insertReturningId } = require('../utils/dbHelpers');
const { ADMIN_ROLES } = require('../validators/admin');
const subscriptionService = require('./subscription.service');

async function dashboard(adminUser) {
  const today = new Date().toISOString().slice(0, 10);

  const [casesCount] = await db('cases').count({ c: '*' });
  const [clientsCount] = await db('clients').count({ c: '*' });
  const [usersCount] = await db('users').count({ c: '*' });
  const [tasksToday] = await db('tasks').where({ due_date: today }).whereNot({ status: 'done' }).count({ c: '*' });
  const upcomingEvents = await db('events')
    .where('date', '>=', today)
    .orderBy('date', 'asc')
    .orderBy('time', 'asc')
    .limit(8);

  const byStatus = await db('cases').select('status').count({ c: '*' }).groupBy('status');

  return {
    totals: {
      cases: Number(casesCount.c || 0),
      clients: Number(clientsCount.c || 0),
      users: Number(usersCount.c || 0),
      tasks_today: Number(tasksToday.c || 0),
      upcoming_events: upcomingEvents.length
    },
    cases_by_status: byStatus.reduce((acc, row) => {
      acc[row.status] = Number(row.c || 0);
      return acc;
    }, {}),
    upcoming_events: upcomingEvents.map((e) => ({
      id: e.id,
      title: e.title,
      type: e.type,
      date: e.date,
      time: e.time
    })),
    generated_at: new Date().toISOString()
  };
}

async function listUsers() {
  const rows = await db('users')
    .select(
      'id', 'name', 'phone', 'email', 'role', 'must_change_password',
      'subscription_plan', 'subscription_expires_at', 'created_at'
    )
    .orderBy('id', 'asc');
  return rows.map(mapUserOut);
}

async function createUser(body, actor, meta = {}) {
  const { name, email, password, phone, role } = body;
  if (!ADMIN_ROLES.includes(role)) throw new AppError('نقش نامعتبر است', 400);
  if (!password || String(password).length < 8) {
    throw new AppError('رمز عبور باید حداقل ۸ کاراکتر باشد', 400);
  }

  const exists = await db('users').where({ email }).first();
  if (exists) throw new AppError('امکان ایجاد کاربر با این اطلاعات وجود ندارد', 400);

  const id = await insertReturningId(db, 'users', {
    name,
    email,
    phone: phone || null,
    password_hash: await hashPassword(password),
    role,
    token_version: 0,
    must_change_password: false,
    created_at: db.fn.now()
  });

  await writeAudit({
    userId: actor.id,
    action: 'CREATE',
    entityType: 'user',
    entityId: id,
    changes: { name, email, role, phone: phone || null },
    ip: meta.ip
  });

  return mapUserOut(await db('users').where({ id }).first());
}

async function updateUser(id, body, actor, meta = {}) {
  const before = await db('users').where({ id }).first();
  if (!before) throw new AppError('کاربر یافت نشد', 404);

  const targetId = Number(id);
  const isSelf = targetId === Number(actor.id);

  if (body.role !== undefined) {
    if (!ADMIN_ROLES.includes(body.role)) throw new AppError('نقش نامعتبر است', 400);
    if (isSelf && body.role !== before.role) {
      throw new AppError('تغییر نقش حساب خودتان مجاز نیست', 400);
    }
  }

  if (body.password !== undefined && String(body.password).length < 8) {
    throw new AppError('رمز عبور باید حداقل ۸ کاراکتر باشد', 400);
  }

  const patch = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.phone !== undefined) patch.phone = body.phone;
  if (body.email !== undefined) patch.email = body.email;
  if (body.role !== undefined) patch.role = body.role;
  if (body.password) {
    patch.password_hash = await hashPassword(body.password);
    patch.token_version = (before.token_version || 0) + 1;
    patch.must_change_password = false;
  }

  if (patch.email && patch.email !== before.email) {
    const exists = await db('users').where({ email: patch.email }).whereNot({ id }).first();
    if (exists) throw new AppError('امکان به‌روزرسانی با این اطلاعات وجود ندارد', 400);
  }

  if (!Object.keys(patch).length) throw new AppError('هیچ فیلدی برای به‌روزرسانی ارسال نشده', 400);

  await db('users').where({ id }).update(patch);
  const after = await db('users').where({ id }).first();
  const changes = diffObjects(before, after, ['name', 'phone', 'email', 'role', 'must_change_password']);
  if (body.password) changes.password = { from: '[redacted]', to: '[updated]' };

  await writeAudit({
    userId: actor.id,
    action: 'UPDATE',
    entityType: 'user',
    entityId: targetId,
    changes,
    ip: meta.ip
  });

  return mapUserOut(after);
}

async function deleteUser(id, actor, meta = {}) {
  const before = await db('users').where({ id }).first();
  if (!before) throw new AppError('کاربر یافت نشد', 404);
  if (Number(id) === Number(actor.id)) {
    throw new AppError('حذف حساب خودتان مجاز نیست', 400);
  }

  if (before.role === 'admin') {
    const [{ c }] = await db('users').where({ role: 'admin' }).count({ c: '*' });
    if (Number(c) <= 1) {
      throw new AppError('حذف آخرین مدیر سیستم مجاز نیست', 400);
    }
  }

  await db('users').where({ id }).del();
  await writeAudit({
    userId: actor.id,
    action: 'DELETE',
    entityType: 'user',
    entityId: Number(id),
    changes: { email: before.email, role: before.role, name: before.name },
    ip: meta.ip
  });
  return { ok: true };
}

async function listAuditLogs(query = {}) {
  let q = db('audit_logs')
    .select('id', 'user_id', 'action', 'entity_type', 'entity_id', 'changes', 'ip', 'created_at')
    .orderBy('id', 'desc')
    .limit(Math.min(Number(query.limit) || 100, 500));
  if (query.entity_type) q = q.where({ entity_type: query.entity_type });
  if (query.user_id) q = q.where({ user_id: query.user_id });
  return q;
}

async function setUserSubscription(id, body, actor, meta = {}) {
  const data = await subscriptionService.setUserSubscription(
    Number(id),
    {
      plan: body.plan,
      expiresAt: body.expiresAt || body.expires_at || body.subscription_expires_at,
      note: body.note || null
    },
    actor
  );
  await writeAudit({
    userId: actor.id,
    action: 'UPDATE',
    entityType: 'subscription',
    entityId: Number(id),
    changes: {
      plan: data.storedPlan,
      expiresAt: data.expiresAt,
      effectivePlan: data.plan
    },
    ip: meta.ip
  });
  return data;
}

module.exports = {
  dashboard,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  listAuditLogs,
  setUserSubscription
};
