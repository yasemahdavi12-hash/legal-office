/** Canonical DB statuses vs UI aliases */
const CASE_STATUS_DB = ['active', 'closed', 'waiting', 'supervision', 'need_action', 'archived'];
const CASE_STATUS_ALIASES = {
  pending: 'waiting',
  waiting: 'waiting',
  action: 'need_action',
  need_action: 'need_action',
  active: 'active',
  closed: 'closed',
  supervision: 'supervision',
  archived: 'archived'
};

function toCaseStatusDb(value) {
  if (!value) return 'active';
  return CASE_STATUS_ALIASES[value] || value;
}

function fromCaseStatusDb(value) {
  // Keep canonical names in API; frontend mapper handles display aliases
  return value;
}

function mapCaseOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    case_number: row.case_number,
    archive_number: row.archive_number,
    branch: row.branch,
    title: row.title,
    description: row.description,
    status: fromCaseStatusDb(row.status),
    supervision_date: row.supervision_date,
    supervision_time: row.supervision_time,
    supervision_note: row.supervision_note,
    owner_id: row.owner_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    // UI-compatible aliases
    num: row.case_number,
    archive: row.archive_number,
    desc: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    supervisionDate: row.supervision_date,
    supervisionTime: row.supervision_time,
    supervisionNote: row.supervision_note
  };
}

function mapClientOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    case_id: row.case_id,
    caseId: row.case_id,
    name: row.name,
    phone: row.phone,
    national_id: row.national_id,
    national: row.national_id,
    description: row.description,
    notes: row.description,
    desc: row.description,
    owner_id: row.owner_id,
    created_at: row.created_at
  };
}

function mapTaskOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    case_id: row.case_id,
    caseId: row.case_id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    due_date: row.due_date,
    due: row.due_date,
    note: row.note,
    owner_id: row.owner_id,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapNoteOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    case_id: row.case_id,
    caseId: row.case_id,
    title: row.title,
    content: row.content,
    body: row.content,
    text: row.content,
    category: row.category,
    cat: row.category,
    created_at: row.created_at,
    createdAt: row.created_at,
    date: row.created_at
  };
}

function mapDocumentOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    case_id: row.case_id,
    caseId: row.case_id,
    file_name: row.file_name,
    name: row.file_name,
    file_type: row.file_type,
    category: row.category,
    cat: row.category,
    uploaded_at: row.uploaded_at,
    created_at: row.uploaded_at,
    date: row.uploaded_at,
    download_url: `/api/documents/${row.id}/download`
  };
}

function mapEventOut(row, reminders = null) {
  if (!row) return null;
  const reminderList = Array.isArray(reminders)
    ? reminders.map((r) => ({
      id: r.id,
      offset_minutes: r.offset_minutes,
      fire_at: r.fire_at,
      status: r.status
    }))
    : undefined;
  return {
    id: row.id,
    case_id: row.case_id,
    caseId: row.case_id,
    client_id: row.client_id ?? null,
    clientId: row.client_id ?? null,
    title: row.title,
    type: row.type,
    event_type: row.type,
    date: row.date,
    time: row.time,
    reminder: row.reminder,
    remind: row.reminder,
    reminder_offsets: reminderList
      ? reminderList.map((r) => r.offset_minutes)
      : (row.reminder != null && row.reminder > 0 ? [row.reminder] : []),
    reminders: reminderList || undefined,
    note: row.note,
    description: row.description != null ? row.description : row.note,
    location: row.location || null,
    status: row.status || 'scheduled',
    timezone: row.timezone || 'Asia/Tehran',
    created_at: row.created_at,
    updated_at: row.updated_at || null
  };
}

function mapUserOut(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    license_number: row.license_number || null,
    licenseNumber: row.license_number || null,
    must_change_password: !!row.must_change_password,
    mfa_enabled: !!row.mfa_enabled,
    subscription_plan: row.subscription_plan || 'free',
    subscription_expires_at: row.subscription_expires_at || null,
    created_at: row.created_at
  };
}

module.exports = {
  CASE_STATUS_DB,
  toCaseStatusDb,
  mapCaseOut,
  mapClientOut,
  mapTaskOut,
  mapNoteOut,
  mapDocumentOut,
  mapEventOut,
  mapUserOut
};
